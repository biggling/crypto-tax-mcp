// Parser registry + dispatch helpers.
import type { CSVParser } from "./types.js";
import { coinbaseParser } from "./coinbase.js";
import { binanceParser } from "./binance.js";
import { krakenParser } from "./kraken.js";
import { genericParser } from "./generic.js";

export type { CSVParser, ParsedTx, ParseResult, ParseWarning } from "./types.js";
export { tokenizeLine, parseRows } from "./csv.js";

// Order matters for autoDetect: specific exchanges first, generic last.
export const PARSERS: CSVParser[] = [
  coinbaseParser,
  binanceParser,
  krakenParser,
  genericParser,
];

// Maps the tool's `source` enum to a concrete parser by name.
const SOURCE_MAP: Record<string, CSVParser> = {
  coinbase: coinbaseParser,
  binance: binanceParser,
  kraken: krakenParser,
  // Aggregators / manual exports use the generic columnar format.
  koinly: genericParser,
  cointracker: genericParser,
  manual: genericParser,
  generic: genericParser,
};

/** Explicit parser selection by the tool's `source` argument. */
export function getParser(source: string): CSVParser | undefined {
  return SOURCE_MAP[source.trim().toLowerCase()];
}

/** Auto-detect a parser from the header row when source is unknown/generic. */
export function autoDetect(headerRow: string[]): CSVParser | undefined {
  for (const parser of PARSERS) {
    try {
      if (parser.detect(headerRow)) return parser;
    } catch {
      // a misbehaving detect() must never abort detection
    }
  }
  return undefined;
}
