import { fetchRotationMarketData } from "@/lib/etf-market-data";
import { shanghaiBusinessClock } from "@/lib/etf-rotation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const market = await fetchRotationMarketData(shanghaiBusinessClock().date);
    return Response.json({
      marketDataAt: market.marketDataAt,
      provider: market.provider,
      pool: market.rankings.map((item) => ({
        symbol: item.symbol,
        name: item.name,
        currentPrice: item.currentPrice.toFixed(6),
        score: item.score,
        rank: item.rank,
        marketDataAt: item.marketDataAt,
      })),
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("ETF rotation pool failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "MARKET_DATA_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
