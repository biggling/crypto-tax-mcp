// Binance CSV export parser (transaction/operation history).
// Header: User_ID, UTC_Time, Account, Operation, Coin, Change, Remark
import type { CSVParser, ParsedTx, ParseResult, ParseWarning } from "./types.js";
import { parseRows, headerIndex, getField, parseNum, toISO } from "./csv.js";
import type { TxType } from "../types.js";

// Returns the mapped type. Some operations depend on the sign of Change.
function mapType(rawOp: string, change: number): TxType | undefined {
  const op = rawOp.trim().toLowerCase();
  if (op === "buy" || op === "transaction buy") return "buy";
  if (op === "sell" || op === "transaction sell") return "sell";
  if (op === "deposit" || op === "fiat deposit") return "transfer_in";
  if (op === "withdraw" || op === "withdrawal" || op === "fiat withdraw")
    return "transfer_out";
  if (
    op === "staking rewards" ||
    op === "savings interest" ||
    op === "distribution" ||
    op === "simple earn flexible interest" ||
    op === "simple earn locked rewards" ||
    op === "rewards" ||
    op === "commission rebate" ||
    op === "referral commission"
  )
    return "earn";
  if (op === "airdrop assets" || op === "airdrop") return "airdrop";
  // Generic "Transaction Related" / "Transaction Spend"/"Transaction Revenue":
  // use sign to infer direction of a trade leg.
  if (op === "transaction related" || op === "transaction spend") {
    return change >= 0 ? "buy" : "sell";
  }
  if (op === "transaction revenue") return change >= 0 ? "buy" : "sell";
  return undefined;
}

export const binanceParser: CSVParser = {
  name: "binance",

  detect(header: string[]): boolean {
    const lower = header.map((h) => h.toLowerCase());
    const has = (s: string) => lower.some((h) => h === s || h.includes(s));
    return has("utc_time") && has("operation") && has("coin");
  },

  parse(content: string): ParseResult {
    const rows = parseRows(content);
    const transactions: ParsedTx[] = [];
    const warnings: ParseWarning[] = [];
    if (rows.length < 2) {
      warnings.push({ row: 0, message: "Empty CSV (no data rows)" });
      return { transactions, warnings };
    }
    const idx = headerIndex(rows[0]);

    for (let i = 1; i < rows.length; i++) {
      const rowNum = i + 1;
      const row = rows[i];
      const coin = (getField(row, idx, "coin") ?? "").trim().toUpperCase();
      const changeRaw = getField(row, idx, "change");
      const change = parseNum(changeRaw);
      const opRaw = getField(row, idx, "operation") ?? "";
      const date = toISO(getField(row, idx, "utc_time", "time", "date"));

      if (!coin) {
        warnings.push({ row: rowNum, message: "Missing coin" });
        continue;
      }
      if (change == null || change === 0) {
        warnings.push({ row: rowNum, message: `Missing or zero Change for ${coin}` });
        continue;
      }
      const type = mapType(opRaw, change);
      if (!type) {
        warnings.push({ row: rowNum, message: `Unsupported operation: '${opRaw}'` });
        continue;
      }
      if (!date) {
        warnings.push({ row: rowNum, message: `Unparseable UTC_Time for ${coin}` });
        continue;
      }
      const remark = getField(row, idx, "remark");
      transactions.push({
        date,
        type,
        coin_id: coin,
        quantity: Math.abs(change),
        exchange: "Binance",
        notes: remark || undefined,
      });
    }
    return { transactions, warnings };
  },
};
