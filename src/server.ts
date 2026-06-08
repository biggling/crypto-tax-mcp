import "node:process";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { validateKey, getUserId } from "./db.js";
import { createAuthMiddleware, type AuthedRequest } from "./auth.js";
import { registerTools } from "./tools.js";
import { initPolarSchema, handlePolarWebhook } from "./polar.js";

const PORT = Number(process.env.PORT ?? 3001);

const app = express();
// Capture raw body for Polar webhook HMAC verification before JSON parsing
app.use(
  express.json({
    verify: (req: express.Request, _res, buf) => {
      (req as express.Request & { rawBody: Buffer }).rawBody = buf;
    },
  })
);

// Ensure polar_subscriptions table exists (idempotent)
initPolarSchema();

const authMiddleware = createAuthMiddleware({
  validateKey,
  getUserId,
  upstreamToken: process.env.MCPIZE_UPSTREAM_TOKEN,
});

app.post("/mcp", authMiddleware, async (req, res) => {
  const { userId, tier } = req as AuthedRequest;
  const mcpServer = new McpServer({ name: "crypto-tax", version: "1.0.0" });
  registerTools(mcpServer, userId, tier);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless per-request
    enableJsonResponse: true,
  });
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", (_req, res) =>
  res.status(405).json({ error: "Stateless mode: only POST /mcp supported" })
);
app.delete("/mcp", (_req, res) => res.status(204).send());
app.get("/health", (_req, res) =>
  res.json({ status: "ok", server: "crypto-tax-mcp", version: "1.0.0" })
);

// Polar billing webhook — no Bearer auth, signature verified inside handler
app.post("/webhooks/polar", (req, res) => {
  handlePolarWebhook(req, res).catch((err) => {
    console.error("Unhandled polar webhook error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Internal error" });
  });
});

app.listen(PORT, () =>
  console.log(`crypto-tax MCP server running on port ${PORT}`)
);
