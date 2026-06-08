// Generic CSV parser — the documented fallback.
// Requires columns: date, type, coin, quantity (+ optional price_usd, fee_usd, exchange).
import type { CSVParser, ParsedTx, ParseResult, ParseWarning } from "./types.js";
import { parseRows, headerIndex, getField, parseNum, toISO } from "./csv.js";
import type { TxType } from "../types.js";

const VALID_TYPES = new Set<TxType>([
  "buy",
  "sell",
  "transfer_in",
  "transfer_out",
  "earn",
  "airdrop",
]);

function mapType(raw: string): TxType | undefined {
  const t = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (VALID_TYPES.has(t as TxType)) return t as TxType;
  if (t === "deposit" || t === "receive") return "transfer_in";
  if (t === "withdraw" || t === "withdrawal" || t === "send") return "transfer_out";
  if (t === "reward" || t === "staking" || t === "interest") return "earn";
  return undefined;
}

export const genericParser: CSVParser = {
  name: "generic",

  detect(header: string[]): boolean {
    const lower = header.map((h) => h.toLowerCase());
    return (
      lower.includes("date") &&
      lower.includes("type") &&
      lower.includes("coin") &&
      lower.includes("quantity")
    );
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
      const date = toISO(getField(row, idx, "date"));
      const typeRaw = getField(row, idx, "type") ?? "";
      const coin = (getField(row, idx, "coin", "asset", "symbol") ?? "")
        .trim()
        .toUpperCase();
      const qty = parseNum(getField(row, idx, "quantity", "amount"));

      if (!coin) {
        warnings.push({ row: rowNum, message: "Missing coin" });
        continue;
      }
      if (!date) {
        warnings.push({ row: rowNum, message: `Unparseable date for ${coin}` });
        continue;
      }
      const type = mapType(typeRaw);
      if (!type) {
        warnings.push({ row: rowNum, message: `Unsupported type: '${typeRaw}'` });
        continue;
      }
      if (qty == null || qty === 0) {
        warnings.push({ row: rowNum, message: `Missing or zero quantity for ${coin}` });
        continue;
      }
      transactions.push({
        date,
        type,
        coin_id: coin,
        quantity: Math.abs(qty),
        price_usd: parseNum(getField(row, idx, "price_usd", "price")),
        fee_usd: parseNum(getField(row, idx, "fee_usd", "fee")),
        exchange: getField(row, idx, "exchange") || undefined,
        tx_hash: getField(row, idx, "tx_hash") || undefined,
      });
    }
    return { transactions, warnings };
  },
};
