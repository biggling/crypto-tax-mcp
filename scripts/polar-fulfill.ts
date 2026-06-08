#!/usr/bin/env node
// Recovery: re-key a Polar subscription when the initial webhook delivery failed.
//
// Use when:
//   1. subscription.created webhook fired → key provisioned in DB ✓
//   2. fulfillSubscription() PATCH to Polar API failed (logs show the error)
//   3. Subscriber can't see their key in the Polar customer portal
//
// What this script does:
//   - Revokes the old (never-seen) key for the subscription
//   - Generates a fresh key at the same tier
//   - Updates both api_keys and polar_subscriptions tables
//   - PATCHes the new key into Polar subscription metadata
//   - Prints the raw key to stdout (one-time; immediately available in portal)
//
// Usage (from products/1_crypto-tax/):
//   node --experimental-strip-types scripts/polar-fulfill.ts --sub-id <polar_sub_id>
//
// Required env:
//   POLAR_API_TOKEN   — Polar Dashboard → Settings → Developers → API Tokens
//   DB_PATH           — defaults to ./data/tax.db

import { createHash, randomBytes } from "crypto";
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";

// ── Minimal DB helpers (no full db.ts import to avoid side-effects) ───────────

const DB_PATH = process.env.DB_PATH ?? "./data/tax.db";
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

type Tier = "free" | "pro" | "tax";

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function generateKey(): string {
  return randomBytes(24).toString("hex"); // 48-char hex
}

function getPolarSub(subId: string): { key_hash: string; tier: Tier } | undefined {
  return db
    .prepare("SELECT key_hash, tier FROM polar_subscriptions WHERE polar_sub_id = ?")
    .get(subId) as { key_hash: string; tier: Tier } | undefined;
}

function rekeySubscription(subId: string, oldHash: string, tier: Tier): string {
  const rawKey = generateKey();
  const newHash = hashKey(rawKey);
  db.transaction(() => {
    db.prepare("DELETE FROM api_keys WHERE key_hash = ?").run(oldHash);
    db.prepare("INSERT INTO api_keys (key_hash, tier) VALUES (?, ?)").run(newHash, tier);
    db.prepare(
      "UPDATE polar_subscriptions SET key_hash = ? WHERE polar_sub_id = ?"
    ).run(newHash, subId);
  })();
  return rawKey;
}

// ── Polar API PATCH ───────────────────────────────────────────────────────────

async function patchPolarMetadata(subId: string, rawKey: string): Promise<void> {
  const token = process.env.POLAR_API_TOKEN;
  if (!token) {
    throw new Error("POLAR_API_TOKEN is not set. Export it before running this script.");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await fetch(`https://api.polar.sh/v1/subscriptions/${subId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ metadata: { api_key: rawKey } }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`Polar API ${r.status}: ${body.slice(0, 300)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subIdIdx = args.indexOf("--sub-id");
  const subId = subIdIdx !== -1 ? args[subIdIdx + 1] : undefined;

  if (!subId) {
    console.error("Usage: node --experimental-strip-types scripts/polar-fulfill.ts --sub-id <sub_id>");
    process.exit(1);
  }

  const row = getPolarSub(subId);
  if (!row) {
    console.error(`No subscription found for ${subId} in polar_subscriptions.`);
    console.error("Check the sub ID or verify the webhook ran successfully first.");
    process.exit(1);
  }

  console.log(`Found subscription ${subId} — tier: ${row.tier}, old key_hash: ${row.key_hash.slice(0, 8)}...`);

  const rawKey = rekeySubscription(subId, row.key_hash, row.tier);
  console.log(`Re-keyed: new key provisioned in DB.`);

  try {
    await patchPolarMetadata(subId, rawKey);
    console.log(`✓ Polar metadata updated — subscriber can now see key in their portal.`);
  } catch (err) {
    console.error(`✗ Polar PATCH failed: ${err}`);
    console.error(`The new key is valid in DB but NOT visible in the Polar portal.`);
    console.error(`New raw key (one-time): ${rawKey}`);
    console.error(`Send to subscriber manually, then re-run once POLAR_API_TOKEN is correct.`);
    process.exit(1);
  }

  // Print key for ops record — subscriber sees it in their portal too
  console.log(`\nNew API key (record for support, one-time display):\n  ${rawKey}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
