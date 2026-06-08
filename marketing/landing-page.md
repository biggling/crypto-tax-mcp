# Crypto Tax MCP — Landing Page Copy

> **Source decision:** D-001 (2026-06-01) — Tax Reconciliation is the **paid hero**; Portfolio MCP is the **free top-of-funnel** that captures holdings and feeds the tax upgrade.
> **Grounding:** product tools (`products/1_crypto-tax/README.md`), competitive landscape (`competitive-research.md`).
> **Use:** copy-paste blocks for the marketing site / MCPize listing / Dev.to launch post. Section headers map to page sections; nothing here is placeholder.

---

## 1. Hero

**H1:**
Reconcile your 1099-DA inside Claude — catch broker mismatches before the IRS does.

**Subhead:**
Your exchange reported your 2025 gross proceeds to the IRS with **no cost basis**. The IRS already has the mismatch. Crypto Tax MCP calculates your real cost basis (FIFO / LIFO / HIFO), reconciles it against the broker's 1099-DA, and shows exactly where the numbers diverge — by asking Claude, not uploading a CSV to yet another web app.

**Primary CTA:** Reconcile my 1099-DA →
**Secondary CTA:** Start free with the Portfolio MCP

**Trust line (under buttons):**
First conversational crypto-tax layer for Claude · FIFO / LIFO / HIFO · Form 8949-ready · Your data stays in your own MCP server.

---

## 2. The problem (pain section)

**Section title:** The 1099-DA gap is structural — and it's pointed at you.

- **Brokers now report proceeds, not basis.** Starting with tax year 2025 (filed April 2026), US exchanges issue Form 1099-DA showing *gross proceeds* — but most cannot report what you originally paid. A $40,000 sale looks like $40,000 of gain.
- **The IRS has the mismatch data.** Mismatches between broker filings and your return trigger CP2000 automated notices. An estimated **7–12 million** US crypto holders are exposed, and the exposure runs through **2027** at minimum.
- **Every existing tool is a web app.** Koinly, CoinTracker, CoinLedger, ZenLedger — all require CSV uploads, all generate static annual PDFs, and **none** of them can answer a question. There are **zero** MCP-native crypto tax tools.
- **Reconciliation is still manual.** Power users already run Claude for prices and portfolio analytics — then drop out to a spreadsheet the moment taxes come up.

**Pull-quote:** *We're not competing with Koinly. We're building the layer that answers "what's my FIFO gain on ETH right now?" without a CSV upload or a 10-minute report.*

---

## 3. How it works (3 steps)

1. **Connect your history.** Import exchange CSVs (Coinbase, Binance, Kraken auto-detected) or add transactions by talking to Claude. Buys, sells, transfers, earn/airdrop events.
2. **Calculate real cost basis.** Ask for FIFO, LIFO, or HIFO lot matching on any coin. Get short-term vs long-term realized gains for any tax year, with historical fair-market-value filled in automatically for airdrops and income.
3. **Reconcile against the 1099-DA.** Paste your broker's reported proceeds. Crypto Tax MCP flags every discrepancy in plain language, scores your audit risk, and exports a Form 8949-compatible gain/loss table.

---

## 4. Feature blocks (paid hero — Tax)

**Block A — 1099-DA reconciliation (the wedge)**
Compare what your exchange told the IRS against what you actually owe. `compare_1099da` surfaces the discrepancy in dollars, explains *why* it happened (e.g. a $0-basis report on transferred-in coins), and recommends how to file it on Form 8949. This is the feature no other tool — MCP or web — has.

**Block B — Cost basis you can interrogate**
FIFO / LIFO / HIFO lot matching for any asset, on demand. Switch methods and instantly see the tax difference. Partial-lot consumption is tracked correctly, so multi-buy / multi-sell histories don't silently corrupt your gains.

**Block C — Built for the conversation, not the PDF**
"What's my realized gain on SOL this year?" "Which method saves me the most on BTC?" "Did Coinbase over-report my proceeds?" Answers in context, in Claude — no upload, no export, no waiting.

**Block D — Form 8949-ready export**
`export_tax_report` produces a Form 8949-compatible gain/loss table (summary / CSV / JSON) you can hand to your CPA or drop into TurboTax. Historical FMV for airdrops and income events is resolved for you.

---

## 5. The free funnel (Portfolio MCP)

**Section title:** Start free. Your portfolio today, your tax answer in April.

The **Crypto Portfolio MCP** is the free install. Track holdings, live prices, and P&L inside Claude — no card required. It quietly stores the holdings and purchase data that the Tax MCP needs, so when 1099-DA season hits, your reconciliation is one upgrade away, not one CSV-archaeology weekend away.

- **Free Portfolio MCP** — live P&L, holdings, market overview. The fastest way to get crypto data into Claude.
- **Upgrade path** — the same holdings flow straight into cost-basis and 1099-DA reconciliation. No re-import.

**Funnel CTA:** Install the free Portfolio MCP → upgrade to Tax when you need it.

---

## 6. Pricing (table)

| Tier | Who it's for | Includes | Price |
|---|---|---|---|
| **Portfolio (Free)** | Anyone who wants crypto data in Claude | Live P&L, holdings, prices, market overview; 3 holdings | **$0** |
| **Pro** | Active traders tracking gains year-round | Unlimited transactions, FIFO/LIFO/HIFO cost basis, realized-gains by tax year, Form 8949 export | **$19/mo** |
| **Tax** ⭐ | Anyone who got — or expects — a 1099-DA | Everything in Pro **+ 1099-DA reconciliation**, audit-risk scoring, discrepancy explanations, CPA-ready export, multi-exchange | **$49/mo** *(launch: $39/mo)* |

**Pricing footnote:** A single avoided CP2000 notice — or one correct Form 8949 line — pays for the Tax tier many times over. Competing web apps charge $199–$299/yr for static reports that still can't reconcile your 1099-DA.

**Pricing CTA:** Get the Tax tier →

---

## 7. Why now / urgency strip

- ✅ **Tax year 2025 is the first 1099-DA year** — the mismatch letters start landing now.
- ✅ **Zero MCP competition** — confirmed across PulseMCP, Smithery, Glama, GitHub, MCPize.
- ✅ **Multi-year demand** — the basis-reporting gap persists through 2027.
- ✅ **You already use Claude** — keep the workflow where you work.

---

## 8. FAQ

**Is this tax advice?**
No. Crypto Tax MCP computes cost basis and reconciles broker filings using standard methods (FIFO/LIFO/HIFO) and produces a Form 8949-compatible table. Confirm your filing with a tax professional.

**Where does my data live?**
In your own MCP server's database. No third-party tax SaaS holds your full transaction history.

**Which exchanges are supported?**
CSV import auto-detects Coinbase, Binance, and Kraken formats, with a generic fallback parser. Manual entry covers anything else, including on-chain and transfer events.

**Do I need the paid tier to try it?**
No — install the free Portfolio MCP first. Upgrade to Pro or Tax when you need cost basis or 1099-DA reconciliation; your data carries over.

**What's the difference between Pro and Tax?**
Pro gives you cost basis and gain calculations. **Tax** adds the thing nobody else has: reconciling those numbers against the broker's 1099-DA, with audit-risk scoring and a plain-language explanation of every discrepancy.

---

## 9. Closing CTA

**H2:** Don't let a $0-basis 1099-DA become a five-figure phantom gain.

**Body:** Install the free Portfolio MCP today. When the broker forms arrive, reconcile your 1099-DA inside Claude in minutes — and file Form 8949 with numbers you can defend.

**Primary CTA:** Reconcile my 1099-DA →
**Secondary CTA:** Start free with Portfolio

---

## Channel notes (not page copy)

- **MCPize listing (OA-002):** use Hero H1 + Subhead as the listing summary; use the §6 pricing table verbatim. The *free* Portfolio MCP is the listed install per D-001 — Tax is the upgrade.
- **Dev.to / Reddit launch:** lead with §2 (the 1099-DA gap) and the "zero MCP competition" line from §7; soft-CTA to the free Portfolio MCP.
- **Pricing reconciliation:** README lists Tax at $49/mo; D-001 authorizes a $39–49 band. Copy shows **$49 standard / $39 launch** — keep both numbers consistent across channels.
