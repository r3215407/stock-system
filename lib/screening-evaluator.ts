import { getStopDistanceRiskAdjustment } from "@/lib/evaluation";
import { buildAutomaticEvaluation, cleanBars, shanghaiClock, type DailyBar } from "@/lib/market-data";
import type { ScreeningCandidate, ScreeningSecurity } from "@/lib/screening";
import type { StrategyDefinition } from "@/lib/strategies";

function latestCompleteIndex(bars: DailyBar[], requestedDate: string | null) {
  if (requestedDate) return bars.findIndex((bar) => bar.date === requestedDate);
  let index = bars.length - 1;
  const clock = shanghaiClock();
  if (bars[index]?.date === clock.date && clock.minutes < 15 * 60 + 5) index -= 1;
  return index;
}

export class ScreeningHistoryError extends Error {
  readonly code = "INSUFFICIENT_HISTORY";

  constructor() {
    super("历史日线不足250日");
    this.name = "ScreeningHistoryError";
  }
}

export function evaluateScreeningSecurity(
  security: ScreeningSecurity,
  rawBars: DailyBar[],
  strategy: StrategyDefinition,
  requestedDate: string | null,
  environmentScore: number,
) {
  const bars = cleanBars(rawBars);
  const index = latestCompleteIndex(bars, requestedDate);
  if (index < 249) throw new ScreeningHistoryError();
  const analysis = bars.slice(index - 249, index + 1);
  const signal = analysis.at(-1)!;
  const automatic = buildAutomaticEvaluation(analysis);
  const technicalScore = automatic.automaticModules.reduce((sum, module) => sum + module.earned, 0);
  const strengthScore = automatic.automaticModules.find((module) => module.id === "strength")?.earned ?? 0;
  const score = technicalScore + environmentScore;
  const averageAmount20 = analysis.slice(-20).reduce((sum, bar) => sum + bar.amount, 0) / 20;
  const initialStopPrice = Math.floor((automatic.pullbackLowestPrice - 0.3 * automatic.atr) * 100) / 100;
  const entryPrice = signal.close;
  const stopDistanceRate = (entryPrice - initialStopPrice) / entryPrice;
  const stopRule = getStopDistanceRiskAdjustment(stopDistanceRate, score);
  const resistancePrice = Math.max(...analysis.slice(-61, -1).map((bar) => bar.close));
  const riskPerShare = entryPrice - initialStopPrice;
  const breakout = signal.close > resistancePrice;
  const pressurePassed = breakout || (riskPerShare > 0 && (resistancePrice - entryPrice) / riskPerShare >= 2);
  const trendGate = automatic.automaticFilters.filter((filter) => filter.id !== "HF-05").every((filter) => filter.status === "pass");
  const trigger = automatic.crossedMa5 || automatic.brokeThreeDayHigh;
  const liquid = averageAmount20 >= strategy.universeConfig.minimumAverageAmount20;

  let bucket: ScreeningCandidate["bucket"] = "candidate";
  let conclusion = "候选";
  let firstReason = "全部硬性条件和评分门槛通过";
  if (!liquid) { bucket = "excluded"; conclusion = "已排除"; firstReason = "20日平均成交额不足5000万元"; }
  else if (!trendGate) { bucket = "excluded"; conclusion = "已排除"; firstReason = automatic.automaticFilters.find((item) => item.status === "fail")?.label ?? "趋势硬性过滤"; }
  else if (!stopRule.executable) { bucket = "excluded"; conclusion = "已排除"; firstReason = "止损距离不可执行"; }
  else if (!pressurePassed) { bucket = "excluded"; conclusion = "已排除"; firstReason = "压力空间不足2R"; }
  else if (score < strategy.signalConfig.minimumScore || technicalScore < strategy.signalConfig.minimumTechnicalScore) {
    bucket = "excluded"; conclusion = "已排除"; firstReason = score < 70 ? "总分不足70" : "技术分不足65";
  } else if (strengthScore < strategy.signalConfig.minimumStrengthScore || !trigger) {
    bucket = "watch"; conclusion = "等待转强"; firstReason = strengthScore < 21 ? "转强分不足21" : "未触发重新转强";
  }

  return {
    rank: null, symbol: security.symbol, code: security.code, name: security.name, market: security.market,
    industry: security.industry, bucket, conclusion, score, technicalScore, strengthScore, stopDistanceRate,
    riskFactor: stopRule.factor, riskLabel: stopRule.label,
    pressureStatus: breakout ? "breakout" as const : pressurePassed ? "sufficient" as const : "insufficient" as const,
    averageAmount20, signalDate: signal.date, entryPrice, initialStopPrice, firstReason,
    rankingReason: `总分 ${score} · 转强 ${strengthScore} · 止损 ${(stopDistanceRate * 100).toFixed(2)}%`,
  } satisfies ScreeningCandidate;
}
