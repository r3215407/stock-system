import type { PositionTradeRecord } from "@/lib/position-plan";

export type PositionPerformance = {
  tradeCount: number;
  totalNetProfit: number;
  cumulativeReturn: number;
  benchmarkCumulativeReturn: number | null;
  cumulativeExcessReturn: number | null;
  winRate: number | null;
  pathSuccessRate: number | null;
  averageHoldingDays: number | null;
  averageR: number | null;
  profitLossRatio: number | null;
  profitFactor: number | null;
  sharpe: number | null;
  excessSharpe: number | null;
  maxDrawdown: number | null;
};

export type OpenPositionMark = {
  purchaseDate: string | null;
  valuationDate: string | null;
  averageCost: number | null;
  currentPrice: number | null;
  actualShares: number | null;
};

export type PortfolioReturnSummary = {
  heldProfit: number;
  heldReturn: number | null;
  cumulativeProfit: number;
  cumulativeReturn: number | null;
  annualizedReturn: number | null;
  elapsedDays: number | null;
};

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleDeviation(values: number[]) {
  if (values.length < 2) return null;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return variance > 0 ? Math.sqrt(variance) : null;
}

function annualizedTradeSharpe(trades: PositionTradeRecord[], selector: (trade: PositionTradeRecord) => number | null) {
  const dailyReturns = trades.flatMap((trade) => {
    const value = selector(trade);
    return value === null ? [] : [value / Math.max(1, trade.holdingDays)];
  });
  const deviation = sampleDeviation(dailyReturns);
  return deviation === null ? null : mean(dailyReturns) / deviation * Math.sqrt(252);
}

function compounded(values: number[]) {
  return values.reduce((wealth, value) => wealth * (1 + value), 1) - 1;
}

function maxDrawdown(trades: PositionTradeRecord[]) {
  if (!trades.length) return null;
  let wealth = 1;
  let peak = 1;
  let drawdown = 0;
  for (const trade of [...trades].sort((a, b) => a.exitDate.localeCompare(b.exitDate))) {
    wealth *= 1 + trade.returnRate;
    peak = Math.max(peak, wealth);
    drawdown = Math.min(drawdown, wealth / peak - 1);
  }
  return drawdown;
}

function dateValue(value: string) {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) ? time : null;
}

export function calculatePortfolioReturnSummary(
  accountEquity: number,
  trades: PositionTradeRecord[],
  openPositions: OpenPositionMark[],
): PortfolioReturnSummary {
  const validOpenPositions = openPositions.filter((position) =>
    position.averageCost !== null && position.averageCost > 0
    && position.currentPrice !== null && position.currentPrice > 0
    && position.actualShares !== null && position.actualShares > 0);
  const heldCost = validOpenPositions.reduce((sum, position) => sum + position.averageCost! * position.actualShares!, 0);
  const heldProfit = validOpenPositions.reduce(
    (sum, position) => sum + (position.currentPrice! - position.averageCost!) * position.actualShares!,
    0,
  );
  const realizedProfit = trades.reduce((sum, trade) => sum + trade.netProfit, 0);
  const cumulativeProfit = realizedProfit + heldProfit;
  const cumulativeReturn = accountEquity > 0 ? cumulativeProfit / accountEquity : null;
  const startDates = [
    ...trades.map((trade) => trade.purchaseDate),
    ...validOpenPositions.flatMap((position) => position.purchaseDate ? [position.purchaseDate] : []),
  ].map(dateValue).filter((value): value is number => value !== null);
  const endDates = [
    ...trades.map((trade) => trade.exitDate),
    ...validOpenPositions.flatMap((position) => position.valuationDate ? [position.valuationDate] : []),
  ].map(dateValue).filter((value): value is number => value !== null);
  const elapsedDays = startDates.length && endDates.length
    ? Math.max(0, Math.round((Math.max(...endDates) - Math.min(...startDates)) / 86_400_000))
    : null;
  const annualizedReturn = cumulativeReturn !== null && cumulativeReturn > -1 && elapsedDays !== null && elapsedDays > 0
    ? (1 + cumulativeReturn) ** (365 / elapsedDays) - 1
    : null;
  return {
    heldProfit,
    heldReturn: heldCost > 0 ? heldProfit / heldCost : null,
    cumulativeProfit,
    cumulativeReturn,
    annualizedReturn,
    elapsedDays,
  };
}

export function calculatePositionPerformance(trades: PositionTradeRecord[]): PositionPerformance {
  const gains = trades.filter((trade) => trade.netProfit > 0);
  const losses = trades.filter((trade) => trade.netProfit < 0);
  const benchmarkTrades = trades.filter((trade) => trade.benchmarkReturn !== null);
  const averageGain = gains.length ? mean(gains.map((trade) => trade.netProfit)) : null;
  const averageLoss = losses.length ? Math.abs(mean(losses.map((trade) => trade.netProfit))) : null;
  const grossGain = gains.reduce((sum, trade) => sum + trade.netProfit, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netProfit, 0));
  const benchmarkCumulativeReturn = benchmarkTrades.length === trades.length && trades.length
    ? compounded(trades.map((trade) => trade.benchmarkReturn!))
    : null;
  const cumulativeReturn = compounded(trades.map((trade) => trade.returnRate));
  return {
    tradeCount: trades.length,
    totalNetProfit: trades.reduce((sum, trade) => sum + trade.netProfit, 0),
    cumulativeReturn,
    benchmarkCumulativeReturn,
    cumulativeExcessReturn: benchmarkCumulativeReturn === null ? null : cumulativeReturn - benchmarkCumulativeReturn,
    winRate: trades.length ? gains.length / trades.length : null,
    pathSuccessRate: benchmarkTrades.length
      ? benchmarkTrades.filter((trade) => (trade.excessReturn ?? trade.returnRate - trade.benchmarkReturn!) > 0).length / benchmarkTrades.length
      : null,
    averageHoldingDays: trades.length ? mean(trades.map((trade) => trade.holdingDays)) : null,
    averageR: trades.length ? mean(trades.map((trade) => trade.rMultiple)) : null,
    profitLossRatio: averageGain !== null && averageLoss ? averageGain / averageLoss : null,
    profitFactor: grossLoss > 0 ? grossGain / grossLoss : null,
    sharpe: annualizedTradeSharpe(trades, (trade) => trade.returnRate),
    excessSharpe: annualizedTradeSharpe(trades, (trade) => trade.excessReturn),
    maxDrawdown: maxDrawdown(trades),
  };
}
