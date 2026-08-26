import assert from "node:assert/strict";
import test from "node:test";

import type { PositionTradeRecord } from "../lib/position-plan.ts";
import { calculatePositionPerformance } from "../lib/position-performance.ts";

function trade(overrides: Partial<PositionTradeRecord> = {}): PositionTradeRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    symbol: "600000.SH",
    name: "测试股票",
    industry: "测试",
    strategyId: "stock-score",
    strategyVersion: "0.4",
    parameterVersion: "0.4",
    score: 80,
    technicalScore: 70,
    strengthScore: 25,
    signalDate: "2026-01-01",
    purchaseDate: "2026-01-02",
    exitDate: "2026-01-12",
    averageCost: 10,
    exitPrice: 11,
    actualShares: 100,
    initialStopPrice: 9,
    grossProfit: 100,
    netProfit: 90,
    returnRate: 0.09,
    rMultiple: 0.9,
    holdingDays: 7,
    benchmarkEntryClose: 4000,
    benchmarkExitClose: 4080,
    benchmarkReturn: 0.02,
    excessReturn: 0.07,
    exitReason: "移动止盈",
    reviewNote: "按计划执行",
    source: "individual-evaluation",
    createdAt: "2026-01-12T08:00:00.000Z",
    ...overrides,
  };
}

test("成交历史计算收益、基准胜率和持有天数", () => {
  const report = calculatePositionPerformance([
    trade(),
    trade({ id: "00000000-0000-4000-8000-000000000002", exitDate: "2026-02-01", netProfit: -50, returnRate: -0.05, rMultiple: -0.5, holdingDays: 3, benchmarkReturn: 0.01, excessReturn: -0.06 }),
  ]);
  assert.equal(report.tradeCount, 2);
  assert.equal(report.totalNetProfit, 40);
  assert.equal(report.winRate, 0.5);
  assert.equal(report.pathSuccessRate, 0.5);
  assert.equal(report.averageHoldingDays, 5);
  assert.ok(report.sharpe !== null);
  assert.ok(report.excessSharpe !== null);
  assert.ok((report.maxDrawdown ?? 0) < 0);
});

test("基准缺失时保留策略指标并隐藏累计基准", () => {
  const report = calculatePositionPerformance([trade({ benchmarkEntryClose: null, benchmarkExitClose: null, benchmarkReturn: null, excessReturn: null })]);
  assert.equal(report.benchmarkCumulativeReturn, null);
  assert.equal(report.cumulativeExcessReturn, null);
  assert.equal(report.pathSuccessRate, null);
  assert.equal(report.sharpe, null);
});
