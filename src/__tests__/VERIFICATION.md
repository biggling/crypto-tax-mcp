# cost_basis.ts — verification vs detail-design §5

_Date: 2026-06-01 · scope: `src/cost_basis.ts` against detail-design.md §5 ("Cost Basis Engine") + §15 acceptance examples._

## Verdict: §5 method semantics are correct

| §5 requirement | Implementation | Status |
|---|---|---|
| FIFO = consume oldest lots first | `selectLotsForSale` sorts ascending by `acquired_date` | ✅ |
| LIFO = consume newest lots first | sorts descending by `acquired_date` | ✅ |
| HIFO = consume highest-cost lots first | sorts descending by `cost_per_unit` | ✅ |
| Long-term = hold > 365 days | `holdingDays > LONG_TERM_DAYS (365)` | ✅ (365 exactly = short-term; matches IRS ">1yr") |
| buy/earn/airdrop → open lot | lot created for all three | ✅ |
| sell → match lots, write realized gains | per-lot gain rows, proportional fee split | ✅ |
| Partial-lot consumption across multiple lots | loop draws `min(remaining, lot)` per lot | ✅ |
| Missing buy → flagged | `MISSING_COST_BASIS` critical error | ✅ |
| Withdrawal > deposits → flagged | `NEGATIVE_BALANCE` critical error | ✅ |

13 unit tests added in `cost_basis.test.ts` cover every row above with exact expected
figures (run: `npm test`). Type-correct by inspection; execution deferred to the VPS
build host (no Node toolchain on the loop-runner).

## Findings out of §5 scope — flagged during verification

These were real correctness gaps outside "verify FIFO/LIFO/HIFO":

1. **earn/airdrop cost basis = 0** (`cost_basis.ts:30-31`). IRS treats airdrop/staking
   income as ordinary income at FMV-on-receipt, and that FMV becomes the lot's basis.
   Setting basis to 0 overstates the later capital gain (conservative — overpays tax —
   but wrong). Should use `tx.price_usd` as the lot basis for `earn`/`airdrop`.
   **✅ FIXED 2026-06-01** — basis now `tx.price_usd ?? 0` for all of buy/earn/airdrop;
   covered by test "earn/airdrop lot uses FMV-on-receipt as cost basis".
2. **Transfer linking not implemented** (§5 transfer-linking heuristic). `transfer_in`
   with no price just adds to balance; it neither opens a lot nor carries basis from a
   matching `transfer_out`. A cross-exchange `transfer_in → sell` therefore trips a false
   `MISSING_COST_BASIS`. This is the Phase-2c cross-exchange feature; tracked separately.
3. **Spurious zero-qty gain rows.** `selectLotsForSale` does not skip fully-consumed lots
   (`quantity_remaining === 0`); they get pushed with `qty = 0`, producing empty
   `RealizedGain` rows on later sells. Harmless to totals (0 proceeds / 0 basis) but noisy.
   **✅ FIXED 2026-06-01** — `if (lot.quantity_remaining <= 0) continue;` added to the
   selection loop; covered by test "fully-consumed lots produce no spurious zero-qty gain rows".
4. **Dead local** `proceeds` (`cost_basis.ts:68`) is computed but unused — `proceedsPerLot`
   is the value actually applied. Minor cleanup; left for a cosmetic pass.

Findings #1 and #3 (both tax-number-affecting) are now fixed. #2 is covered by the
Phase-2c transfer-linking work; #4 is cosmetic.
