// Shared parser contract for CSV exchange imports.
// Adapts the documented detail-design.md §6 contract to this codebase (ESM).
import type { TxType } from "../types.js";

export interface ParsedTx {
  date: string; // normalized ISO 8601
  type: TxType; // mapped to buy|sell|transfer_in|transfer_out|earn|airdrop
  coin_id: string; // uppercase symbol (e.g. "BTC")
  quantity: number; // always positive
  price_usd?: number; // FMV / spot at event if present in the row
  fee_usd?: number;
  exchange?: string;
  tx_hash?: string;
  notes?: string;
}

export interface ParseWarning {
  row: number;
  message: string;
}

export interface ParseResult {
  transactions: ParsedTx[];
  warnings: ParseWarning[];
}

export interface CSVParser {
  name: string;
  detect(headerRow: string[]): boolean;
  parse(csvContent: string): ParseResult;
}
