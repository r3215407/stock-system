import { getRotationOverview } from "@/lib/etf-rotation-db";
import { ETF_POOL } from "@/lib/etf-rotation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const overview = await getRotationOverview();
    const pool = ETF_POOL.map((symbol) => ({ symbol, name: null, currentPrice: null, score: null, rank: null, marketDataAt: null }));
    return Response.json({ ...overview, pool, poolError: null, poolLoading: true }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.error("ETF rotation overview failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({
      error: "SERVICE_UNAVAILABLE",
      message: "ETF 轮动账本暂时不可用，请稍后再试。",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
