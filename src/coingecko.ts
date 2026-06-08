// Minimal CoinGecko client for crypto-tax — historical FMV lookups only.
// Ported from products/3_crypto-portfolio/src/coingecko.ts.
// Full market-data functions are omitted; add them if needed later.

const BASE = "https://api.coingecko.com/api/v3";
const API_KEY = process.env.COINGECKO_API_KEY ?? "";

async function cgFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (API_KEY) headers["x-cg-demo-api-key"] = API_KEY;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url.toString(), { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the USD closing price for a coin on a specific date.
 * @param coinId   CoinGecko coin ID (e.g. "bitcoin")
 * @param dateIso  ISO date "YYYY-MM-DD"
 * @returns USD price, or null if CoinGecko doesn't have data for that date.
 */
export async function getHistoricalPrice(coinId: string, dateIso: string): Promise<number | null> {
  const [y, m, d] = dateIso.split("-");
  const cgDate = `${d}-${m}-${y}`; // CoinGecko expects DD-MM-YYYY
  const data = await cgFetch<{ market_data?: { current_price?: { usd?: number } } }>(
    `/coins/${coinId}/history`,
    { date: cgDate, localization: "false" }
  );
  return data.market_data?.current_price?.usd ?? null;
}
