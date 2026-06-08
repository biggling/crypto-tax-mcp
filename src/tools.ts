import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import type { Tier } from "./db.js";
import { getHistoricalPrice } from "./coingecko.js";
import {
  insertTransaction,
  getTxsByUser,
  countTxsByUser,
  countExchangesByUser,
  txExists,
  insertLot,
  clearUserLots,
  getOpenLots,
  getAllOpenLotsByCoin,
  clearUserGains,
  insertGain,
  getGainsByUser,
  getGainsByExchangeYear,
} from "./db.js";
import { calculateCostBasis, compareCostBasisMethods } from "./cost_basis.js";
import type { Transaction, RealizedGain } from "./types.js";
import { getParser, autoDetect, parseRows } from "./parsers/index.js";
import { buildComparison1099da } from "./reconcile_1099da.js";

const ImportTransactionsCsvSchema = z.object({
  source: z.enum(["koinly", "cointracker", "coinbase", "kraken", "binance", "manual"]),
  csv_data: z.string().describe("Base64-encoded CSV data"),
  exchange: z.string().optional(),
});

const CalculateCostBasisSchema = z.object({
  transactions: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      type: z.enum(["buy", "sell", "transfer_in", "transfer_out", "earn", "airdrop"]),
      coin_id: z.string(),
      quantity: z.number(),
      price_usd: z.number().optional(),
      fee_usd: z.number().optional(),
      exchange: z.string().optional(),
      wallet_address: z.string().optional(),
      tx_hash: z.string().optional(),
    })
  ),
  method: z.enum(["fifo", "lifo", "hifo"]),
  tax_year: z.number().optional(),
});

const OptimizeCostBasisSchema = z.object({
  transactions: z.array(z.object({
    id: z.string(),
    date: z.string(),
    type: z.enum(["buy", "sell", "transfer_in", "transfer_out", "earn", "airdrop"]),
    coin_id: z.string(),
    quantity: z.number(),
    price_usd: z.number().optional(),
    fee_usd: z.number().optional(),
  })),
  include_methods: z.array(z.enum(["fifo", "lifo", "hifo"])).optional(),
  tax_rate_short_term: z.number().optional(),
  tax_rate_long_term: z.number().optional(),
});

const ReconcileForm1099Schema = z.object({
  calculated_basis: z.record(z.any()),
  form_1099da_csv: z.string().optional(),
  tolerance_percent: z.number().optional().default(5),
});

const DetectErrorsSchema = z.object({
  transactions: z.array(z.object({
    id: z.string(),
    date: z.string(),
    type: z.enum(["buy", "sell", "transfer_in", "transfer_out", "earn", "airdrop"]),
    coin_id: z.string(),
    quantity: z.number(),
    price_usd: z.number().optional(),
  })),
});

const Compare1099daSchema = z.object({
  exchange: z.string().describe("Exchange that issued the 1099-DA (e.g. 'Coinbase')"),
  year: z.number().int().describe("Tax year the 1099-DA covers (e.g. 2025)"),
  reported_proceeds_usd: z.number().describe("Total proceeds the 1099-DA reports"),
  reported_basis_usd: z
    .number()
    .optional()
    .default(0)
    .describe("Cost basis the 1099-DA reports — frequently 0 for transferred-in assets"),
});

const GenerateTaxReportSchema = z.object({
  format: z.enum(["json", "csv", "pdf"]).optional().default("json"),
  tax_year: z.number().optional(),
  include_audit_trail: z.boolean().optional().default(true),
});

const AddManualTransactionSchema = z.object({
  type: z.enum(["buy", "sell", "transfer_in", "transfer_out", "earn", "airdrop"]),
  coin_id: z.string().describe("CoinGecko ID, e.g. 'bitcoin', 'ethereum'"),
  quantity: z.number().positive(),
  date: z.string().describe("ISO 8601, e.g. '2025-09-12' or '2025-09-12T14:30:00Z'"),
  price_usd: z.number().positive().optional().describe("FMV in USD; auto-fetched from CoinGecko if omitted"),
  fee_usd: z.number().nonnegative().optional(),
  exchange: z.string().optional(),
  wallet: z.string().optional(),
  tx_hash: z.string().optional(),
  notes: z.string().optional(),
});

const GetTransactionsSchema = z.object({
  year: z.number().int().optional(),
  type: z.enum(["buy", "sell", "transfer_in", "transfer_out", "earn", "airdrop"]).optional(),
  coin_id: z.string().optional(),
  exchange: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

const GetRealizedGainsSchema = z.object({
  year: z.number().int().optional().describe("Tax year to filter by (e.g. 2025). Omit for all years."),
  method: z.enum(["fifo", "lifo", "hifo"]).optional().default("fifo"),
});

export function registerTools(
  server: McpServer,
  userId: string,
  tier: Tier
): void {
  // Tool 1: import_transactions_csv
  server.tool(
    "import_transactions_csv",
    "Import transactions from CSV (Koinly, CoinTracker, exchange). Deduplicates and validates.",
    ImportTransactionsCsvSchema.shape,
    { destructiveHint: true, title: "Import Transactions" },
    async (args) => {
      const text = Buffer.from(args.csv_data, "base64").toString("utf-8");
      if (!text.trim()) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Empty CSV" }) }] };
      }

      // 1. Select parser: explicit source first, else auto-detect from header.
      let parser = getParser(args.source);
      const rows = parseRows(text);
      if (!parser || parser.name === "generic") {
        const detected = rows.length > 0 ? autoDetect(rows[0]) : undefined;
        if (detected) parser = detected;
      }
      if (!parser) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error:
                  "Could not detect CSV format. Use a generic CSV with columns: date,type,coin,quantity (+ optional price_usd,fee_usd,exchange).",
              }),
            },
          ],
        };
      }

      // 2. Parse → normalized transactions + warnings (partial success).
      const { transactions, warnings } = parser.parse(text);

      // 3. Insert with dedupe.
      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];
      for (const p of transactions) {
        try {
          const tx: Transaction = {
            id: uuid(),
            user_id: userId,
            date: p.date,
            type: p.type,
            coin_id: p.coin_id,
            quantity: p.quantity,
            price_usd: p.price_usd,
            fee_usd: p.fee_usd,
            exchange: p.exchange ?? args.exchange,
            tx_hash: p.tx_hash,
            notes: p.notes,
            source: "csv",
          };
          if (
            txExists(userId, {
              date: tx.date,
              coin_id: tx.coin_id,
              quantity: tx.quantity,
              exchange: tx.exchange ?? null,
              tx_hash: tx.tx_hash ?? null,
            })
          ) {
            skipped++;
            continue;
          }
          insertTransaction({
            ...tx,
            price_usd: tx.price_usd ?? null,
            fee_usd: tx.fee_usd ?? null,
            exchange: tx.exchange ?? null,
            wallet: tx.wallet ?? null,
            tx_hash: tx.tx_hash ?? null,
            notes: tx.notes ?? null,
          });
          imported++;
        } catch (e) {
          errors.push(`${p.coin_id} @ ${p.date}: ${String(e)}`);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              parser: parser.name,
              rows_parsed: transactions.length,
              transactions_imported: imported,
              skipped_duplicates: skipped,
              warnings: warnings.slice(0, 10),
              errors: errors.slice(0, 5),
            }),
          },
        ],
      };
    }
  );

  // Tool 2: calculate_cost_basis
  server.tool(
    "calculate_cost_basis",
    "Calculate cost basis using FIFO/LIFO/HIFO. Detects errors (missing cost basis, negative balance).",
    CalculateCostBasisSchema.shape,
    { readOnlyHint: true, title: "Calculate Cost Basis" },
    async (args) => {
      const txs = args.transactions.map((t): Transaction => ({
        id: t.id,
        user_id: userId,
        date: t.date,
        type: t.type,
        coin_id: t.coin_id,
        quantity: t.quantity,
        price_usd: t.price_usd,
        fee_usd: t.fee_usd,
        exchange: t.exchange,
        wallet: t.wallet_address,
        tx_hash: t.tx_hash,
        source: "csv",
      }));
      clearUserLots(userId);
      clearUserGains(userId);
      const result = calculateCostBasis(txs, args.method);
      for (const gain of result.cost_lots) {
        insertGain({
          id: gain.id,
          user_id: userId,
          sell_tx_id: gain.sell_tx_id,
          buy_tx_id: gain.buy_tx_id,
          coin_id: gain.coin_id,
          quantity: gain.quantity,
          proceeds_usd: gain.proceeds_usd,
          cost_basis_usd: gain.cost_basis_usd,
          gain_loss_usd: gain.gain_loss_usd,
          is_long_term: gain.is_long_term ? 1 : 0,
          sell_date: gain.sell_date,
          buy_date: gain.buy_date,
          method: gain.method,
        });
      }
      return { content: [{ type: "text", text: JSON.stringify({
        total_realized_gain_loss: result.realized_gain_loss_usd.toFixed(2),
        short_term: result.short_term_gain_loss.toFixed(2),
        long_term: result.long_term_gain_loss.toFixed(2),
        transactions: result.total_transactions,
        errors: result.errors.length,
        confidence_score: result.reconciliation_status.confidence_score,
      }) }] };
    }
  );

  // Tool 3: reconcile_with_1099da
  server.tool(
    "reconcile_with_1099da",
    "Compare calculated cost basis against Form 1099-DA. Detect mismatches (cost basis discrepancies, missing transactions).",
    ReconcileForm1099Schema.shape,
    { readOnlyHint: true, title: "Reconcile with 1099-DA" },
    async (args) => {
      const calculated = args.calculated_basis;
      const tolerance = args.tolerance_percent / 100;
      const conflicts = [];
      const matches = 0;

      if (!args.form_1099da_csv) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "1099-DA CSV required" }) }] };
      }

      const lines = Buffer.from(args.form_1099da_csv, "base64").toString().split("\n");
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",");
        if (parts.length < 3) continue;
        const reported = { coin: parts[0], proceeds: parseFloat(parts[1]), basis: parseFloat(parts[2]) };
        const found = Object.values(calculated).find((c: any) => c.coin === reported.coin);
        if (!found) {
          conflicts.push({ type: "MISSING", reported });
        } else if (Math.abs((found.basis - reported.basis) / reported.basis) > tolerance) {
          conflicts.push({ type: "MISMATCH", reported, calculated: found });
        }
      }

      return { content: [{ type: "text", text: JSON.stringify({
        conflicts: conflicts.length,
        mismatch_tolerance: args.tolerance_percent + "%",
        ready_for_filing: conflicts.length === 0,
        recommendations: conflicts.length === 0 ? ["All reconciled. Ready to file."] : conflicts.map((c) => `Resolve ${c.type} for ${c.reported.coin}`),
      }) }] };
    }
  );

  // Tool 4: optimize_cost_basis_method
  server.tool(
    "optimize_cost_basis_method",
    "Compare tax impact of FIFO vs LIFO vs HIFO. Show which method minimizes tax liability.",
    OptimizeCostBasisSchema.shape,
    { readOnlyHint: true, title: "Optimize Cost Basis Method" },
    async (args) => {
      const methods = args.include_methods || ["fifo", "lifo", "hifo"];
      const shortTax = args.tax_rate_short_term || 0.37;
      const longTax = args.tax_rate_long_term || 0.20;

      const txs = args.transactions.map((t): Transaction => ({
        id: t.id,
        user_id: userId,
        date: t.date,
        type: t.type,
        coin_id: t.coin_id,
        quantity: t.quantity,
        price_usd: t.price_usd,
        fee_usd: t.fee_usd,
        source: "csv",
      }));

      const results = methods.map((method: any) => {
        const calc = calculateCostBasis(txs, method);
        const tax = calc.short_term_gain_loss * shortTax + calc.long_term_gain_loss * longTax;
        return { method, realized_gain: calc.realized_gain_loss_usd, tax_liability: Math.max(0, tax) };
      });

      const best = results.reduce((a: any, b: any) => a.tax_liability < b.tax_liability ? a : b);
      const worst = results.reduce((a: any, b: any) => a.tax_liability > b.tax_liability ? a : b);

      return { content: [{ type: "text", text: JSON.stringify({
        methods_compared: results,
        most_tax_efficient: best.method,
        potential_tax_savings: (worst.tax_liability - best.tax_liability).toFixed(2),
        recommendation: `Use ${best.method.toUpperCase()} to save $${(worst.tax_liability - best.tax_liability).toFixed(2)}`,
      }) }] };
    }
  );

  // Tool 5: detect_errors_and_explain
  server.tool(
    "detect_errors_and_explain",
    "Detect common crypto tax errors: negative balance, missing cost basis, bridge transfer mismatches. Returns root cause + remediation.",
    DetectErrorsSchema.shape,
    { readOnlyHint: true, title: "Detect Errors and Explain" },
    async (args) => {
      const txs = args.transactions.map((t): Transaction => ({
        id: t.id,
        user_id: userId,
        date: t.date,
        type: t.type,
        coin_id: t.coin_id,
        quantity: t.quantity,
        price_usd: t.price_usd,
        source: "csv",
      }));

      const errors = [];
      const balances = new Map<string, number>();

      for (const tx of txs.sort((a: any, b: any) => new Date(a.date) - new Date(b.date))) {
        const current = balances.get(tx.coin_id) || 0;
        if (tx.type.includes("out")) {
          const newBal = current - tx.quantity;
          if (newBal < 0) {
            errors.push({
              type: "NEGATIVE_BALANCE",
              coin: tx.coin_id,
              amount: Math.abs(newBal),
              remediation: `Import missing ${Math.abs(newBal)} ${tx.coin_id} from another exchange`,
            });
          }
        }
        balances.set(tx.coin_id, Math.max(0, current + (tx.type.includes("in") ? tx.quantity : -tx.quantity)));
      }

      return { content: [{ type: "text", text: JSON.stringify({
        errors_detected: errors.length,
        error_list: errors,
        reconciliation_confidence: 100 - (errors.length * 20),
        summary: errors.length === 0 ? "No errors detected. Ready for reconciliation." : `${errors.length} error(s) detected. See remediation steps.`,
      }) }] };
    }
  );

  // Tool 6: generate_tax_report
  server.tool(
    "generate_tax_report",
    "Generate tax report in JSON/CSV/PDF format. Includes cost basis, realized gains, short/long-term split, audit trail.",
    GenerateTaxReportSchema.shape,
    { readOnlyHint: true, title: "Generate Tax Report" },
    async (args) => {
      const gains = getGainsByUser(userId);
      const totalGain = gains.reduce((sum, g) => sum + g.gain_loss_usd, 0);
      const shortTerm = gains.filter((g) => !g.is_long_term).reduce((sum, g) => sum + g.gain_loss_usd, 0);
      const longTerm = gains.filter((g) => g.is_long_term).reduce((sum, g) => sum + g.gain_loss_usd, 0);

      const report = {
        format: args.format,
        report_date: new Date().toISOString().split("T")[0],
        tax_year: args.tax_year || new Date().getFullYear(),
        summary: {
          total_realized_gain_loss: totalGain.toFixed(2),
          short_term_gain_loss: shortTerm.toFixed(2),
          long_term_gain_loss: longTerm.toFixed(2),
          transactions: gains.length,
          short_term_count: gains.filter((g) => !g.is_long_term).length,
          long_term_count: gains.filter((g) => g.is_long_term).length,
        },
        sample_transactions: gains.slice(0, 5).map((g) => ({
          coin: g.coin_id,
          buy_date: g.buy_date,
          sell_date: g.sell_date,
          quantity: g.quantity,
          proceeds: g.proceeds_usd.toFixed(2),
          cost_basis: g.cost_basis_usd.toFixed(2),
          gain_loss: g.gain_loss_usd.toFixed(2),
          holding_period: g.is_long_term ? "long-term" : "short-term",
        })),
        audit_trail: args.include_audit_trail ? "Available in full report" : undefined,
      };

      return { content: [{ type: "text", text: JSON.stringify(report) }] };
    }
  );

  // Tool 7: compare_1099da ⭐ (the $49/mo Tax-tier wedge)
  server.tool(
    "compare_1099da",
    "Reconcile a broker Form 1099-DA against your own calculated cost basis for one exchange + tax year. Brokers report proceeds but often $0 basis (they can't see assets acquired elsewhere), overstating your gain. Returns your actual gain, the discrepancy, a plain-language explanation, audit risk, and a filing recommendation. Requires Tax tier. Run calculate_cost_basis first so gains are stored.",
    Compare1099daSchema.shape,
    { readOnlyHint: true, title: "Compare with 1099-DA" },
    async (args) => {
      if (tier !== "tax") {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "compare_1099da requires the Tax tier ($49/mo).",
                upgrade_url: "https://mcpize.com/crypto-tax/upgrade?tier=tax",
              }),
            },
          ],
        };
      }

      const gains = getGainsByExchangeYear(userId, args.exchange, args.year);
      const result = buildComparison1099da({
        exchange: args.exchange,
        year: args.year,
        reported_proceeds_usd: args.reported_proceeds_usd,
        reported_basis_usd: args.reported_basis_usd,
        gains: gains.map((g) => ({
          proceeds_usd: g.proceeds_usd,
          cost_basis_usd: g.cost_basis_usd,
          gain_loss_usd: g.gain_loss_usd,
          acquired_exchange: g.acquired_exchange,
          buy_date: g.buy_date,
        })),
      });

      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  // Tool 8: add_manual_transaction (spec §3.2)
  server.tool(
    "add_manual_transaction",
    "Add a single crypto transaction — buy, sell, transfer, airdrop, or earn income. If price_usd is omitted for taxable events (buy/sell/earn/airdrop), the historical USD price is fetched automatically from CoinGecko. Deduplication prevents double-entry. Free tier: max 50 transactions.",
    AddManualTransactionSchema.shape,
    { destructiveHint: true, title: "Add Manual Transaction" },
    async (args) => {
      if (tier === "free" && countTxsByUser(userId) >= 50) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "Free tier limit reached (50 transactions). Upgrade to Pro for unlimited.",
              upgrade_url: "https://mcpize.com/crypto-tax/upgrade",
            }),
          }],
        };
      }

      let price_usd: number | null = args.price_usd ?? null;
      // Auto-fill FMV for events where basis matters — non-fatal if CoinGecko fails
      if (price_usd === null && ["buy", "sell", "earn", "airdrop"].includes(args.type)) {
        const dateOnly = args.date.split("T")[0];
        try {
          price_usd = await getHistoricalPrice(args.coin_id, dateOnly);
        } catch {
          // proceed without price; user can re-enter
        }
      }

      const tx: TxRow = {
        id: uuid(),
        user_id: userId,
        type: args.type as TxType,
        coin_id: args.coin_id,
        quantity: args.quantity,
        price_usd,
        fee_usd: args.fee_usd ?? null,
        date: args.date,
        exchange: args.exchange ?? null,
        wallet: args.wallet ?? null,
        tx_hash: args.tx_hash ?? null,
        source: "manual",
        notes: args.notes ?? null,
      };

      if (
        txExists(userId, {
          date: tx.date,
          coin_id: tx.coin_id,
          quantity: tx.quantity,
          exchange: tx.exchange,
          tx_hash: tx.tx_hash,
        })
      ) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ warning: "Duplicate — transaction already exists", id: null }),
          }],
        };
      }

      insertTransaction(tx);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            added: true,
            id: tx.id,
            type: tx.type,
            coin_id: tx.coin_id,
            quantity: tx.quantity,
            price_usd: tx.price_usd,
            date: tx.date,
            exchange: tx.exchange,
            price_source:
              args.price_usd != null
                ? "provided"
                : price_usd != null
                  ? "coingecko_historical"
                  : "missing",
          }),
        }],
      };
    }
  );

  // Tool 9: get_transactions (spec §3.3)
  server.tool(
    "get_transactions",
    "Browse stored transactions. Filter by year, event type, coin, or exchange. Returns newest first. Use limit/offset to paginate.",
    GetTransactionsSchema.shape,
    { readOnlyHint: true, title: "Get Transactions" },
    (args) => {
      const txs = getTxsByUser(userId, {
        year: args.year,
        type: args.type as TxType | undefined,
        coin_id: args.coin_id,
        exchange: args.exchange,
        limit: args.limit ?? 50,
        offset: args.offset ?? 0,
      });
      const total = countTxsByUser(userId);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total_stored: total,
            returned: txs.length,
            offset: args.offset ?? 0,
            transactions: txs.map((t) => ({
              id: t.id,
              date: t.date,
              type: t.type,
              coin_id: t.coin_id,
              quantity: t.quantity,
              price_usd: t.price_usd,
              fee_usd: t.fee_usd,
              exchange: t.exchange,
              source: t.source,
              notes: t.notes,
            })),
          }),
        }],
      };
    }
  );

  // Tool 10: get_realized_gains (spec §3.5)
  server.tool(
    "get_realized_gains",
    "Summarize realized capital gains for a tax year. Returns short-term/long-term split, per-coin breakdown, and totals. Run calculate_cost_basis first to populate the gains store.",
    GetRealizedGainsSchema.shape,
    { readOnlyHint: true, title: "Get Realized Gains" },
    (args) => {
      const method = args.method ?? "fifo";
      const gains = getGainsByUser(userId, { year: args.year, method });

      const short = gains.filter((g) => !g.is_long_term);
      const long  = gains.filter((g) => !!g.is_long_term);
      const sumGain = (arr: typeof gains) => arr.reduce((s, g) => s + g.gain_loss_usd, 0);
      const sumProc = (arr: typeof gains) => arr.reduce((s, g) => s + g.proceeds_usd, 0);
      const sumBasis = (arr: typeof gains) => arr.reduce((s, g) => s + g.cost_basis_usd, 0);

      // Per-coin rollup
      const byCoin = new Map<string, { gain: number; txs: number }>();
      for (const g of gains) {
        const e = byCoin.get(g.coin_id) ?? { gain: 0, txs: 0 };
        e.gain += g.gain_loss_usd;
        e.txs  += 1;
        byCoin.set(g.coin_id, e);
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            year: args.year ?? "all",
            method,
            total_proceeds_usd:    sumProc(gains).toFixed(2),
            total_cost_basis_usd:  sumBasis(gains).toFixed(2),
            total_realized_gain_usd: sumGain(gains).toFixed(2),
            short_term: {
              proceeds:    sumProc(short).toFixed(2),
              cost_basis:  sumBasis(short).toFixed(2),
              gain:        sumGain(short).toFixed(2),
              transactions: short.length,
            },
            long_term: {
              proceeds:    sumProc(long).toFixed(2),
              cost_basis:  sumBasis(long).toFixed(2),
              gain:        sumGain(long).toFixed(2),
              transactions: long.length,
            },
            by_coin: Array.from(byCoin.entries())
              .map(([coin_id, v]) => ({
                coin_id,
                realized_gain_usd: v.gain.toFixed(2),
                transactions: v.txs,
              }))
              .sort((a, b) => parseFloat(b.realized_gain_usd) - parseFloat(a.realized_gain_usd)),
          }),
        }],
      };
    }
  );
}
