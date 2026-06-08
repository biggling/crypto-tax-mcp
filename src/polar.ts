// Polar.sh subscription webhook — provision, upgrade, downgrade, revoke API keys.
//
// Polar fires Standard Webhooks-signed events on subscription lifecycle changes.
// We verify the signature, map product_id → tier, then create/update/revoke the
// key in SQLite. User transaction data is never deleted on cancellation so they
// can re-subscribe without re-importing.
//
// Required env vars (VPS .env / systemd EnvironmentFile):
//   POLAR_WEBHOOK_SECRET   — base64 secret from Polar dashboard (whsec_...)
//   POLAR_PRODUCT_PRO      — Polar product ID for the $19/mo Pro plan
//   POLAR_PRODUCT_TAX      — Polar product ID for the $49/mo Tax plan
//
// Endpoint wired in server.ts: POST /webhooks/polar (no Bearer — auth is signature)
// Key delivery: after provisioning, PATCH /subscriptions/{id}/metadata via Polar
//   API to attach the key so the user sees it in their Polar customer portal.
//   See scripts/polar-fulfill.ts for the fulfillment helper.

import type { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import type { Tier } from "./db.js";
import {
  createKey,
  hashKey,
  updateKeyTier,
  revokeKey,
  initPolarSchema,
  getPolarSub,
  insertPolarSub,
  updatePolarSubTier,
  deletePolarSub,
} from "./db.js";

export { initPolarSchema };

// Reject events older/newer than 5 minutes (replay protection)
const TIMESTAMP_TOLERANCE_SEC = 5 * 60;

// ── Polar API key delivery ────────────────────────────────────────────────────
// PATCH the subscriber's portal metadata so they see the key in the Polar
// customer portal immediately after checkout. Non-blocking: always logs,
// never throws. If POLAR_API_TOKEN is unset, logs a warning and skips.
// Recovery: run scripts/polar-fulfill.ts to re-key a subscription manually.
async function fulfillSubscription(subId: string, rawKey: string): Promise<void> {
  const token = process.env.POLAR_API_TOKEN;
  if (!token) {
    console.warn(
      `polar: POLAR_API_TOKEN not set — key for ${subId} NOT delivered to portal. ` +
        `Run scripts/polar-fulfill.ts after setting the token.`
    );
    return;
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
    if (r.ok) {
      console.log(`polar: delivered key to subscriber ${subId} via portal metadata`);
    } else {
      const text = await r.text().catch(() => "");
      console.error(
        `polar: key delivery PATCH failed ${r.status} for ${subId} — ${text.slice(0, 200)}`
      );
    }
  } catch (err) {
    console.error(`polar: key delivery error for ${subId}:`, err);
  } finally {
    clearTimeout(timer);
  }
}

// ── Signature verification (Standard Webhooks spec) ───────────────────────────

function verifySignature(req: Request, rawBody: Buffer, secret: string): boolean {
  const msgId = req.headers["webhook-id"] as string | undefined;
  const msgTs = req.headers["webhook-timestamp"] as string | undefined;
  const msgSig = req.headers["webhook-signature"] as string | undefined;
  if (!msgId || !msgTs || !msgSig) return false;

  const tsNum = Number(msgTs);
  if (!Number.isFinite(tsNum)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > TIMESTAMP_TOLERANCE_SEC) return false;

  // secret may arrive as "whsec_<base64>" or raw base64
  const secretBytes = Buffer.from(
    secret.startsWith("whsec_") ? secret.slice(6) : secret,
    "base64"
  );
  const toSign = `${msgId}.${msgTs}.${rawBody.toString()}`;
  const computed = createHmac("sha256", secretBytes).update(toSign).digest("base64");

  // Polar may send space-separated multi-signatures; accept if any matches
  for (const sig of msgSig.split(" ")) {
    const candidate = sig.includes(",") ? sig.split(",")[1] : sig;
    try {
      if (
        timingSafeEqual(
          Buffer.from(computed, "base64"),
          Buffer.from(candidate, "base64")
        )
      )
        return true;
    } catch {
      // Buffer length mismatch — not a match, continue
    }
  }
  return false;
}

// ── Product → tier mapping ────────────────────────────────────────────────────

function productToTier(productId: string): Tier | null {
  if (productId === process.env.POLAR_PRODUCT_TAX) return "tax";
  if (productId === process.env.POLAR_PRODUCT_PRO) return "pro";
  return null; // unknown product — log and skip
}

// ── Event payload shape ───────────────────────────────────────────────────────

interface PolarSubEvent {
  type: string;
  data: {
    id: string;          // subscription id (stable across upgrades)
    product_id: string;
    status: string;      // "active" | "canceled" | "past_due" | ...
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

// server.ts must capture rawBody before JSON parsing:
//   app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
// Then mount: app.post("/webhooks/polar", handlePolarWebhook)

export async function handlePolarWebhook(req: Request, res: Response): Promise<void> {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    console.error("POLAR_WEBHOOK_SECRET not configured");
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }

  const rawBody: Buffer = (req as Request & { rawBody: Buffer }).rawBody;
  if (!rawBody || !verifySignature(req, rawBody, secret)) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  const event = req.body as PolarSubEvent;
  const subId = event.data.id;
  const productId = event.data.product_id;

  try {
    switch (event.type) {
      case "subscription.created": {
        const tier = productToTier(productId);
        if (!tier) {
          console.warn(`polar: unknown product_id ${productId}, skipping`);
          res.status(200).json({ ok: true, skipped: "unknown_product" });
          return;
        }
        // Idempotent: if we already have a key for this subscription, don't double-provision
        if (getPolarSub(subId)) {
          res.status(200).json({ ok: true, skipped: "already_provisioned" });
          return;
        }
        const rawKey = createKey(tier);
        insertPolarSub(subId, hashKey(rawKey), tier);
        console.log(`polar: provisioned ${tier} key for subscription ${subId}`);
        res.status(200).json({ ok: true, tier, provisioned: true });
        // Fire-and-forget: deliver to portal after 200 is queued.
        // rawKey is only available now; if PATCH fails → run scripts/polar-fulfill.ts.
        void fulfillSubscription(subId, rawKey);
        break;
      }

      case "subscription.updated": {
        // Fired on plan upgrade ($19 → $49), downgrade ($49 → $19), or renewal
        const newTier = productToTier(productId);
        if (!newTier) {
          res.status(200).json({ ok: true, skipped: "unknown_product" });
          return;
        }
        const row = getPolarSub(subId);
        if (!row) {
          console.warn(`polar: subscription.updated — no key found for ${subId}`);
          res.status(200).json({ ok: true, skipped: "not_found" });
          return;
        }
        if (row.tier !== newTier) {
          updateKeyTier(row.key_hash, newTier);
          updatePolarSubTier(subId, newTier);
          console.log(`polar: ${subId} tier ${row.tier} → ${newTier}`);
        }
        res.status(200).json({ ok: true, tier: newTier });
        break;
      }

      case "subscription.canceled":
      case "subscription.revoked": {
        const row = getPolarSub(subId);
        if (!row) {
          res.status(200).json({ ok: true, skipped: "not_found" });
          return;
        }
        // Revoke auth; keep user transaction data (they may re-subscribe)
        revokeKey(row.key_hash);
        deletePolarSub(subId);
        console.log(`polar: revoked key for subscription ${subId}`);
        res.status(200).json({ ok: true, revoked: true });
        break;
      }

      default:
        // Many Polar event types we don't handle (order.*, benefit.*, etc.)
        res.status(200).json({ ok: true, skipped: event.type });
    }
  } catch (err) {
    console.error("polar webhook error:", err);
    res.status(500).json({ error: "Internal error" });
  }
}
