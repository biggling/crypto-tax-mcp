// Coinbase CSV export parser.
// Real header: Timestamp, Transaction Type, Asset, Quantity Transacted,
//   Spot Price Currency, Spot Price at Transaction, Subtotal,
//   Total (inclusive of fees and/or spread), Fees and/or Spread, Notes
import type { CSVParser, ParsedTx, ParseResult, ParseWarning } from "./types.js";
import { parseRows, headerIndex, getField, parseNum, toISO } from "./csv.js";
import type { TxType } from "../types.js";

function mapType(raw: string): TxType | undefined {
  const t = raw.trim().toLowerCase();
  if (t === "buy" || t === "advanced trade buy" || t === "advance trade buy")
    return "buy";
  if (t === "sell" || t === "advanced trade sell" || t === "advance trade sell")
    return "sell";
  if (t === "send" || t === "withdrawal") return "transfer_out";
  if (t === "receive" || t === "deposit") return "transfer_in";
  if (
    t === "rewards income" ||
    t === "staking income" ||
    t === "inflation reward" ||
    t === "interest"
  )
    return "earn";
  if (
    t === "learning reward" ||
    t === "coinbase earn" ||
    t === "airdrop"
  )
    return "airdrop";
  // "Convert" is two-sided; treat as a sell of the source asset (MVP).
  if (t === "convert") return "sell";
  return undefined;
}

export const coinbaseParser: CSVParser = {
  name: "coinbase",

  detect(header: string[]): boolean {
    const lower = header.map((h) => h.toLowerCase());
    const has = (s: string) => lower.some((h) => h.includes(s));
    return (
      (has("transaction type") && has("quantity transacted")) ||
      has("spot price at transaction")
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
    // Coinbase prepends preamble lines; find the real header row.
    let headerIdx = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].some((c) => c.toLowerCase() === "transaction type")) {
        headerIdx = i;
        break;
      }
    }
    const idx = headerIndex(rows[headerIdx]);

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const rowNum = i + 1;
      const row = rows[i];
      const typeRaw = getField(row, idx, "transaction type") ?? "";
      const type = mapType(typeRaw);
      if (!type) {
        warnings.push({ row: rowNum, message: `Unsupported transaction type: '${typeRaw}'` });
        continue;
      }
      const asset = (getField(row, idx, "asset") ?? "").trim().toUpperCase();
      const qty = parseNum(getField(row, idx, "quantity transacted", "quantity"));
      const date = toISO(getField(row, idx, "timestamp", "date"));
      if (!asset) {
        warnings.push({ row: rowNum, message: "Missing asset" });
        continue;
      }
      if (qty == null || qty === 0) {
        warnings.push({ row: rowNum, message: `Missing or zero quantity for ${asset}` });
        continue;
      }
      if (!date) {
        warnings.push({ row: rowNum, message: `Unparseable date for ${asset}` });
        continue;
      }
      const price = parseNum(getField(row, idx, "spot price at transaction"));
      const fee = parseNum(getField(row, idx, "fees and/or spread", "fees", "fee"));
      const notes = getField(row, idx, "notes");
      transactions.push({
        date,
        type,
        coin_id: asset,
        quantity: Math.abs(qty),
        price_usd: price,
        fee_usd: fee,
        exchange: "Coinbase",
        notes: notes || undefined,
      });
    }
    return { transactions, warnings };
  },
};
