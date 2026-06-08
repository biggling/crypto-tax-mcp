import Database from "better-sqlite3";
import { createHash, randomBytes } from "crypto";
import { mkdirSync } from "fs";
import { dirname } from "path";

const DB_PATH = process.env.DB_PATH ?? "./data/tax.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    key_hash   TEXT PRIMARY KEY,
    tier       TEXT NOT NULL DEFAULT 'free',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    type       TEXT NOT NULL,
    coin_id    TEXT NOT NULL,
    quantity   REAL NOT NULL,
    price_usd  REAL,
    fee_usd    REAL,
    date       TEXT NOT NULL,
    exchange   TEXT,
    wallet     TEXT,
    tx_hash    TEXT,
    source     TEXT NOT NULL DEFAULT 'manual',
    notes      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_txn_user_date ON transactions(user_id, date);
  CREATE INDEX IF NOT EXISTS idx_txn_user_coin ON transactions(user_id, coin_id);
  CREATE INDEX IF NOT EXISTS idx_txn_user_type ON transactions(user_id, type);

  CREATE TABLE IF NOT EXISTS cost_lots (
    id                 TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL,
    buy_tx_id          TEXT NOT NULL,
    coin_id            TEXT NOT NULL,
    quantity_remaining REAL NOT NULL,
    cost_basis_usd     REAL NOT NULL,
    acquired_date      TEXT NOT NULL,
    exchange           TEXT,
    closed_at          TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_lots_user_coin ON cost_lots(user_id, coin_id);
  CREATE INDEX IF NOT EXISTS idx_lots_open     ON cost_lots(user_id, coin_id, closed_at);

  CREATE TABLE IF NOT EXISTS realized_gains (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    sell_tx_id      TEXT NOT NULL,
    buy_tx_id       TEXT NOT NULL,
    coin_id         TEXT NOT NULL,
    quantity        REAL NOT NULL,
    proceeds_usd    REAL NOT NULL,
    cost_basis_usd  REAL NOT NULL,
    gain_loss_usd   REAL NOT NULL,
    is_long_term    INTEGER NOT NULL,
    sell_date       TEXT NOT NULL,
    buy_date        TEXT NOT NULL,
    method          TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_gains_user_year ON realized_gains(user_id, sell_date);
`);

// ── Shared types ──────────────────────────────────────────────────────────────

export type Tier = "free" | "pro" | "tax";
export type TxType =
  | "buy"
  | "sell"
  | "transfer_in"
  | "transfer_out"
  | "earn"
  | "airdrop";
export type CostMethod = "fifo" | "lifo" | "hifo";
export type TxSource = "csv" | "manual" | "ccxt";

export interface TxRow {
  id: string;
  user_id: string;
  type: TxType;
  coin_id: string;
  quantity: number;
  price_usd: number | null;
  fee_usd: number | null;
  date: string; // ISO 8601
  exchange: string | null;
  wallet: string | null;
  tx_hash: string | null;
  source: TxSource;
  notes: string | null;
}

export interface LotRow {
  id: string;
  user_id: string;
  buy_tx_id: string;
  coin_id: string;
  quantity_remaining: number;
  cost_basis_usd: number; // per-unit basis
  acquired_date: string;
  exchange: string | null;
  closed_at: string | null;
}

export interface GainRow {
  id: string;
  user_id: string;
  sell_tx_id: string;
  buy_tx_id: string;
  coin_id: string;
  quantity: number;
  proceeds_usd: number;
  cost_basis_usd: number;
  gain_loss_usd: number;
  is_long_term: number; // 1 = long-term (>365 days)
  sell_date: string;
  buy_date: string;
  method: CostMethod;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function generateApiKey(): string {
  return randomBytes(24).toString("hex"); // 48-char hex
}

export function validateKey(rawKey: string): { valid: boolean; tier: Tier } {
  const row = db
    .prepare("SELECT tier FROM api_keys WHERE key_hash = ?")
    .get(hashKey(rawKey)) as { tier: Tier } | undefined;
  return row ? { valid: true, tier: row.tier } : { valid: false, tier: "free" };
}

export function createKey(tier: Tier = "free"): string {
  const key = generateApiKey();
  db.prepare("INSERT INTO api_keys (key_hash, tier) VALUES (?, ?)").run(
    hashKey(key),
    tier
  );
  return key;
}

export function getUserId(rawKey: string): string {
  return hashKey(rawKey);
}

// Update tier in-place (used by Polar webhook on upgrade/downgrade).
// Takes key_hash, not raw key — we never re-expose stored hashes.
export function updateKeyTier(keyHash: string, tier: Tier): void {
  db.prepare("UPDATE api_keys SET tier = ? WHERE key_hash = ?").run(tier, keyHash);
}

// Soft-delete on subscription cancellation. User data (transactions, lots)
// is NOT deleted — they can re-subscribe and resume where they left off.
export function revokeKey(keyHash: string): void {
  db.prepare("DELETE FROM api_keys WHERE key_hash = ?").run(keyHash);
}

// ── Polar subscription tracking ───────────────────────────────────────────────
// Maps Polar subscription IDs → key_hash so we can update/revoke on lifecycle events.

export function initPolarSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS polar_subscriptions (
      polar_sub_id  TEXT PRIMARY KEY,
      key_hash      TEXT NOT NULL,
      tier          TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function getPolarSub(
  subId: string
): { key_hash: string; tier: string } | undefined {
  return db
    .prepare("SELECT key_hash, tier FROM polar_subscriptions WHERE polar_sub_id = ?")
    .get(subId) as { key_hash: string; tier: string } | undefined;
}

export function insertPolarSub(subId: string, keyHash: string, tier: Tier): void {
  db
    .prepare(
      "INSERT INTO polar_subscriptions (polar_sub_id, key_hash, tier) VALUES (?, ?, ?)"
    )
    .run(subId, keyHash, tier);
}

export function updatePolarSubTier(subId: string, tier: Tier): void {
  db
    .prepare("UPDATE polar_subscriptions SET tier = ? WHERE polar_sub_id = ?")
    .run(tier, subId);
}

export function deletePolarSub(subId: string): void {
  db.prepare("DELETE FROM polar_subscriptions WHERE polar_sub_id = ?").run(subId);
}

// ── Transactions ──────────────────────────────────────────────────────────────

export function insertTransaction(tx: TxRow): void {
  db.prepare(`
    INSERT INTO transactions
      (id, user_id, type, coin_id, quantity, price_usd, fee_usd,
       date, exchange, wallet, tx_hash, source, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tx.id,
    tx.user_id,
    tx.type,
    tx.coin_id,
    tx.quantity,
    tx.price_usd ?? null,
    tx.fee_usd ?? null,
    tx.date,
    tx.exchange ?? null,
    tx.wallet ?? null,
    tx.tx_hash ?? null,
    tx.source,
    tx.notes ?? null
  );
}

export function getTxsByUser(
  userId: string,
  opts: {
    year?: number;
    type?: TxType;
    coin_id?: string;
    exchange?: string;
    limit?: number;
    offset?: number;
  } = {}
): TxRow[] {
  const clauses: string[] = ["user_id = ?"];
  const params: (string | number)[] = [userId];
  if (opts.year) {
    clauses.push("strftime('%Y', date) = ?");
    params.push(String(opts.year));
  }
  if (opts.type) {
    clauses.push("type = ?");
    params.push(opts.type);
  }
  if (opts.coin_id) {
    clauses.push("coin_id = ?");
    params.push(opts.coin_id);
  }
  if (opts.exchange) {
    clauses.push("exchange = ?");
    params.push(opts.exchange);
  }
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  return db
    .prepare(
      `SELECT * FROM transactions WHERE ${clauses.join(" AND ")} ORDER BY date DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as TxRow[];
}

export function countTxsByUser(userId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) as n FROM transactions WHERE user_id = ?")
    .get(userId) as { n: number };
  return row.n;
}

export function countExchangesByUser(userId: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(DISTINCT exchange) as n FROM transactions WHERE user_id = ? AND exchange IS NOT NULL"
    )
    .get(userId) as { n: number };
  return row.n;
}

// Deduplicate: match by tx_hash first, then by (date, coin, quantity, exchange)
export function txExists(
  userId: string,
  tx: Pick<TxRow, "tx_hash" | "date" | "coin_id" | "quantity" | "exchange">
): boolean {
  if (tx.tx_hash) {
    const r = db
      .prepare(
        "SELECT 1 FROM transactions WHERE user_id = ? AND tx_hash = ?"
      )
      .get(userId, tx.tx_hash);
    if (r) return true;
  }
  const r = db
    .prepare(
      "SELECT 1 FROM transactions WHERE user_id = ? AND date = ? AND coin_id = ? AND quantity = ? AND exchange IS ?"
    )
    .get(userId, tx.date, tx.coin_id, tx.quantity, tx.exchange ?? null);
  return !!r;
}

// ── Cost lots ─────────────────────────────────────────────────────────────────

export function clearUserLots(userId: string): void {
  db.prepare("DELETE FROM cost_lots WHERE user_id = ?").run(userId);
}

export function insertLot(lot: LotRow): void {
  db.prepare(`
    INSERT INTO cost_lots
      (id, user_id, buy_tx_id, coin_id, quantity_remaining,
       cost_basis_usd, acquired_date, exchange, closed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    lot.id,
    lot.user_id,
    lot.buy_tx_id,
    lot.coin_id,
    lot.quantity_remaining,
    lot.cost_basis_usd,
    lot.acquired_date,
    lot.exchange ?? null,
    lot.closed_at ?? null
  );
}

export function getOpenLots(userId: string, coinId: string): LotRow[] {
  // Returns open lots ordered ascending by acquired_date (FIFO default order)
  return db
    .prepare(
      "SELECT * FROM cost_lots WHERE user_id = ? AND coin_id = ? AND closed_at IS NULL ORDER BY acquired_date ASC"
    )
    .all(userId, coinId) as LotRow[];
}

export function getAllOpenLotsByCoin(
  userId: string
): Record<string, LotRow[]> {
  const rows = db
    .prepare(
      "SELECT * FROM cost_lots WHERE user_id = ? AND closed_at IS NULL ORDER BY coin_id, acquired_date ASC"
    )
    .all(userId) as LotRow[];
  return rows.reduce<Record<string, LotRow[]>>((acc, r) => {
    (acc[r.coin_id] ??= []).push(r);
    return acc;
  }, {});
}

// ── Realized gains ────────────────────────────────────────────────────────────

export function clearUserGains(userId: string): void {
  db.prepare("DELETE FROM realized_gains WHERE user_id = ?").run(userId);
}

export function insertGain(gain: GainRow): void {
  db.prepare(`
    INSERT INTO realized_gains
      (id, user_id, sell_tx_id, buy_tx_id, coin_id, quantity,
       proceeds_usd, cost_basis_usd, gain_loss_usd, is_long_term,
       sell_date, buy_date, method)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    gain.id,
    gain.user_id,
    gain.sell_tx_id,
    gain.buy_tx_id,
    gain.coin_id,
    gain.quantity,
    gain.proceeds_usd,
    gain.cost_basis_usd,
    gain.gain_loss_usd,
    gain.is_long_term,
    gain.sell_date,
    gain.buy_date,
    gain.method
  );
}

// Realized gains for sells that occurred ON a given exchange in a given tax year,
// enriched with the exchange where the matched buy lot was acquired. Powers the
// `compare_1099da` tool: a 1099-DA is issued per-exchange, so we reconcile only
// the disposals that exchange would have reported. Exchange match is case-insensitive.
export interface GainWithSourceRow extends GainRow {
  acquired_exchange: string | null;
}

export function getGainsByExchangeYear(
  userId: string,
  exchange: string,
  year: number
): GainWithSourceRow[] {
  return db
    .prepare(
      `SELECT g.*, b.exchange AS acquired_exchange
         FROM realized_gains g
         JOIN transactions s ON s.id = g.sell_tx_id
         LEFT JOIN transactions b ON b.id = g.buy_tx_id
        WHERE g.user_id = ?
          AND LOWER(s.exchange) = LOWER(?)
          AND strftime('%Y', g.sell_date) = ?
        ORDER BY g.sell_date`
    )
    .all(userId, exchange, String(year)) as GainWithSourceRow[];
}

export function getGainsByUser(
  userId: string,
  opts: { year?: number; method?: CostMethod } = {}
): GainRow[] {
  const clauses: string[] = ["user_id = ?"];
  const params: (string | number)[] = [userId];
  if (opts.year) {
    clauses.push("strftime('%Y', sell_date) = ?");
    params.push(String(opts.year));
  }
  if (opts.method) {
    clauses.push("method = ?");
    params.push(opts.method);
  }
  return db
    .prepare(
      `SELECT * FROM realized_gains WHERE ${clauses.join(" AND ")} ORDER BY sell_date`
    )
    .all(...params) as GainRow[];
}

export default db;
