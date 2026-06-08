// Dependency-free CSV utilities.
// Handles quoted fields containing commas, escaped quotes ("") and CRLF.

/** Tokenize a single CSV line into fields, honoring double-quoted fields. */
export function tokenizeLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

/**
 * Split CSV content into non-empty rows of tokens.
 * Records can span multiple physical lines if a quoted field contains a newline.
 */
export function parseRows(content: string): string[][] {
  const rows: string[][] = [];
  // Normalize line endings, then walk character by character so that
  // newlines inside quoted fields are preserved within a single record.
  const text = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let record = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // toggle, but account for escaped quotes ("") which stay inside
      if (inQuotes && text[i + 1] === '"') {
        record += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      record += ch;
    } else if (ch === "\n" && !inQuotes) {
      if (record.trim()) rows.push(tokenizeLine(record));
      record = "";
    } else {
      record += ch;
    }
  }
  if (record.trim()) rows.push(tokenizeLine(record));
  return rows;
}

/** Normalize a numeric string, stripping currency symbols, commas, and whitespace. */
export function parseNum(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const cleaned = raw.replace(/[$,\s]/g, "").replace(/[^0-9eE+.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "+") return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/** Normalize a date string to ISO 8601 (UTC). Returns undefined if unparseable. */
export function toISO(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  // Binance/Kraken style "YYYY-MM-DD HH:MM:SS" (UTC) → make it ISO.
  const spaceMatch = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?Z?$/.exec(s);
  if (spaceMatch) {
    const ms = spaceMatch[7] ?? "";
    return `${spaceMatch[1]}-${spaceMatch[2]}-${spaceMatch[3]}T${spaceMatch[4]}:${spaceMatch[5]}:${spaceMatch[6]}${ms}Z`;
  }
  // Date-only
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00Z`;
  // Unix epoch seconds (Kraken sometimes exports numeric time)
  if (/^\d{9,10}(\.\d+)?$/.test(s)) {
    const d = new Date(Number(s) * 1000);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  // Fall back to Date parsing (handles ISO + many locale formats)
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();
  return undefined;
}

/** Build a case-insensitive header → index lookup. */
export function headerIndex(header: string[]): Map<string, number> {
  const m = new Map<string, number>();
  header.forEach((h, i) => {
    const key = h.trim().toLowerCase();
    if (!m.has(key)) m.set(key, i);
  });
  return m;
}

/** Look up a value by any of the given case-insensitive header names. */
export function getField(
  row: string[],
  idx: Map<string, number>,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const i = idx.get(name.toLowerCase());
    if (i != null && i < row.length) return row[i];
  }
  return undefined;
}
