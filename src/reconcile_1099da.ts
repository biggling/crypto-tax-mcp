// Pure comparison logic for the `compare_1099da` tool (the $49/mo Tax-tier wedge).
//
// A broker-issued Form 1099-DA reports gross PROCEEDS for assets sold on that
// exchange, but very often reports $0 (or wrong) cost BASIS — because the broker
// never saw where the coins were originally acquired (another exchange, a wallet,
// an airdrop). That inflates the gain the IRS thinks you owe tax on. This module
// reconciles the broker's numbers against the user's own calculated cost basis
// and explains the gap in plain language.
//
// Kept dependency-free (no db/mcp imports) so it unit-tests as a pure function,
// matching the repo's node:test convention (see __tests__/cost_basis.test.ts).

export interface Gain1099Input {
  proceeds_usd: number;
  cost_basis_usd: number;
  gain_loss_usd: number;
  /** Exchange where the matched buy lot was acquired, when known — used to
   *  explain WHY the broker couldn't see the basis. */
  acquired_exchange?: string | null;
  buy_date?: string | null;
}

export interface Compare1099Params {
  exchange: string;
  year: number;
  reported_proceeds_usd: number;
  reported_basis_usd: number;
  /** The user's own realized gains for this exchange + tax year. */
  gains: Gain1099Input[];
}

export type AuditRisk = "low" | "medium" | "high";

export interface Compare1099Result {
  exchange: string;
  year: number;
  reported_proceeds_usd: number;
  reported_basis_usd: number;
  your_proceeds_usd: number;
  your_basis_usd: number;
  your_actual_gain: number;
  exchange_reported_gain: number;
  discrepancy_usd: number;
  matched_lots: number;
  discrepancy_explanation: string;
  audit_risk: AuditRisk;
  recommendation: string;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const usd = (n: number): string =>
  `$${round2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Proceeds reconcile if within $1 or 1% of the reported figure (rounding / fee
// treatment differences between broker and our engine are expected and benign).
function proceedsMatch(yours: number, reported: number): boolean {
  const tolerance = Math.max(1, Math.abs(reported) * 0.01);
  return Math.abs(yours - reported) <= tolerance;
}

export function buildComparison1099da(p: Compare1099Params): Compare1099Result {
  const reportedBasis = p.reported_basis_usd ?? 0;
  const yourProceeds = round2(p.gains.reduce((s, g) => s + g.proceeds_usd, 0));
  const yourBasis = round2(p.gains.reduce((s, g) => s + g.cost_basis_usd, 0));
  const yourGain = round2(p.gains.reduce((s, g) => s + g.gain_loss_usd, 0));
  const matched = p.gains.length;

  const exchangeReportedGain = round2(p.reported_proceeds_usd - reportedBasis);
  // Positive discrepancy = the 1099-DA overstates your gain (you owe less than it implies).
  const discrepancy = round2(exchangeReportedGain - yourGain);

  const procMatch = proceedsMatch(yourProceeds, p.reported_proceeds_usd);

  // ── Audit risk ────────────────────────────────────────────────────────────
  let audit_risk: AuditRisk;
  if (matched === 0) {
    audit_risk = "high"; // nothing in our records to substantiate any basis
  } else if (!procMatch) {
    audit_risk = "medium"; // proceeds disagree → missing or extra sells
  } else {
    audit_risk = "low"; // proceeds reconcile; basis gap is documented & explainable
  }

  // ── Explanation ─────────────────────────────────────────────────────────────
  let discrepancy_explanation: string;
  let recommendation: string;

  if (matched === 0) {
    discrepancy_explanation =
      `No sells for ${p.exchange} in ${p.year} were found in your records, so the ` +
      `$${reportedBasis === 0 ? "0" : usd(reportedBasis).slice(1)} basis on the 1099-DA cannot be ` +
      `verified. As reported, the form implies a ${usd(exchangeReportedGain)} gain.`;
    recommendation =
      `Import your ${p.exchange} ${p.year} history (and any buys made on other ` +
      `platforms or wallets) and re-run calculate_cost_basis before filing — otherwise ` +
      `you may overpay on the full ${usd(p.reported_proceeds_usd)} of proceeds.`;
    return result();
  }

  // Where were the matched lots acquired? Surfaces the usual cause: bought elsewhere.
  const sources = Array.from(
    new Set(
      p.gains
        .map((g) => g.acquired_exchange)
        .filter((e): e is string => !!e && e.toLowerCase() !== p.exchange.toLowerCase())
    )
  );
  const sourceClause =
    sources.length > 0
      ? ` because the original purchase was on ${sources.join(", ")}`
      : ` because the broker couldn't see where the assets were originally acquired`;

  if (!procMatch) {
    discrepancy_explanation =
      `Proceeds don't match: the 1099-DA reports ${usd(p.reported_proceeds_usd)} but your ` +
      `records show ${usd(yourProceeds)} across ${matched} matched lot(s). Reconcile the ` +
      `proceeds first — you may be missing sells, or have sells recorded under a different exchange.`;
    recommendation =
      `Verify every ${p.exchange} ${p.year} disposal is imported (and tagged to ${p.exchange}) ` +
      `before relying on the basis figures. Then re-run this comparison.`;
  } else if (yourBasis > reportedBasis) {
    discrepancy_explanation =
      `The 1099-DA reports ${reportedBasis === 0 ? "$0 cost basis" : `${usd(reportedBasis)} cost basis`}, ` +
      `so it overstates your gain by ${usd(discrepancy)}${sourceClause}. Your records show ` +
      `${usd(yourBasis)} of basis across ${matched} matched lot(s), making your actual gain ${usd(yourGain)} ` +
      `instead of the ${usd(exchangeReportedGain)} the form implies.`;
    recommendation =
      `File Form 8949 with ${usd(yourBasis)} cost basis (actual gain ${usd(yourGain)}). ` +
      `Keep your acquisition records as documentation — this lowers the reported gain by ${usd(discrepancy)}.`;
  } else if (yourBasis < reportedBasis) {
    discrepancy_explanation =
      `Your records show LESS basis (${usd(yourBasis)}) than the 1099-DA reports (${usd(reportedBasis)}). ` +
      `That is unusual — it would increase your gain to ${usd(yourGain)}. Double-check for duplicate or ` +
      `over-counted buy lots before filing.`;
    recommendation =
      `Investigate the extra ${usd(reportedBasis - yourBasis)} of basis on the 1099-DA. ` +
      `Don't file until the basis is reconciled.`;
  } else {
    discrepancy_explanation =
      `Your records reconcile with the 1099-DA: proceeds ${usd(yourProceeds)} and basis ` +
      `${usd(yourBasis)} both match, for a gain of ${usd(yourGain)}.`;
    recommendation = `No discrepancy — the 1099-DA matches your records. Ready to file Form 8949.`;
  }

  return result();

  function result(): Compare1099Result {
    return {
      exchange: p.exchange,
      year: p.year,
      reported_proceeds_usd: round2(p.reported_proceeds_usd),
      reported_basis_usd: round2(reportedBasis),
      your_proceeds_usd: yourProceeds,
      your_basis_usd: yourBasis,
      your_actual_gain: yourGain,
      exchange_reported_gain: exchangeReportedGain,
      discrepancy_usd: discrepancy,
      matched_lots: matched,
      discrepancy_explanation,
      audit_risk,
      recommendation,
    };
  }
}
