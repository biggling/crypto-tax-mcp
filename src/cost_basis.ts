import { v4 as uuid } from "uuid";
import type {
  Transaction,
  CostLot,
  RealizedGain,
  ErrorLog,
  CostBasisResult,
} from "./types.js";

const LONG_TERM_DAYS = 365;

export function calculateCostBasis(
  transactions: Transaction[],
  method: "fifo" | "lifo" | "hifo" = "fifo"
): CostBasisResult {
  const sortedTxs = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const lots = new Map<string, CostLot[]>(); // coin_id -> [open lots]
  const realizedGains: RealizedGain[] = [];
  const errors: ErrorLog[] = [];
  const balances = new Map<string, number>(); // coin_id -> quantity

  for (const tx of sortedTxs) {
    const current = balances.get(tx.coin_id) ?? 0;

    if (tx.type === "buy" || tx.type === "earn" || tx.type === "airdrop") {
      // Create a cost lot. For buy, basis is the purchase price; for earn/airdrop,
      // IRS treats the income as ordinary income at fair-market-value on receipt and
      // that FMV (tx.price_usd) becomes the lot's cost basis. Using 0 would overstate
      // the later capital gain.
      const basis = tx.price_usd ?? 0;
      const totalCost = basis * tx.quantity + (tx.fee_usd ?? 0);
      const lot: CostLot = {
        id: uuid(),
        user_id: tx.user_id,
        buy_tx_id: tx.id,
        coin_id: tx.coin_id,
        quantity_acquired: tx.quantity,
        quantity_remaining: tx.quantity,
        cost_basis_usd: totalCost,
        cost_per_unit: totalCost / tx.quantity,
        acquired_date: tx.date,
        acquired_at_price_usd: basis,
        exchange: tx.exchange,
      };
      if (!lots.has(tx.coin_id)) lots.set(tx.coin_id, []);
      lots.get(tx.coin_id)!.push(lot);
      balances.set(tx.coin_id, current + tx.quantity);
    } else if (tx.type === "sell") {
      // Match against lots
      const openLots = lots.get(tx.coin_id) ?? [];
      if (openLots.length === 0) {
        errors.push({
          id: uuid(),
          user_id: tx.user_id,
          transaction_id: tx.id,
          error_type: "MISSING_COST_BASIS",
          severity: "critical",
          description: `Sell of ${tx.quantity} ${tx.coin_id} has no matching buy lot`,
          root_cause: "Missing purchase transaction from another exchange",
          remediation: `Upload CSV from the exchange where you bought this ${tx.coin_id}`,
          tax_impact_usd: (tx.price_usd ?? 0) * tx.quantity,
          created_at: new Date().toISOString(),
        });
        balances.set(tx.coin_id, current - tx.quantity);
        continue;
      }

      const proceeds = (tx.price_usd ?? 0) * tx.quantity - (tx.fee_usd ?? 0);
      let remainingQty = tx.quantity;

      const usedLots = selectLotsForSale(
        openLots,
        remainingQty,
        method
      );

      for (const { lot, qty } of usedLots) {
        const costBasis = lot.cost_per_unit * qty;
        const proceedsPerLot = ((tx.price_usd ?? 0) * qty) - (tx.fee_usd ?? 0) * (qty / tx.quantity);
        const gainLoss = proceedsPerLot - costBasis;
        const buyDate = new Date(lot.acquired_date);
        const sellDate = new Date(tx.date);
        const holdingDays = Math.floor(
          (sellDate.getTime() - buyDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        const isLongTerm = holdingDays > LONG_TERM_DAYS;

        realizedGains.push({
          id: uuid(),
          user_id: tx.user_id,
          sell_tx_id: tx.id,
          buy_tx_id: lot.buy_tx_id,
          coin_id: tx.coin_id,
          quantity: qty,
          proceeds_usd: proceedsPerLot,
          cost_basis_usd: costBasis,
          gain_loss_usd: gainLoss,
          is_long_term: isLongTerm,
          holding_period_days: holdingDays,
          sell_date: tx.date,
          buy_date: lot.acquired_date,
          method,
        });

        lot.quantity_remaining -= qty;
        if (lot.quantity_remaining <= 0) {
          lot.closed_at = tx.date;
        }
      }

      balances.set(tx.coin_id, current - tx.quantity);
    } else if (tx.type === "transfer_in") {
      balances.set(tx.coin_id, current + tx.quantity);
    } else if (tx.type === "transfer_out") {
      const newBalance = current - tx.quantity;
      if (newBalance < 0) {
        errors.push({
          id: uuid(),
          user_id: tx.user_id,
          transaction_id: tx.id,
          error_type: "NEGATIVE_BALANCE",
          severity: "critical",
          description: `Balance went negative: ${newBalance} ${tx.coin_id}`,
          root_cause: `Withdrawal exceeds known deposits. Missing exchange import?`,
          remediation: `Check if you deposited ${Math.abs(newBalance)} ${tx.coin_id} from another exchange`,
          tax_impact_usd: 0,
          created_at: new Date().toISOString(),
        });
      }
      balances.set(tx.coin_id, Math.max(0, newBalance));
    }
  }

  const totalProceeds = realizedGains.reduce((sum, g) => sum + g.proceeds_usd, 0);
  const totalCostBasis = realizedGains.reduce((sum, g) => sum + g.cost_basis_usd, 0);
  const totalGainLoss = totalProceeds - totalCostBasis;
  const shortTermGainLoss = realizedGains
    .filter((g) => !g.is_long_term)
    .reduce((sum, g) => sum + g.gain_loss_usd, 0);
  const longTermGainLoss = realizedGains
    .filter((g) => g.is_long_term)
    .reduce((sum, g) => sum + g.gain_loss_usd, 0);

  // Calculate confidence score (0-100)
  const errorCount = errors.filter((e) => e.severity === "critical").length;
  const confidenceScore = Math.max(0, 100 - errorCount * 20);

  return {
    total_transactions: sortedTxs.length,
    total_quantity_sold: realizedGains.reduce((sum, g) => sum + g.quantity, 0),
    total_proceeds_usd: totalProceeds,
    total_cost_basis_usd: totalCostBasis,
    realized_gain_loss_usd: totalGainLoss,
    short_term_gain_loss: shortTermGainLoss,
    long_term_gain_loss: longTermGainLoss,
    cost_lots: realizedGains,
    errors,
    reconciliation_status: {
      total_quantity_unmatched: 0,
      missing_cost_basis_count: errors.filter((e) => e.error_type === "MISSING_COST_BASIS").length,
      confidence_score: confidenceScore,
    },
  };
}

interface SelectedLot {
  lot: CostLot;
  qty: number;
}

function selectLotsForSale(
  openLots: CostLot[],
  neededQty: number,
  method: "fifo" | "lifo" | "hifo"
): SelectedLot[] {
  const sorted = [...openLots];

  if (method === "fifo") {
    sorted.sort(
      (a, b) =>
        new Date(a.acquired_date).getTime() - new Date(b.acquired_date).getTime()
    );
  } else if (method === "lifo") {
    sorted.sort(
      (a, b) =>
        new Date(b.acquired_date).getTime() - new Date(a.acquired_date).getTime()
    );
  } else if (method === "hifo") {
    sorted.sort((a, b) => b.cost_per_unit - a.cost_per_unit);
  }

  const result: SelectedLot[] = [];
  let remaining = neededQty;

  for (const lot of sorted) {
    if (remaining <= 0) break;
    // Skip fully-consumed lots — otherwise they get pushed with qty 0 and produce
    // spurious empty RealizedGain rows on later sells.
    if (lot.quantity_remaining <= 0) continue;
    const qtyToUse = Math.min(lot.quantity_remaining, remaining);
    result.push({ lot, qty: qtyToUse });
    remaining -= qtyToUse;
  }

  return result;
}

export function compareCostBasisMethods(
  transactions: Transaction[],
  taxRateShortTerm: number = 0.37,
  taxRateLongTerm: number = 0.20
): {
  fifo: {
    method: "fifo";
    realized_gain: number;
    short_term: number;
    long_term: number;
    estimated_tax_liability: number;
  };
  lifo: {
    method: "lifo";
    realized_gain: number;
    short_term: number;
    long_term: number;
    estimated_tax_liability: number;
  };
  hifo: {
    method: "hifo";
    realized_gain: number;
    short_term: number;
    long_term: number;
    estimated_tax_liability: number;
  };
  recommendation: {
    most_tax_efficient: "fifo" | "lifo" | "hifo";
    potential_tax_savings: number;
    reason: string;
  };
} {
  const methods = ["fifo", "lifo", "hifo"] as const;
  const results: Record<
    string,
    {
      method: string;
      realized_gain: number;
      short_term: number;
      long_term: number;
      estimated_tax_liability: number;
    }
  > = {};

  for (const method of methods) {
    const result = calculateCostBasis(transactions, method);
    const estimatedTax =
      result.short_term_gain_loss * taxRateShortTerm +
      result.long_term_gain_loss * taxRateLongTerm;
    results[method] = {
      method,
      realized_gain: result.realized_gain_loss_usd,
      short_term: result.short_term_gain_loss,
      long_term: result.long_term_gain_loss,
      estimated_tax_liability: Math.max(0, estimatedTax),
    };
  }

  const sorted = Object.values(results).sort(
    (a, b) => a.estimated_tax_liability - b.estimated_tax_liability
  );
  const mostEfficient = sorted[0].method as "fifo" | "lifo" | "hifo";
  const worst = sorted[sorted.length - 1];
  const savings = worst.estimated_tax_liability - sorted[0].estimated_tax_liability;

  return {
    fifo: results.fifo,
    lifo: results.lifo,
    hifo: results.hifo,
    recommendation: {
      most_tax_efficient: mostEfficient,
      potential_tax_savings: savings,
      reason: `${mostEfficient.toUpperCase()} minimizes tax liability by ${savings.toFixed(2)} vs ${worst.method.toUpperCase()}`,
    },
  };
}
