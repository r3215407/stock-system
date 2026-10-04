import { cleanBars, fetchMarketBars, shanghaiClock } from "@/lib/market-data";
import {
  calculateMacdPositionSeries,
  MACD_ETF_CODE,
  MACD_ETF_NAME,
  MACD_ETF_SYMBOL,
  MACD_INITIAL_CAPITAL,
  nextTradingDate,
} from "@/lib/macd-position";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const market = await fetchMarketBars(MACD_ETF_SYMBOL, 520);
    const bars = cleanBars(market.bars);
    const clock = shanghaiClock();
    const completedBars = bars.at(-1)?.date === clock.date && clock.minutes < 15 * 60 + 5 ? bars.slice(0, -1) : bars;
    const series = calculateMacdPositionSeries(completedBars);
    const latest = series.at(-1);
    if (!latest) {
      return Response.json({ message: "长期均线数据不足，暂时不能生成正式信号。" }, { status: 422 });
    }
    const delta = latest.targetPosition - latest.previousTargetPosition;
    const executionDate = nextTradingDate(latest.date);
    return Response.json({
      symbol: MACD_ETF_CODE,
      normalizedSymbol: MACD_ETF_SYMBOL,
      name: market.name || MACD_ETF_NAME,
      strategyVersion: "513530 MACD 分级仓位 1.0",
      signalDate: latest.date,
      executionDate,
      fetchedAt: new Date().toISOString(),
      provider: market.provider,
      adjustment: "前复权",
      latest,
      plan: {
        action: latest.action,
        deltaPosition: delta,
        amount: Math.abs(delta) * MACD_INITIAL_CAPITAL,
        morningInstruction: latest.action === "BUY"
          ? "早盘不下单，等待 14:40 再检查涨幅与场内溢价。"
          : latest.action === "SELL"
            ? "按风险卖出计划执行，不因高开或低开取消。"
            : "没有新增买入计划，维持当前策略目标仓位。",
        executionWindow: latest.action === "BUY" ? "14:40–14:50" : latest.action === "SELL" ? "09:35–10:00 / 14:40–14:50" : null,
        premiumStatus: "UNAVAILABLE",
        reasons: latest.actionReasons.length ? latest.actionReasons : [
          latest.signal === "BULLISH" ? "MACD 仍为多头，但今日没有触发新的 20% 加仓单位" : "MACD 当前为空头，今日没有生成买入计划",
        ],
      },
      assumptions: {
        initialCapital: MACD_INITIAL_CAPITAL,
        modeledPosition: true,
        actualPositionTracked: false,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("513530 MACD outlook failed", error instanceof Error ? error.message : "unknown error");
    return Response.json(
      { message: "行情源暂时不可用。已停止生成新信号，请稍后重新读取。" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
