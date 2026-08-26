import assert from "node:assert/strict";
import test from "node:test";

import {
  ETF_POOL,
  calculateMomentum,
  calculateSharpeRatio,
  isChinaTradingDay,
  rankMomentumInputs,
  RotationDataError,
} from "../lib/etf-rotation.ts";

test("动量公式对严格指数序列给出 R²=1", () => {
  const slope = 0.001;
  const prices = Array.from({ length: 25 }, (_, index) => Math.exp(4 + slope * index));
  const result = calculateMomentum(prices);
  assert.ok(Math.abs(result.rSquared - 1) < 1e-12);
  assert.ok(Math.abs(result.momentum - (Math.exp(slope * 250) - 1)) < 1e-12);
  assert.ok(Math.abs(result.score - result.momentum) < 1e-12);
});

test("所有得分为负时仍选择最高分，不增加空仓过滤", () => {
  const inputs = ETF_POOL.map((symbol, index) => ({
    symbol,
    name: null,
    currentPrice: 100 - index,
    marketDataAt: "2026-08-26T06:45:00.000Z",
    completedCloses: Array.from({ length: 24 }, (_, day) => 130 - day * (1 + index * 0.01)),
  }));
  const ranked = rankMomentumInputs(inputs);
  assert.equal(ranked.length, 9);
  assert.ok(ranked.every((item) => item.score < 0));
  assert.equal(ranked[0].rank, 1);
});

test("得分完全相同时按固定池顺序稳定排序", () => {
  const inputs = ETF_POOL.map((symbol) => ({
    symbol,
    name: null,
    currentPrice: 125,
    marketDataAt: "2026-08-26T06:45:00.000Z",
    completedCloses: Array.from({ length: 24 }, (_, day) => 100 + day),
  }));
  assert.deepEqual(rankMomentumInputs(inputs).map((item) => item.symbol), ETF_POOL);
});

test("历史价格不足时整池失败", () => {
  const inputs = ETF_POOL.map((symbol) => ({
    symbol,
    name: null,
    currentPrice: 10,
    marketDataAt: "2026-08-26T06:45:00.000Z",
    completedCloses: Array(23).fill(9),
  }));
  assert.throws(() => rankMomentumInputs(inputs), (error) => error instanceof RotationDataError && error.code === "INSUFFICIENT_HISTORY");
});

test("夏普比率需要至少两个日收益率且标准差大于 0", () => {
  assert.equal(calculateSharpeRatio([
    { snapshotDate: "2026-06-08", totalValue: 100000, cumulativeReturn: 0, annualizedReturn: 0 },
  ]), null);
  assert.equal(calculateSharpeRatio([
    { snapshotDate: "2026-06-08", totalValue: 100000, cumulativeReturn: 0, annualizedReturn: 0 },
    { snapshotDate: "2026-06-09", totalValue: 101000, cumulativeReturn: 0.01, annualizedReturn: 0.01 },
    { snapshotDate: "2026-06-10", totalValue: 102010, cumulativeReturn: 0.0201, annualizedReturn: 0.02 },
  ]), null);
  const sharpe = calculateSharpeRatio([
    { snapshotDate: "2026-06-08", totalValue: 100000, cumulativeReturn: 0, annualizedReturn: 0 },
    { snapshotDate: "2026-06-09", totalValue: 101000, cumulativeReturn: 0.01, annualizedReturn: 0.01 },
    { snapshotDate: "2026-06-10", totalValue: 100495, cumulativeReturn: 0.00495, annualizedReturn: 0.01 },
  ]);
  assert.ok(sharpe !== null && Number.isFinite(sharpe));
});

test("交易日识别排除周末与 2026 年交易所休市日", () => {
  assert.equal(isChinaTradingDay("2026-08-26"), true);
  assert.equal(isChinaTradingDay("2026-08-29"), false);
  assert.equal(isChinaTradingDay("2026-10-01"), false);
});
