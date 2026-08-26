export const stockStrategyV04 = Object.freeze({
  identity: {
    strategyId: "pullback-strength-stock",
    strategyVersion: "0.4",
    parameterVersion: "0.4-current",
    displayName: "趋势回调转强 · 股票 0.4",
    reviewedAt: "2026-08-28",
  },
  data: {
    adjustment: "前复权",
    benchmark: "000985.SH",
    minimumTradingDays: 250,
    completeDayCutoff: "15:05",
  },
  scores: {
    trend: { total: 30, itemPoints: 6, ma20SlopeMinimum: 0.01, return20Maximum: 0.2 },
    pullback: {
      total: 25,
      window: 10,
      amplitudeBands: [
        { minimum: 0.03, maximumExclusive: 0.06, points: 7 },
        { minimum: 0.02, maximumExclusive: 0.03, points: 5 },
        { minimum: 0.06, maximumExclusive: 0.08, points: 5 },
        { minimum: 0.08, maximumExclusive: 0.1, points: 3 },
      ],
      ma20DistanceBands: [
        { maximumInclusive: 0.03, points: 6 },
        { maximumInclusive: 0.05, points: 3 },
      ],
      ma60RelationshipBands: [
        { minimumInclusive: 1, points: 6 },
        { minimumInclusive: 0.98, points: 3 },
      ],
    },
    strength: { total: 35, positiveCandle: 5, abovePreviousClose: 5, regainMa5: 8, breakThreeDayHigh: 9, macdImproves: 8 },
    market: { total: 10, aboveMa20: 4, risingMa20: 4, positiveReturn5: 2 },
  },
  gates: { minimumScore: 70, minimumTechnicalScore: 65, minimumStrengthScore: 21, maximumStopDistance: 0.12, minimumRewardRisk: 2, maximumT1Gap: 0.02 },
  position: {
    scoreBands: [
      { minScore: 90, riskBudgetRate: 0.0075, label: "高匹配" },
      { minScore: 80, riskBudgetRate: 0.005, label: "标准交易" },
      { minScore: 70, riskBudgetRate: 0.0025, label: "允许试仓" },
    ],
    portfolioRiskCap: 0.02,
    stockValueCap: 0.15,
    industryValueCap: 0.3,
    riskBufferRate: 0.1,
    lotSize: 100,
  },
  exit: { oneR: 1, twoR: 2, trailingAtrMultiple: 0.3, ma60CloseFactor: 0.98, consecutiveDays: 2, staleTradeDays: 10, maximumHoldingDays: 40 },
} as const);

export function floorStockPrice(value: number) {
  const factor = value < 10 ? 1000 : 100;
  return Math.floor(value * factor) / factor;
}
