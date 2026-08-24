import { normalizeSymbol } from "@/lib/evaluation";
import { MarketDataError } from "@/lib/market-data";
import { runStockBacktest } from "@/lib/stock-backtest";

export const dynamic = "force-dynamic";

function errorStatus(error: MarketDataError) {
  if (error.code === "NOT_FOUND") return 404;
  if (error.code === "INSUFFICIENT_DATA" || error.code === "INVALID_DATA") return 422;
  return 502;
}

export async function POST(request: Request) {
  let body: { symbol?: unknown; endDate?: unknown; strategyId?: unknown; strategyVersion?: unknown; parameterVersion?: unknown; testProfile?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json(
      { error: { code: "INVALID_BODY", message: "请求内容必须是有效的 JSON。" } },
      { status: 400 },
    );
  }

  const symbol = normalizeSymbol(typeof body.symbol === "string" ? body.symbol : undefined);
  if (!symbol.valid) {
    return Response.json(
      { error: { code: "INVALID_SYMBOL", message: "请输入有效的六位A股代码。" } },
      { status: 400 },
    );
  }
  const endDate = typeof body.endDate === "string" ? body.endDate.trim() : undefined;
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return Response.json(
      { error: { code: "INVALID_END_DATE", message: "endDate 格式应为 YYYY-MM-DD。" } },
      { status: 400 },
    );
  }
  if ((body.strategyId !== undefined && body.strategyId !== "pullback-strength-stock") ||
      (body.strategyVersion !== undefined && body.strategyVersion !== "0.4") ||
      (body.parameterVersion !== undefined && body.parameterVersion !== "0.4-current") ||
      (body.testProfile !== undefined && body.testProfile !== "stock-two-year-v1")) {
    return Response.json({ error: { code: "INVALID_STRATEGY", message: "该回测入口只接受已注册的 0.4 策略及固定两年测试口径。" } }, { status: 400 });
  }

  try {
    const report = await runStockBacktest(symbol.normalized, endDate);
    return Response.json(
      { data: report },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (caught) {
    const error = caught instanceof MarketDataError
      ? caught
      : new MarketDataError("回测执行失败，请稍后重试。", "UPSTREAM_ERROR");
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: errorStatus(error), headers: { "Cache-Control": "no-store" } },
    );
  }
}
