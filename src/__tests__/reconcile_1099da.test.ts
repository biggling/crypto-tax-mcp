// Unit tests for the compare_1099da comparison helper — verifies the wedge
// feature's math, audit-risk heuristic, and explanation/recommendation branches
// against detail-design.md §3.8 (the canonical Coinbase/Kraken example) and the
// §15 acceptance examples (#8 constructed-mismatch, #10 tier gating is enforced
// in tools.ts, not here).
//
// Runner: Node's built-in test runner — zero extra dependencies.
//   npm test
//   node --experimental-strip-types --test src/__tests__/reconcile_1099da.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildComparison1099da } from "../reconcile_1099da.js";

// detail-design.md §3.8 canonical example: Coinbase reports $4,250 proceeds with
// $0 basis; user's records show $1,800 basis from a Kraken buy → actual gain $2,450.
test("§3.8 canonical: $0-basis 1099-DA overstates gain by the hidden basis", () => {
  const r = buildComparison1099da({
    exchange: "Coinbase",
    year: 2025,
    reported_proceeds_usd: 4250,
    reported_basis_usd: 0,
    gains: [
      {
        proceeds_usd: 4250,
        cost_basis_usd: 1800,
        gain_loss_usd: 2450,
        acquired_exchange: "Kraken",
        buy_date: "2023-09-12",
      },
    ],
  });

  assert.equal(r.your_proceeds_usd, 4250);
  assert.equal(r.your_basis_usd, 1800);
  assert.equal(r.your_actual_gain, 2450);
  assert.equal(r.exchange_reported_gain, 4250);
  assert.equal(r.discrepancy_usd, 1800); // 4250 reported gain − 2450 actual
  assert.equal(r.matched_lots, 1);
  assert.equal(r.audit_risk, "low"); // proceeds reconcile, basis documented
  assert.match(r.discrepancy_explanation, /Kraken/); // surfaces the source exchange
  assert.match(r.recommendation, /Form 8949/);
});

test("case-insensitive exchange match is the caller's job; helper just sums lots", () => {
  // Two matched lots aggregate.
  const r = buildComparison1099da({
    exchange: "Coinbase",
    year: 2025,
    reported_proceeds_usd: 10000,
    reported_basis_usd: 0,
    gains: [
      { proceeds_usd: 6000, cost_basis_usd: 2000, gain_loss_usd: 4000 },
      { proceeds_usd: 4000, cost_basis_usd: 1500, gain_loss_usd: 2500 },
    ],
  });
  assert.equal(r.your_proceeds_usd, 10000);
  assert.equal(r.your_basis_usd, 3500);
  assert.equal(r.your_actual_gain, 6500);
  assert.equal(r.discrepancy_usd, 3500);
  assert.equal(r.matched_lots, 2);
  assert.equal(r.audit_risk, "low");
});

test("no matching records → high audit risk, import recommendation", () => {
  const r = buildComparison1099da({
    exchange: "Coinbase",
    year: 2025,
    reported_proceeds_usd: 4250,
    reported_basis_usd: 0,
    gains: [],
  });
  assert.equal(r.matched_lots, 0);
  assert.equal(r.your_basis_usd, 0);
  assert.equal(r.exchange_reported_gain, 4250);
  assert.equal(r.audit_risk, "high");
  assert.match(r.recommendation, /Import/i);
});

test("proceeds disagree beyond tolerance → medium audit risk", () => {
  const r = buildComparison1099da({
    exchange: "Coinbase",
    year: 2025,
    reported_proceeds_usd: 5000,
    reported_basis_usd: 0,
    gains: [{ proceeds_usd: 4250, cost_basis_usd: 1800, gain_loss_usd: 2450 }],
  });
  assert.equal(r.audit_risk, "medium");
  assert.match(r.discrepancy_explanation, /[Pp]roceeds/);
});

test("proceeds within 1% tolerance still reconciles as low risk", () => {
  const r = buildComparison1099da({
    exchange: "Coinbase",
    year: 2025,
    reported_proceeds_usd: 4250,
    reported_basis_usd: 0,
    gains: [{ proceeds_usd: 4255, cost_basis_usd: 1800, gain_loss_usd: 2455 }], // $5 off < 1%
  });
  assert.equal(r.audit_risk, "low");
});

test("exact match → no discrepancy, ready to file", () => {
  const r = buildComparison1099da({
    exchange: "Coinbase",
    year: 2025,
    reported_proceeds_usd: 4250,
    reported_basis_usd: 1800,
    gains: [{ proceeds_usd: 4250, cost_basis_usd: 1800, gain_loss_usd: 2450 }],
  });
  assert.equal(r.discrepancy_usd, 0);
  assert.equal(r.audit_risk, "low");
  assert.match(r.recommendation, /[Rr]eady to file/);
});

test("reported_basis_usd defaults to 0 when omitted", () => {
  const r = buildComparison1099da({
    exchange: "Coinbase",
    year: 2025,
    reported_proceeds_usd: 4250,
    // @ts-expect-error — exercising the runtime default path the Zod schema fills
    reported_basis_usd: undefined,
    gains: [{ proceeds_usd: 4250, cost_basis_usd: 1800, gain_loss_usd: 2450 }],
  });
  assert.equal(r.reported_basis_usd, 0);
  assert.equal(r.exchange_reported_gain, 4250);
});

test("user records show LESS basis than reported → flagged, do not file", () => {
  const r = buildComparison1099da({
    exchange: "Coinbase",
    year: 2025,
    reported_proceeds_usd: 4250,
    reported_basis_usd: 3000,
    gains: [{ proceeds_usd: 4250, cost_basis_usd: 1800, gain_loss_usd: 2450 }],
  });
  assert.equal(r.your_basis_usd, 1800);
  assert.match(r.discrepancy_explanation, /LESS basis/);
  assert.match(r.recommendation, /Don't file/);
});
