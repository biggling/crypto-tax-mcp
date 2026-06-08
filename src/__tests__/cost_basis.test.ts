// Unit tests for the cost-basis engine — verifies FIFO/LIFO/HIFO lot selection,
// long-term/short-term classification, fee handling, partial-lot consumption, and
// the error paths against detail-design.md §5 ("Cost Basis Engine") and the §15
// acceptance examples.
//
// Runner: Node's built-in test runner — zero extra dependencies.
//   npm test           (see package.json -> "test")
//   node --experimental-strip-types --test src/__tests__/cost_basis.test.ts
//
// Source uses ESM NodeNext, so the import carries the .js extension even though
// the on-disk file is .ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateCostBasis, compareCostBasisMethods } from "../cost_basis.js";
import type { Transaction, TxType } from "../types.js";

let seq = 0;
function tx(
  type: TxType,
  date: string,
  quantity: number,
  price_usd?: number,
  extra: Partial<Transaction> = {}
): Transaction {
  return {
    id: `tx-${seq++}`,
    user_id: "u1",
    date,
    type,
    coin_id: "bitcoin",
    quantity,
    price_usd,
    source: "manual",
    ...extra,
  };
}

// §5: FIFO consumes the OLDEST lot first.
test("FIFO consumes the oldest lot", () => {
  const txs = [
    tx("buy", "2026-01-01T00:00:00Z", 1, 15000),
    tx("buy", "2026-02-01T00:00:00Z", 1, 30000),
    tx("buy", "2026-03-01T00:00:00Z", 1, 20000),
    tx("sell", "2026-06-01T00:00:00Z", 1, 25000),
  ];
  const r = calculateCostBasis(txs, "fifo");
  assert.equal(r.cost_lots.length, 1, "one lot matched for a 1-unit sell");
  assert.equal(r.total_cost_basis_usd, 15000, "oldest lot's basis used");
  assert.equal(r.total_proceeds_usd, 25000);
  assert.equal(r.realized_gain_loss_usd, 10000);
  assert.equal(r.short_term_gain_loss, 10000, "151-day hold is short-term");
  assert.equal(r.long_term_gain_loss, 0);
});

// §5: LIFO consumes the NEWEST lot first.
test("LIFO consumes the newest lot", () => {
  const txs = [
    tx("buy", "2026-01-01T00:00:00Z", 1, 15000),
    tx("buy", "2026-02-01T00:00:00Z", 1, 30000),
    tx("buy", "2026-03-01T00:00:00Z", 1, 20000),
    tx("sell", "2026-06-01T00:00:00Z", 1, 25000),
  ];
  const r = calculateCostBasis(txs, "lifo");
  assert.equal(r.total_cost_basis_usd, 20000, "newest lot's basis used");
  assert.equal(r.realized_gain_loss_usd, 5000);
});

// §5: HIFO consumes the HIGHEST-cost lot first (tax-loss harvesting).
test("HIFO consumes the highest-cost lot", () => {
  const txs = [
    tx("buy", "2026-01-01T00:00:00Z", 1, 15000),
    tx("buy", "2026-02-01T00:00:00Z", 1, 30000),
    tx("buy", "2026-03-01T00:00:00Z", 1, 20000),
    tx("sell", "2026-06-01T00:00:00Z", 1, 25000),
  ];
  const r = calculateCostBasis(txs, "hifo");
  assert.equal(r.total_cost_basis_usd, 30000, "highest-cost lot used");
  assert.equal(r.realized_gain_loss_usd, -5000, "produces a capital loss");
});

// §5 long-term threshold: (sell_date - buy_date) > 365 days => long-term.
test("holding period > 365 days classifies as long-term", () => {
  const txs = [
    tx("buy", "2024-01-01T00:00:00Z", 1, 10000),
    tx("sell", "2026-01-01T00:00:00Z", 1, 18000),
  ];
  const r = calculateCostBasis(txs, "fifo");
  assert.equal(r.cost_lots.length, 1);
  assert.equal(r.cost_lots[0].is_long_term, true);
  assert.ok(r.cost_lots[0].holding_period_days > 365);
  assert.equal(r.long_term_gain_loss, 8000);
  assert.equal(r.short_term_gain_loss, 0);
});

// Boundary: exactly 365 days is NOT long-term (strictly greater than required).
test("exactly 365-day hold is short-term (boundary)", () => {
  const txs = [
    tx("buy", "2025-01-01T00:00:00Z", 1, 10000),
    tx("sell", "2026-01-01T00:00:00Z", 1, 12000),
  ];
  const r = calculateCostBasis(txs, "fifo");
  assert.equal(r.cost_lots[0].holding_period_days, 365);
  assert.equal(r.cost_lots[0].is_long_term, false);
  assert.equal(r.short_term_gain_loss, 2000);
});

// Fees: buy fee adds to basis; sell fee reduces proceeds.
test("fees increase cost basis and reduce proceeds", () => {
  const txs = [
    tx("buy", "2026-01-01T00:00:00Z", 1, 10000, { fee_usd: 100 }),
    tx("sell", "2026-02-01T00:00:00Z", 1, 20000, { fee_usd: 50 }),
  ];
  const r = calculateCostBasis(txs, "fifo");
  assert.equal(r.total_cost_basis_usd, 10100, "basis = 10000 + 100 fee");
  assert.equal(r.total_proceeds_usd, 19950, "proceeds = 20000 - 50 fee");
  assert.equal(r.realized_gain_loss_usd, 9850);
});

// Partial-lot consumption: a sell spanning two lots produces one gain row per lot.
test("sell spanning multiple lots splits across lots (FIFO)", () => {
  const txs = [
    tx("buy", "2026-01-01T00:00:00Z", 2, 100),
    tx("buy", "2026-02-01T00:00:00Z", 2, 200),
    tx("sell", "2026-03-01T00:00:00Z", 3, 300),
  ];
  const r = calculateCostBasis(txs, "fifo");
  assert.equal(r.cost_lots.length, 2, "3 units drawn from 2 lots => 2 gain rows");
  assert.equal(r.total_quantity_sold, 3);
  // lot1: 2 @ basis 100 => basis 200, proceeds 600; lot2: 1 @ basis 200, proceeds 300
  assert.equal(r.total_cost_basis_usd, 400);
  assert.equal(r.total_proceeds_usd, 900);
  assert.equal(r.realized_gain_loss_usd, 500);
});

// Error path: a sell with no prior buy => critical MISSING_COST_BASIS.
test("sell with no matching lot flags MISSING_COST_BASIS", () => {
  const txs = [tx("sell", "2026-01-01T00:00:00Z", 1, 25000)];
  const r = calculateCostBasis(txs, "fifo");
  assert.equal(r.cost_lots.length, 0);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].error_type, "MISSING_COST_BASIS");
  assert.equal(r.errors[0].severity, "critical");
  assert.equal(r.reconciliation_status.missing_cost_basis_count, 1);
  assert.equal(r.reconciliation_status.confidence_score, 80, "100 - 1*20");
});

// Error path: withdrawal exceeding known deposits => NEGATIVE_BALANCE.
test("transfer_out exceeding deposits flags NEGATIVE_BALANCE", () => {
  const txs = [tx("transfer_out", "2026-01-01T00:00:00Z", 5)];
  const r = calculateCostBasis(txs, "fifo");
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].error_type, "NEGATIVE_BALANCE");
  assert.equal(r.errors[0].severity, "critical");
});

// transfer_in / transfer_out adjust balance without creating a taxable event.
test("transfers are not taxable events", () => {
  const txs = [
    tx("buy", "2026-01-01T00:00:00Z", 2, 100),
    tx("transfer_out", "2026-01-05T00:00:00Z", 1),
    tx("transfer_in", "2026-01-06T00:00:00Z", 1),
  ];
  const r = calculateCostBasis(txs, "fifo");
  assert.equal(r.cost_lots.length, 0, "no realized gains from transfers");
  assert.equal(r.errors.length, 0, "balance stays non-negative");
});

// Inputs are sorted chronologically regardless of insertion order.
test("transactions are processed in date order", () => {
  const txs = [
    tx("sell", "2026-06-01T00:00:00Z", 1, 25000),
    tx("buy", "2026-01-01T00:00:00Z", 1, 15000),
  ];
  const r = calculateCostBasis(txs, "fifo");
  assert.equal(r.errors.length, 0, "earlier-dated buy matched despite later position");
  assert.equal(r.realized_gain_loss_usd, 10000);
});

// earn/airdrop lots carry FMV-on-receipt as their cost basis (not 0). IRS treats
// the receipt as ordinary income at FMV, and that FMV becomes the lot basis, so a
// later sell only realizes the appreciation above FMV — not the full proceeds.
test("earn/airdrop lot uses FMV-on-receipt as cost basis", () => {
  const txs = [
    tx("earn", "2026-01-01T00:00:00Z", 1, 1000),
    tx("sell", "2026-02-01T00:00:00Z", 1, 1500),
  ];
  const r = calculateCostBasis(txs, "fifo");
  assert.equal(r.cost_lots.length, 1);
  assert.equal(r.total_cost_basis_usd, 1000, "basis = FMV-on-receipt, not 0");
  assert.equal(r.total_proceeds_usd, 1500);
  assert.equal(r.realized_gain_loss_usd, 500, "only the appreciation above FMV is gain");
});

// Fully-consumed lots must not re-appear as zero-qty gain rows on later sells.
test("fully-consumed lots produce no spurious zero-qty gain rows", () => {
  const txs = [
    tx("buy", "2026-01-01T00:00:00Z", 1, 100),
    tx("buy", "2026-02-01T00:00:00Z", 1, 200),
    tx("sell", "2026-03-01T00:00:00Z", 1, 150), // fully consumes lot1
    tx("sell", "2026-04-01T00:00:00Z", 1, 250), // must draw only from lot2
  ];
  const r = calculateCostBasis(txs, "fifo");
  assert.equal(r.cost_lots.length, 2, "exactly one gain row per sell, no empty rows");
  assert.ok(r.cost_lots.every((g) => g.quantity > 0), "no zero-qty rows");
  assert.equal(r.total_quantity_sold, 2);
});

// compareCostBasisMethods recommends the lowest-tax method.
test("compareCostBasisMethods recommends the most tax-efficient method", () => {
  const txs = [
    tx("buy", "2026-01-01T00:00:00Z", 1, 15000),
    tx("buy", "2026-02-01T00:00:00Z", 1, 30000),
    tx("buy", "2026-03-01T00:00:00Z", 1, 20000),
    tx("sell", "2026-06-01T00:00:00Z", 1, 25000),
  ];
  const c = compareCostBasisMethods(txs);
  assert.equal(c.fifo.realized_gain, 10000);
  assert.equal(c.lifo.realized_gain, 5000);
  assert.equal(c.hifo.realized_gain, -5000);
  // HIFO yields a loss => zero tax => most efficient.
  assert.equal(c.recommendation.most_tax_efficient, "hifo");
  assert.ok(c.recommendation.potential_tax_savings > 0);
});
