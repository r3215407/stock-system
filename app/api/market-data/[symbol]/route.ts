import { normalizeSymbol } from "@/lib/evaluation";
import { getMarketDataSnapshot, MarketDataError } from "@/lib/market-data";

export const dynamic = "force-dynamic";

function errorStatus(error: MarketDataError) {
  if (error.code === "NOT_FOUND") return 404;
  if (error.code === "INSUFFICIENT_DATA" || error.code === "INVALID_DATA") return 422;
  return 502;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol: rawSymbol } = await params;
  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol.valid) {
    return Response.json(
      { error: { code: "INVALID_SYMBOL", message: "请输入有效的六位A股或场内基金代码。" } },
      { status: 400 },
    );
  }

  const signalDate = new URL(request.url).searchParams.get("signalDate")?.trim() || undefined;
  if (signalDate && !/^\d{4}-\d{2}-\d{2}$/.test(signalDate)) {
    return Response.json(
      { error: { code: "INVALID_SIGNAL_DATE", message: "signalDate 格式应为 YYYY-MM-DD。" } },
      { status: 400 },
    );
  }

  try {
    const snapshot = await getMarketDataSnapshot(symbol.normalized, signalDate);
    return Response.json({ data: snapshot }, { headers: { "Cache-Control": "no-store" } });
  } catch (caught) {
    const error = caught instanceof MarketDataError
      ? caught
      : new MarketDataError("行情数据读取失败，请稍后重试。", "UPSTREAM_ERROR");
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: errorStatus(error), headers: { "Cache-Control": "no-store" } },
    );
  }
}
