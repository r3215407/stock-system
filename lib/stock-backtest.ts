import "server-only";

import {
  getScorePositionRule,
  getStopDistanceRiskAdjustment,
  minimumStrengthScore,
  minimumTechnicalScore,
  modelVersion,
  riskBufferRate,
} from "@/lib/evaluation";
import {
  buildAutomaticEvaluation,
  buildMarketEnvironmentModule,
  cleanBars,
  fetchMarketBars,
  MarketDataError,
  shanghaiClock,
  smaSeries,
} from "@/lib/market-data";
import {
  calculateBacktestMetrics,
  type BacktestEquityPoint,
  type BacktestTrade,
  type StockBacktestReport,
} from "@/lib/backtest";

const INITIAL_CAPITAL = 100_000;
const COMMISSION_RATE = 0.0003;
const MINIMUM_COMMISSION = 5;
const STAMP_DUTY_RATE = 0.0005;
const SLIPPAGE_RATE = 0.001;
const HISTORY_LIMIT = 900;

type PendingEntry = {
  signalDate: string;
  entryIndex: number;
  entryPrice: number;
  initialStop: number;
  shares: number;
  score: number;
  technicalScore: number;
  strengthScore: number;
  plannedRisk: number;
};

type OpenPosition = PendingEntry & {
  entryCommission: number;
  entryCost: number;
  activeStop: number;
  initialRiskPerShare: number;
  hitOneR: boolean;
  hitTwoR: boolean;
  belowMa20Days: number;
  belowMa10Days: number;
  pendingExitReason: string | null;
};

function subtractYears(date: string, years: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year - years, month - 1, day)).toISOString().slice(0, 10);
}

function commission(amount: number) {
  return Math.max(MINIMUM_COMMISSION, amount * COMMISSION_RATE);
}

function roundPrice(value: number) {
  const factor = value < 10 ? 1000 : 100;
  return Math.floor(value * factor) / factor;
}

function addRejection(rejections: Map<string, number>, reason: string) {
  rejections.set(reason, (rejections.get(reason) ?? 0) + 1);
}

function closePosition({
  position,
  rawExitPrice,
  exitDate,
  exitReason,
  exitIndex,
  entryDate,
  cash,
}: {
  position: OpenPosition;
  rawExitPrice: number;
  exitDate: string;
  exitReason: string;
  exitIndex: number;
  entryDate: string;
  cash: number;
}) {
  const exitPrice = rawExitPrice * (1 - SLIPPAGE_RATE);
  const grossProceeds = position.shares * exitPrice;
  const exitCommission = commission(grossProceeds);
  const stampDuty = grossProceeds * STAMP_DUTY_RATE;
  const netProceeds = grossProceeds - exitCommission - stampDuty;
  const netProfit = netProceeds - position.entryCost;
  const trade: BacktestTrade = {
    id: 0,
    signalDate: position.signalDate,
    entryDate,
    entryPrice: position.entryPrice,
    shares: position.shares,
    score: position.score,
    technicalScore: position.technicalScore,
    strengthScore: position.strengthScore,
    initialStop: position.initialStop,
    plannedRisk: position.plannedRisk,
    exitDate,
    exitPrice,
    exitReason,
    holdingDays: Math.max(0, exitIndex - position.entryIndex),
    netProfit,
    returnRate: position.entryCost > 0 ? netProfit / position.entryCost : 0,
    rMultiple: position.plannedRisk > 0 ? netProfit / position.plannedRisk : 0,
  };
  return { cash: cash + netProceeds, trade };
}

export async function runStockBacktest(
  normalizedSymbol: string,
  requestedEndDate?: string,
): Promise<StockBacktestReport> {
  const [{ name, bars: rawBars, provider }, benchmarkResult] = await Promise.all([
    fetchMarketBars(normalizedSymbol, HISTORY_LIMIT),
    fetchMarketBars("000985.SH", HISTORY_LIMIT).catch(() => null),
  ]);
  const bars = cleanBars(rawBars);
  if (bars.length < 500) {
    throw new MarketDataError("仅取得 " + bars.length + " 个有效交易日，无法完成近两年回测与指标预热。", "INSUFFICIENT_DATA");
  }

  let endIndex = requestedEndDate ? bars.findIndex((bar) => bar.date === requestedEndDate) : bars.length - 1;
  if (requestedEndDate && endIndex < 0) {
    throw new MarketDataError("指定回测结束日不存在。", "INSUFFICIENT_DATA");
  }
  if (!requestedEndDate) {
    const clock = shanghaiClock();
    if (bars[endIndex].date === clock.date && clock.minutes < 15 * 60 + 5) endIndex -= 1;
  }
  if (endIndex < 250) {
    throw new MarketDataError("回测结束日前没有足够的指标预热数据。", "INSUFFICIENT_DATA");
  }

  const endDate = bars[endIndex].date;
  const requestedStartDate = subtractYears(endDate, 2);
  const startIndex = bars.findIndex((bar) => bar.date >= requestedStartDate);
  if (startIndex < 250 || startIndex >= endIndex) {
    throw new MarketDataError("第三方行情未覆盖完整的近两年回测区间。", "INSUFFICIENT_DATA");
  }

  const benchmarkBars = benchmarkResult ? cleanBars(benchmarkResult.bars) : [];
  const ma10 = smaSeries(bars, 10);
  const ma20 = smaSeries(bars, 20);
  const ma60 = smaSeries(bars, 60);
  const priceSeries = bars.slice(startIndex, endIndex + 1).map((bar) => ({
    date: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  }));

  let cash = INITIAL_CAPITAL;
  let position: OpenPosition | null = null;
  let pendingEntry: PendingEntry | null = null;
  let signalCount = 0;
  let cancelledSignalCount = 0;
  const trades: BacktestTrade[] = [];
  const equityValues: Array<{ date: string; equity: number }> = [];
  const investedValues: number[] = [];
  const rejections = new Map<string, number>();

  for (let index = startIndex; index <= endIndex; index += 1) {
    const bar = bars[index];

    if ((pendingEntry as PendingEntry | null)?.entryIndex === index && !position) {
      const scheduledEntry = pendingEntry as PendingEntry;
      const grossAmount = scheduledEntry.shares * scheduledEntry.entryPrice;
      const entryCommission = commission(grossAmount);
      const entryCost = grossAmount + entryCommission;
      if (scheduledEntry.shares >= 100 && entryCost <= cash) {
        cash -= entryCost;
        position = {
          ...scheduledEntry,
          entryCommission,
          entryCost,
          activeStop: scheduledEntry.initialStop,
          initialRiskPerShare: scheduledEntry.entryPrice - scheduledEntry.initialStop,
          hitOneR: false,
          hitTwoR: false,
          belowMa20Days: 0,
          belowMa10Days: 0,
          pendingExitReason: null,
        };
      } else {
        cancelledSignalCount += 1;
        addRejection(rejections, "账户现金或整手约束");
      }
      pendingEntry = null;
    }

    if (position) {
      let exit: { price: number; reason: string } | null = null;
      if (position.pendingExitReason) exit = { price: bar.open, reason: position.pendingExitReason };
      else if (bar.open <= position.activeStop) exit = { price: bar.open, reason: "跳空止损" };
      else if (bar.low <= position.activeStop) {
        exit = {
          price: position.activeStop,
          reason: position.activeStop > position.initialStop ? "保护止损" : "初始止损",
        };
      }

      if (exit) {
        const result = closePosition({
          position,
          rawExitPrice: exit.price,
          exitDate: bar.date,
          exitReason: exit.reason,
          exitIndex: index,
          entryDate: bars[position.entryIndex].date,
          cash,
        });
        result.trade.id = trades.length + 1;
        cash = result.cash;
        trades.push(result.trade);
        position = null;
      }
    }

    if (position) {
      const currentMa10 = ma10[index];
      const currentMa20 = ma20[index];
      const currentMa60 = ma60[index];
      const holdingDays = index - position.entryIndex + 1;
      const oneRPrice = position.entryPrice + position.initialRiskPerShare;
      const twoRPrice = position.entryPrice + position.initialRiskPerShare * 2;
      if (bar.close >= oneRPrice) {
        position.hitOneR = true;
        position.activeStop = Math.max(position.activeStop, position.entryPrice);
      }
      if (bar.close >= twoRPrice) position.hitTwoR = true;

      position.belowMa20Days = currentMa20 !== null && bar.close < currentMa20 ? position.belowMa20Days + 1 : 0;
      position.belowMa10Days = currentMa10 !== null && bar.close < currentMa10 ? position.belowMa10Days + 1 : 0;

      if (currentMa20 !== null && currentMa60 !== null && currentMa20 <= currentMa60) {
        position.pendingExitReason = "MA20跌破MA60";
      } else if (currentMa60 !== null && bar.close < currentMa60 * 0.98) {
        position.pendingExitReason = "收盘跌破MA60超过2%";
      } else if (position.belowMa20Days >= 2) {
        position.pendingExitReason = "连续2日收盘低于MA20";
      } else if (position.hitTwoR && position.belowMa10Days >= 2) {
        position.pendingExitReason = "达到2R后连续2日低于MA10";
      } else if (holdingDays >= 10 && !position.hitOneR && bar.close <= position.entryPrice) {
        position.pendingExitReason = "10日未达到1R";
      } else if (holdingDays >= 40) {
        position.pendingExitReason = "最长持有40日";
      }
    }

    if (!position && !pendingEntry && index < endIndex) {
      const analysisBars = bars.slice(index - 249, index + 1);
      const automatic = buildAutomaticEvaluation(analysisBars);
      const benchmarkUntilDate = benchmarkBars.filter((benchmarkBar) => benchmarkBar.date <= bar.date);
      const environment = buildMarketEnvironmentModule(benchmarkUntilDate);
      const score = automatic.automaticModules.reduce((sum, module) => sum + module.earned, 0) + environment.earned;
      const technicalScore = automatic.automaticModules.reduce((sum, module) => sum + module.earned, 0);
      const strengthScore = automatic.automaticModules.find((module) => module.id === "strength")?.earned ?? 0;
      const automaticGatePassed = automatic.automaticFilters.filter((filter) => filter.id !== "HF-05").every((filter) => filter.status === "pass");
      const triggerPassed = automatic.crossedMa5 || automatic.brokeThreeDayHigh;

      let rejectionReason: string | null = null;
      if (!automaticGatePassed) rejectionReason = "趋势硬性过滤";
      else if (score < 70) rejectionReason = "总分不足70";
      else if (technicalScore < minimumTechnicalScore) rejectionReason = "技术分不足65";
      else if (strengthScore < minimumStrengthScore) rejectionReason = "转强分不足21";
      else if (!triggerPassed) rejectionReason = "未触发重新转强";

      if (rejectionReason) {
        addRejection(rejections, rejectionReason);
      } else {
        signalCount += 1;
        const nextBar: (typeof bars)[number] = bars[index + 1];
        const gapRate = nextBar.open / bar.close - 1;
        if (gapRate > 0.02) {
          cancelledSignalCount += 1;
          addRejection(rejections, "T+1高开超过2%");
        } else {
          const entryPrice: number = nextBar.open * (1 + SLIPPAGE_RATE);
          const initialStop = roundPrice(automatic.pullbackLowestPrice - 0.3 * automatic.atr);
          const riskPerShare = entryPrice - initialStop;
          const stopDistanceRate = riskPerShare / entryPrice;
          const stopAdjustment = getStopDistanceRiskAdjustment(stopDistanceRate, score);
          const resistancePrice = Math.max(...analysisBars.slice(-61, -1).map((item) => item.close));
          const pressurePassed = bar.close > resistancePrice ||
            (riskPerShare > 0 && (resistancePrice - entryPrice) / riskPerShare >= 2);
          const scoreRule = getScorePositionRule(score);

          if (!pressurePassed) {
            cancelledSignalCount += 1;
            addRejection(rejections, "压力空间不足2R");
          } else if (!stopAdjustment.executable || !scoreRule || riskPerShare <= 0) {
            cancelledSignalCount += 1;
            addRejection(rejections, "止损距离不可执行");
          } else {
            const allowedRisk = cash * scoreRule.riskBudgetRate * stopAdjustment.factor * (1 - riskBufferRate);
            const riskShares = Math.floor(allowedRisk / riskPerShare / 100) * 100;
            const valueShares = Math.floor(cash * 0.15 / entryPrice / 100) * 100;
            const shares = Math.max(0, Math.min(riskShares, valueShares));
            if (shares < 100) {
              cancelledSignalCount += 1;
              addRejection(rejections, "整手约束");
            } else {
              pendingEntry = {
                signalDate: bar.date,
                entryIndex: index + 1,
                entryPrice,
                initialStop,
                shares,
                score,
                technicalScore,
                strengthScore,
                plannedRisk: shares * riskPerShare,
              };
            }
          }
        }
      }
    }

    const equity = cash + (position ? position.shares * bar.close : 0);
    equityValues.push({ date: bar.date, equity });
    investedValues.push(position ? position.shares * bar.close : 0);
  }

  if (position) {
    const finalBar = bars[endIndex];
    const result = closePosition({
      position,
      rawExitPrice: finalBar.close,
      exitDate: finalBar.date,
      exitReason: "期末结算",
      exitIndex: endIndex,
      entryDate: bars[position.entryIndex].date,
      cash,
    });
    result.trade.id = trades.length + 1;
    cash = result.cash;
    trades.push(result.trade);
    equityValues[equityValues.length - 1] = { date: finalBar.date, equity: cash };
  }

  let peak = INITIAL_CAPITAL;
  const equityCurve: BacktestEquityPoint[] = equityValues.map((point) => {
    peak = Math.max(peak, point.equity);
    return { ...point, drawdown: peak > 0 ? point.equity / peak - 1 : 0 };
  });
  const buyAndHoldReturn = priceSeries.at(-1)!.close / priceSeries[0].close - 1;
  const metrics = calculateBacktestMetrics({
    equityCurve,
    trades,
    initialCapital: INITIAL_CAPITAL,
    buyAndHoldReturn,
    investedValues,
  });

  return {
    symbol: normalizedSymbol,
    name,
    strategyId: "pullback-strength-stock",
    strategyVersion: modelVersion,
    parameterVersion: "0.4-current",
    provider,
    adjustment: "前复权",
    startDate: bars[startIndex].date,
    endDate,
    tradingDays: priceSeries.length,
    warmupBars: startIndex,
    initialCapital: INITIAL_CAPITAL,
    assumptions: {
      commissionRate: COMMISSION_RATE,
      minimumCommission: MINIMUM_COMMISSION,
      stampDutyRate: STAMP_DUTY_RATE,
      slippageRate: SLIPPAGE_RATE,
      riskFreeRate: 0,
    },
    metrics,
    priceSeries,
    equityCurve,
    trades,
    signalCount,
    cancelledSignalCount,
    rejectionCounts: [...rejections.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count),
    generatedAt: new Date().toISOString(),
  };
}
