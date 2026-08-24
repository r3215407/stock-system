export type BacktestPricePoint = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type BacktestEquityPoint = {
  date: string;
  equity: number;
  drawdown: number;
};

export type BacktestTrade = {
  id: number;
  signalDate: string;
  entryDate: string;
  entryPrice: number;
  shares: number;
  score: number;
  technicalScore: number;
  strengthScore: number;
  initialStop: number;
  plannedRisk: number;
  exitDate: string;
  exitPrice: number;
  exitReason: string;
  holdingDays: number;
  netProfit: number;
  returnRate: number;
  rMultiple: number;
};

export type BacktestMetrics = {
  cumulativeReturn: number;
  annualizedReturn: number;
  maxDrawdown: number;
  maxDrawdownStart: string | null;
  maxDrawdownEnd: string | null;
  sharpe: number | null;
  calmar: number | null;
  winRate: number | null;
  profitLossRatio: number | null;
  tradeCount: number;
  averageHoldingDays: number | null;
  annualizedVolatility: number | null;
  maxConsecutiveLosses: number;
  profitFactor: number | null;
  averageR: number | null;
  averageUtilization: number;
  buyAndHoldReturn: number;
};

export type StockBacktestReport = {
  symbol: string;
  name: string;
  strategyId: "pullback-strength-stock";
  strategyVersion: "0.4";
  parameterVersion: "0.4-current";
  provider: string;
  adjustment: "前复权";
  startDate: string;
  endDate: string;
  tradingDays: number;
  warmupBars: number;
  initialCapital: number;
  assumptions: {
    commissionRate: number;
    minimumCommission: number;
    stampDutyRate: number;
    slippageRate: number;
    riskFreeRate: number;
  };
  metrics: BacktestMetrics;
  priceSeries: BacktestPricePoint[];
  equityCurve: BacktestEquityPoint[];
  trades: BacktestTrade[];
  signalCount: number;
  cancelledSignalCount: number;
  rejectionCounts: Array<{ reason: string; count: number }>;
  generatedAt: string;
};

function sampleStandardDeviation(values: number[]) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function calculateBacktestMetrics({
  equityCurve,
  trades,
  initialCapital,
  buyAndHoldReturn,
  investedValues,
}: {
  equityCurve: BacktestEquityPoint[];
  trades: BacktestTrade[];
  initialCapital: number;
  buyAndHoldReturn: number;
  investedValues: number[];
}): BacktestMetrics {
  const endingEquity = equityCurve.at(-1)?.equity ?? initialCapital;
  const cumulativeReturn = endingEquity / initialCapital - 1;
  const tradingDays = Math.max(1, equityCurve.length);
  const annualizedReturn = (endingEquity / initialCapital) ** (252 / tradingDays) - 1;

  let peak = initialCapital;
  let peakDate: string | null = equityCurve[0]?.date ?? null;
  let maxDrawdown = 0;
  let maxDrawdownStart: string | null = null;
  let maxDrawdownEnd: string | null = null;
  const dailyReturns: number[] = [];
  for (let index = 0; index < equityCurve.length; index += 1) {
    const point = equityCurve[index];
    if (point.equity > peak) {
      peak = point.equity;
      peakDate = point.date;
    }
    const drawdown = peak > 0 ? point.equity / peak - 1 : 0;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownStart = peakDate;
      maxDrawdownEnd = point.date;
    }
    if (index > 0 && equityCurve[index - 1].equity > 0) {
      dailyReturns.push(point.equity / equityCurve[index - 1].equity - 1);
    }
  }

  const dailyVolatility = sampleStandardDeviation(dailyReturns);
  const annualizedVolatility = dailyVolatility === null ? null : dailyVolatility * Math.sqrt(252);
  const meanDailyReturn = dailyReturns.length
    ? dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length
    : 0;
  const sharpe = dailyVolatility && dailyVolatility > 0
    ? meanDailyReturn / dailyVolatility * Math.sqrt(252)
    : null;
  const calmar = maxDrawdown < 0 ? annualizedReturn / Math.abs(maxDrawdown) : null;

  const winningTrades = trades.filter((trade) => trade.netProfit > 0);
  const losingTrades = trades.filter((trade) => trade.netProfit < 0);
  const grossProfit = winningTrades.reduce((sum, trade) => sum + trade.netProfit, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, trade) => sum + trade.netProfit, 0));
  const averageProfit = winningTrades.length ? grossProfit / winningTrades.length : null;
  const averageLoss = losingTrades.length ? grossLoss / losingTrades.length : null;

  let consecutiveLosses = 0;
  let maxConsecutiveLosses = 0;
  for (const trade of trades) {
    consecutiveLosses = trade.netProfit < 0 ? consecutiveLosses + 1 : 0;
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
  }

  return {
    cumulativeReturn,
    annualizedReturn,
    maxDrawdown,
    maxDrawdownStart,
    maxDrawdownEnd,
    sharpe,
    calmar,
    winRate: trades.length ? winningTrades.length / trades.length : null,
    profitLossRatio: averageProfit !== null && averageLoss !== null && averageLoss > 0
      ? averageProfit / averageLoss
      : null,
    tradeCount: trades.length,
    averageHoldingDays: trades.length
      ? trades.reduce((sum, trade) => sum + trade.holdingDays, 0) / trades.length
      : null,
    annualizedVolatility,
    maxConsecutiveLosses,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    averageR: trades.length ? trades.reduce((sum, trade) => sum + trade.rMultiple, 0) / trades.length : null,
    averageUtilization: investedValues.length
      ? investedValues.reduce((sum, value) => sum + value / initialCapital, 0) / investedValues.length
      : 0,
    buyAndHoldReturn,
  };
}
