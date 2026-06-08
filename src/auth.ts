import type { Request, Response, NextFunction, RequestHandler } from "express";
import { createHash } from "crypto";

/** An Express request augmented by the auth middleware with the caller's identity + tier. */
export type AuthedRequest = Request & { userId: string; tier: string };

/** Per-product key store, injected so each MCP keeps its own SQLite-backed db. */
export interface AuthDeps {
  validateKey: (rawKey: string) => { valid: boolean; tier: string };
  getUserId: (rawKey: string) => string;
  /**
   * Optional MCPize upstream token. When set, presenting this token as the Bearer
   * lets MCPize's proxy forward buyer calls. The buyer's identity arrives via
   * X-MCPize-Customer-Id and tier via X-MCPize-Tier — both signed by MCPize.
   * Direct (non-proxy) buyer requests still flow through validateKey/getUserId.
   */
  upstreamToken?: string;
}

const ALLOWED_TIERS = new Set(["free", "pro", "tax"]);

/**
 * Build a Bearer-API-key auth middleware. Two paths:
 *  1. MCPize proxy: Authorization matches the upstream master token →
 *     derive userId from X-MCPize-Customer-Id; tier from X-MCPize-Tier.
 *  2. Direct buyer: Authorization is the buyer's own key →
 *     validateKey() + getUserId() (existing path).
 * 401s on missing/invalid in either path. Always attaches `userId` + `tier`.
 */
export function createAuthMiddleware({
  validateKey,
  getUserId,
  upstreamToken,
}: AuthDeps): RequestHandler {
  return function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    const raw = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!raw) {
      res.status(401).json({ error: "Missing Authorization header" });
      return;
    }

    // MCPize proxy path
    if (upstreamToken && raw === upstreamToken) {
      const customerId = req.header("x-mcpize-customer-id");
      if (!customerId) {
        res.status(401).json({
          error:
            "Authenticated as upstream proxy but missing X-MCPize-Customer-Id header",
        });
        return;
      }
      // user_id format matches the direct-buyer path (SHA-256 hex)
      // namespaced so MCPize customers can never collide with direct keys.
      (req as AuthedRequest).userId = createHash("sha256")
        .update(`mcpize:${customerId}`)
        .digest("hex");
      const rawTier = (req.header("x-mcpize-tier") || "free").toLowerCase();
      (req as AuthedRequest).tier = ALLOWED_TIERS.has(rawTier) ? rawTier : "free";
      next();
      return;
    }

    // Direct buyer path
    const { valid, tier } = validateKey(raw);
    if (!valid) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }
    (req as AuthedRequest).userId = getUserId(raw);
    (req as AuthedRequest).tier = tier;
    next();
  };
}
