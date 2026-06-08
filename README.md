# Crypto Tax MCP

> Reconcile, calculate, and file your crypto taxes inside Claude — FIFO/LIFO/HIFO lot matching, IRS Form 1099-DA discrepancy detection, and tax-optimal method selection.

**MCP server** (Model Context Protocol) that gives Claude IRS-grade crypto tax reasoning. Import a Koinly/CoinTracker/exchange CSV, point Claude at it, and ask: *"What's my 2025 realized gain?"* — Claude does the lot matching, splits short vs. long-term, and tells you which method saves the most.

Pairs with the companion [Crypto Portfolio MCP](https://github.com/biggling/crypto-portfolio-mcp).

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Transport: Streamable HTTP](https://img.shields.io/badge/transport-Streamable_HTTP-green.svg)](#)
[![Node 20+](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](#)

---

## Why this exists

In January 2026 the IRS rolled out **Form 1099-DA**: brokers (Coinbase, Kraken, Robinhood, etc.) now report your crypto **proceeds** to the IRS — but they usually report **$0 cost basis** for any asset you transferred in from another exchange or wallet. The taxman sees "$50,000 in proceeds, $0 cost," panics, and assumes you owe tax on the entire $50K.

You don't. You owe tax on the actual **gain** — which only your full transaction history can prove.

This MCP gives Claude the reasoning to:
1. **Import** your transactions from Koinly, CoinTracker, Coinbase, Kraken, Binance, or any generic CSV
2. **Calculate** cost basis with FIFO / LIFO / HIFO — including auto-detected error states (negative balances, missing basis)
3. **Compare** your real numbers against the 1099-DA your broker mailed you, in plain language
4. **Optimize** — which method minimizes your tax liability this year?
5. **Generate** a Form 8949–compatible report your CPA can drop straight into TurboTax

All without leaving Claude. No spreadsheets. No 11-tab Notion docs.

---

## Who it's for

| Persona | What they get |
|---|---|
| **Active traders** | Per-tax-year realized gain summary in 3 prompts. Optimize basis method to legally cut tax. |
| **DeFi / on-chain users** | Reconcile cross-chain transfers your broker can't see |
| **Anyone holding through 2025** | The 1099-DA is coming whether you're ready or not — this MCP makes the reconciliation conversational |
| **CPAs / accountants** | Drop client CSVs in, ask Claude for a Form 8949 export, ship to client |
| **Hodlers** | Confirm long-term status, see capital gain horizon, decide when to sell |

---

## Tools (10)

| Tool | Purpose |
|---|---|
| `import_transactions_csv` | Parse Koinly / CoinTracker / Coinbase / Kraken / Binance / generic CSV |
| `add_manual_transaction` | Add a single tx; auto-fetches historical FMV from CoinGecko |
| `get_transactions` | Browse stored txs — filter by year, type, coin, exchange |
| `calculate_cost_basis` | FIFO / LIFO / HIFO lot matching → short-term + long-term gain split |
| `get_realized_gains` | Year-scoped gain summary with per-coin breakdown |
| `optimize_cost_basis_method` | Compare FIFO vs LIFO vs HIFO tax liability side-by-side |
| `detect_errors_and_explain` | Negative balance, missing basis, bridge mismatches — root cause + fix |
| `reconcile_with_1099da` | Match calculated basis vs 1099-DA, flag mismatches over tolerance |
| `compare_1099da` ⭐ | Plain-language broker reconciliation — *the* Tax-tier feature |
| `generate_tax_report` | Form 8949–compatible JSON / CSV with audit trail |

---

## Example conversations

### 1. Import your Koinly export

> **You:** *(uploads `koinly-2025.csv` to Claude)* "Import this — it's my Koinly export for 2025."

*Claude calls:* `import_transactions_csv({source: "koinly", csv_data: "<base64>"})`

> **Claude:** "Imported **412 transactions** from Koinly. Found 4 duplicates against your existing records (skipped). 3 warnings — Polygon transactions on lines 87, 142, and 301 have no fee specified; assuming $0. Ready to calculate cost basis."

<details>
<summary>Raw JSON output</summary>

```json
{
  "parser": "koinly",
  "rows_parsed": 416,
  "transactions_imported": 412,
  "skipped_duplicates": 4,
  "warnings": [
    "Line 87: missing fee — assumed $0",
    "Line 142: missing fee — assumed $0",
    "Line 301: missing fee — assumed $0"
  ],
  "errors": []
}
```
</details>

---

### 2. Add a single transaction by hand

> **You:** "I earned 0.05 ETH from staking on June 1, 2025. Add it as income."

*Claude calls:* `add_manual_transaction({type: "earn", coin_id: "ethereum", quantity: 0.05, date: "2025-06-01"})` — `price_usd` omitted → auto-fetched from CoinGecko historical.

> **Claude:** "Added: 0.05 ETH earned June 1, 2025. CoinGecko historical price for that day: $3,820, so FMV = **$191**. That becomes ordinary income on your 2025 return, and your cost basis going forward is $3,820/ETH."

---

### 3. Calculate gains with FIFO

> **You:** "Run FIFO on all my 2025 sells."

*Claude calls:* `calculate_cost_basis({transactions: [...all stored txs], method: "fifo", tax_year: 2025})` then surfaces the summary.

> **Claude:** "2025 FIFO results:
> - **Total realized gain:** **+$48,200**
> - Short-term: +$12,400 (taxed as ordinary income — ouch)
> - Long-term: +$35,800 (capital gains rates)
> - 87 sell transactions matched. Confidence: 96%.
>
> 2 missing-basis warnings — you sold 0.3 BTC from an exchange we don't have purchase records for. Want me to flag those for resolution?"

---

### 4. Should I use LIFO or HIFO instead?

> **You:** "What method saves the most tax?"

*Claude calls:* `optimize_cost_basis_method({transactions: [...], include_methods: ["fifo", "lifo", "hifo"]})`

> **Claude:** "**HIFO** saves you the most. Comparison at 37% short-term / 20% long-term rates:
>
> | Method | Realized gain | Tax owed |
> |---|---|---|
> | FIFO | $48,200 | $11,750 |
> | LIFO | $39,100 | $9,400 |
> | **HIFO** | **$31,800** | **$8,090** |
>
> Switching to HIFO saves you **$3,660** on this year's return. Note: the IRS allows method choice but you must apply it consistently — talk to your CPA before switching mid-stream."

---

### 5. Find tax-impact errors

> **You:** "Are there any issues before I file?"

*Claude calls:* `detect_errors_and_explain({transactions: [...all]})`

> **Claude:** "Found **1 error**:
>
> 🚨 **NEGATIVE_BALANCE: SOL** on April 11, 2025 — you sold 18.4 SOL but the records only show 12.1 SOL in. You likely have a missing transfer-in from another exchange or wallet.
>
> *Fix:* Import the missing 6.3 SOL purchase/transfer. Common sources: a CEX you forgot, a Phantom wallet, an airdrop, or a swap you didn't catalog. Once added, re-run `calculate_cost_basis`.
>
> Confidence: 80% — bring this to 100% before filing."

---

### 6. Reconcile against your 1099-DA ⭐ (Tax tier)

> **You:** "Coinbase sent me a 1099-DA showing $52,000 proceeds and $0 basis for 2025. I think it's wrong. Can you check?"

*Claude calls:* `compare_1099da({exchange: "Coinbase", year: 2025, reported_proceeds_usd: 52000, reported_basis_usd: 0})`

> **Claude:** "Coinbase's 1099-DA reports **$52,000 in proceeds with $0 basis** — but **38 of your Coinbase sells were assets you originally bought on Kraken** ($28,400 cost basis) and **moved into Coinbase** before selling.
>
> **Your real gain on Coinbase 2025 activity:**
> - Proceeds: $52,000 ✅ (matches 1099-DA)
> - **Real cost basis: $36,200** (Coinbase can't see the Kraken purchases)
> - **Real gain: $15,800** (not $52,000)
>
> **Discrepancy:** Coinbase will report $52K to the IRS as taxable gain. You owe tax on $15.8K.
>
> **Audit risk:** Medium. The IRS will see the mismatch. **File Form 8949 with Box C checked** (basis not reported to IRS) and attach a brief reconciliation note. We can generate that report next."

<details>
<summary>This is the full Tax-tier value prop in one tool call. Plain language. Defensible numbers. Audit-ready.</summary>
</details>

---

### 7. Browse what's stored

> **You:** "Show me all my BTC sells in 2025."

*Claude calls:* `get_transactions({year: 2025, type: "sell", coin_id: "bitcoin"})`

> **Claude:** "12 BTC sells in 2025 (total of stored: 412 transactions). Most recent first:
> - 2025-12-18: −0.1 BTC @ $98,200 on Coinbase ($9,820 proceeds, fee $4.50)
> - 2025-11-04: −0.05 BTC @ $76,800 on Kraken ($3,840 proceeds, fee $2.00)
> - 2025-09-22: −0.2 BTC @ $58,400 on Coinbase ($11,680 proceeds, fee $5.80)
> - … (showing 50 of 12; want to filter further?)"

---

### 8. Year-end summary

> **You:** "Quick 2025 realized gains summary."

*Claude calls:* `get_realized_gains({year: 2025, method: "fifo"})`

> **Claude:** "2025 realized gains (FIFO):
> - **Total realized gain:** $48,200
> - **Short-term:** $12,400 (87 lots) — taxed at ordinary income rates
> - **Long-term:** $35,800 (43 lots) — taxed at LTCG rates
>
> **By coin:**
> - BTC: +$31,200 (12 lots)
> - ETH: +$8,400 (28 lots)
> - SOL: +$5,100 (44 lots)
> - LINK: +$2,800 (18 lots)
> - DOGE: +$700 (28 lots)"

---

### 9. Export Form 8949

> **You:** "Give me a CSV my CPA can plug into TurboTax."

*Claude calls:* `generate_tax_report({format: "csv", tax_year: 2025, include_audit_trail: true})`

> **Claude:** "Generated. The report has 130 line items (matching 130 sell lots). Top of file:
>
> ```
> Coin, Buy Date, Sell Date, Quantity, Proceeds, Cost Basis, Gain/Loss, Holding Period
> bitcoin, 2023-09-12, 2025-03-04, 0.08, 5760.00, 2080.00, 3680.00, long-term
> bitcoin, 2023-09-12, 2025-04-15, 0.10, 7340.00, 2600.00, 4740.00, long-term
> ...
> ```
>
> Audit trail attached — each line shows which buy lot was matched to which sell, using FIFO. Drop into TurboTax or send to your CPA."

---

### 10. Bring-your-own 1099-DA CSV

> **You:** "I have the 1099-DA Kraken sent me as a CSV. Reconcile against my numbers."

*Claude calls:* `reconcile_with_1099da({calculated_basis: <prev_result>, form_1099da_csv: "<base64>", tolerance_percent: 5})`

> **Claude:** "Compared 23 reported lines against your calculated basis (5% tolerance):
> - ✅ 19 matched within tolerance
> - ⚠️ 3 mismatches — Kraken reports $0 basis where you have $1,400 / $3,200 / $890 (these were transferred in from Binance)
> - 🚨 1 missing — Kraken reports a SOL sell you don't have. Did you delete a transaction by mistake?
>
> **Not ready to file** until the missing tx is resolved. Want me to walk you through finding it?"

---

## Pricing tiers

| Tier | Transactions | Methods | 1099-DA reconciliation | Price |
|---|---|---|---|---|
| **Free** | 50 | FIFO only | ❌ | $0 |
| **Pro** | Unlimited | FIFO + LIFO + HIFO + Optimize | ❌ | $19/mo |
| **Tax** | Unlimited | All methods | ✅ `compare_1099da` | $49/mo |

The Tax tier exists for one reason: the **plain-language broker reconciliation** that explains the gap between your 1099-DA and reality. Worth $49/mo for one filing season, easily.

---

## Stack

- **Runtime:** Node.js 20, TypeScript
- **MCP SDK:** [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) (Streamable HTTP, stateless per-request)
- **Framework:** Express + Zod schemas
- **Prices:** CoinGecko Demo API (historical FMV for any past date)
- **Storage:** SQLite via `better-sqlite3` (transactions, cost lots, realized gains)
- **Parsers:** Koinly, CoinTracker, Coinbase, Kraken, Binance + generic CSV with auto-detect
- **Billing:** [Polar.sh](https://polar.sh) webhook → tier upgrade (optional; works without)
- **Auth:** Bearer API key + MCPize upstream proxy passthrough

---

## CSV format support

Auto-detected from the header row when `source: "manual"` is passed, or specify explicitly:

| Source | Status |
|---|---|
| `koinly` | ✅ Full support — type/coin/quantity/price/fee mapped |
| `cointracker` | ✅ Full support |
| `coinbase` | ✅ Native Coinbase Tax Center export |
| `kraken` | ✅ Native Kraken ledger export |
| `binance` | ✅ Spot + earn rows |
| `manual` (generic) | ✅ Any CSV with `date,type,coin,quantity` (+ optional `price_usd,fee_usd,exchange`) |

CSV must be **base64-encoded** when passed as `csv_data` — Claude does this automatically.

---

## Development

```bash
git clone https://github.com/biggling/crypto-tax-mcp.git
cd crypto-tax-mcp
npm install

cp .env.example .env
# Edit .env — set COINGECKO_API_KEY

npm run dev               # watch mode
# or
npm run build && npm start # production
```

### Environment variables

| Var | Purpose | Default |
|---|---|---|
| `PORT` | HTTP listen port | `3001` |
| `COINGECKO_API_KEY` | Demo-tier key (historical FMV needed) | required |
| `DB_PATH` | SQLite file | `./data/tax.db` |
| `NODE_ENV` | `production` / `development` | `production` |
| `MCPIZE_UPSTREAM_TOKEN` | MCPize gateway upstream token | optional |
| `POLAR_WEBHOOK_SECRET` | Polar.sh webhook signature secret | optional |
| `POLAR_PRODUCT_PRO` | Polar product ID for Pro tier | optional |
| `POLAR_PRODUCT_TAX` | Polar product ID for Tax tier | optional |
| `POLAR_API_TOKEN` | Polar.sh API token | optional |

---

## Architecture

```
Claude AI (or MCPize gateway)
       │  HTTPS  Bearer <key>
       ▼
nginx reverse proxy
       │  :3001
       ▼
crypto-tax-mcp (Node.js / Express)
       ├─► SQLite  ──  transactions, lots, realized_gains, polar_subscriptions
       ├─► CoinGecko  ──  historical FMV (cached)
       └─► Polar.sh webhook /webhooks/polar (HMAC-verified)
```

### Stateless MCP

Each `POST /mcp` creates a fresh `McpServer` instance scoped to the authenticated user — no session state to manage, horizontally scalable, safe behind any load balancer.

### Cost basis engine

Pure-function FIFO/LIFO/HIFO matcher in `src/cost_basis.ts`. Same input → same output, always. Lot matching is deterministic so reports are reproducible audit-defensibly: you can hand a CPA the input CSV and get the same gain numbers.

---

## Disclaimer

This MCP returns **tax calculations** — it is not tax **advice**. For high-value or complex returns, work with a qualified CPA. The 1099-DA reconciliation tool flags discrepancies and suggests Form 8949 box choices; the actual filing decision is yours.

---

## License

MIT.
