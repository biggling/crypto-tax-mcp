# Crypto Tax MCP

Cost basis tracking, capital gains calc, and 1099-DA reconciliation for Claude. Built on top of the Crypto Portfolio MCP data layer.

**Price:** Free (50 txns) / Pro $19/mo / Tax $49/mo  
**Transport:** Streamable HTTP  
**Host:** VPS (`ssh ai`) + nginx + Let's Encrypt

## Tools
- `import_transactions_csv` — parse exchange CSV exports (Coinbase, Binance, Kraken formats)
- `add_manual_transaction` — add buy/sell/transfer/earn events manually
- `get_transactions` — filtered transaction history
- `calculate_cost_basis` — FIFO/LIFO/HIFO lot matching for any coin
- `get_realized_gains` — short-term / long-term gain summary for a tax year
- `get_historical_fmv` — fair market value on any past date (for airdrops, income events)
- `export_tax_report` — Form 8949-compatible gain/loss table (summary/csv/json)
- `compare_1099da` — flag discrepancies between user records and exchange-reported proceeds

## Stack
- TypeScript + Node.js 20
- `@modelcontextprotocol/sdk` + Express + Zod
- CoinGecko Analyst API (for historical FMV, $129/mo at scale)
- Moralis (on-chain tx history, 30M free CU/mo)
- CCXT (CEX trade history via user API keys)
- SQLite (transactions, cost lots per user)
- Bearer API key auth (MVP)

## Run
```bash
cp .env.example .env
npm install
npm run dev
npm run build && npm start
```
