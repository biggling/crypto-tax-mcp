// Kraken ledgers CSV export parser.
// Header: txid,refid,time,type,subtype,aclass,asset,amount,fee,balance
import type { CSVParser, ParsedTx, ParseResult, ParseWarning } from "./types.js";
import { parseRows, headerIndex, getField, parseNum, toISO } from "./csv.js";
import type { TxType } from "../types.js";

const FIAT = new Set(["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "JPY"]);

// Normalize Kraken asset codes: XXBT/XBT→BTC, XETH→ETH, ZUSD→USD, etc.
export function normalizeAsset(raw: string): string {
  let a = raw.trim().toUpperCase();
  // Kraken appends staking suffixes e.g. ETH2.S, DOT.S, ETH.M
  a = a.replace(/\.(S|M|P|F|B)$/i, "");
  if (a === "XXBT" || a === "XBT") return "BTC";
  if (a === "XETH") return "ETH";
  if (a === "XXDG" || a === "XDG") return "DOGE";
  if (a === "ZUSD") return "USD";
  if (a === "ZEUR") return "EUR";
  if (a === "ZGBP") return "GBP";
  if (a === "ZCAD") return "CAD";
  if (a === "ZAUD") return "AUD";
  if (a === "ZJPY") return "JPY";
  // Generic 4-char X/Z prefixed codes (legacy Kraken asset naming)
  if (a.length === 4 && (a[0] === "X" || a[0] === "Z")) {
    return a.slice(1);
  }
  return a;
}

function mapType(rawType: string, amount: number): TxType | undefined {
  const t = rawType.trim().toLowerCase();
  if (t === "trade" || t === "spend" || t === "receive" || t === "margin")
    return amount >= 0 ? "buy" : "sell";
  if (t === "deposit") return "transfer_in";
  if (t === "withdrawal") return "transfer_out";
  if (t === "staking" || t === "earn" || t === "reward") return "earn";
  if (t === "airdrop") return "airdrop";
  if (t === "transfer") return amount >= 0 ? "transfer_in" : "transfer_out";
  if (t === "dividend") return "earn";
  return undefined;
}

export const krakenParser: CSVParser = {
  name: "kraken",

  detect(header: string[]): boolean {
    const lower = header.map((h) => h.toLowerCase());
    const has = (s: string) => lower.includes(s);
    return has("txid") && has("refid") && has("aclass");
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
      // Skip blank ledger rows (Kraken emits some rows with empty txid).
      const txid = getField(row, idx, "txid") ?? "";
      const assetRaw = getField(row, idx, "asset") ?? "";
      const amount = parseNum(getField(row, idx, "amount"));
      const typeRaw = getField(row, idx, "type") ?? "";
      const date = toISO(getField(row, idx, "time", "date"));

      if (!assetRaw) {
        warnings.push({ row: rowNum, message: "Missing asset" });
        continue;
      }
      const coin = normalizeAsset(assetRaw);
      if (FIAT.has(coin)) {
        warnings.push({ row: rowNum, message: `Skipped fiat row: ${coin}` });
        continue;
      }
      if (amount == null || amount === 0) {
        warnings.push({ row: rowNum, message: `Missing or zero amount for ${coin}` });
        continue;
      }
      const type = mapType(typeRaw, amount);
      if (!type) {
        warnings.push({ row: rowNum, message: `Unsupported ledger type: '${typeRaw}'` });
        continue;
      }
      if (!date) {
        warnings.push({ row: rowNum, message: `Unparseable time for ${coin}` });
        continue;
      }
      const fee = parseNum(getField(row, idx, "fee"));
      transactions.push({
        date,
        type,
        coin_id: coin,
        quantity: Math.abs(amount),
        fee_usd: fee,
        exchange: "Kraken",
        tx_hash: txid || undefined,
      });
    }
    return { transactions, warnings };
  },
};
