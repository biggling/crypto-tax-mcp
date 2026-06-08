import type { Request, Response, NextFunction, RequestHandler } from "express";

/** An Express request augmented by the auth middleware with the caller's identity + tier. */
export type AuthedRequest = Request & { userId: string; tier: string };

/** Per-product key store, injected so each MCP keeps its own SQLite-backed db. */
export interface AuthDeps {
  validateKey: (rawKey: string) => { valid: boolean; tier: string };
  getUserId: (rawKey: string) => string;
}

/**
 * Build a Bearer-API-key auth middleware. Parses `Authorization: Bearer <key>`,
 * 401s on missing/invalid key, else attaches `userId` + `tier` to the request.
 */
export function createAuthMiddleware({ validateKey, getUserId }: AuthDeps): RequestHandler {
  return function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    const raw = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!raw) {
      res.status(401).json({ error: "Missing Authorization header" });
      return;
    }
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
