import assert from "node:assert/strict";
import test from "node:test";

import { calculatePositionPlan } from "../lib/positions.ts";

test("仓位方案依次占用组合风险并保留10%缓冲", () => {
  const plan = calculatePositionPlan({
    accountEquity: 100_000,
    currentOpenRisk: 1_700,
    threeConsecutiveStops: false,
    candidates: [
      { symbol: "000001", name: "甲", industry: "银行", rank: 1, score: 90, entryPrice: 10, initialStopPrice: 9 },
      { symbol: "000002", name: "乙", industry: "科技", rank: 2, score: 90, entryPrice: 10, initialStopPrice: 9 },
    ],
  });
  assert.equal(plan.items[0].shares, 200);
  assert.equal(plan.items[0].plannedLoss, 200);
  assert.equal(plan.items[1].shares, 0);
  assert.ok(plan.totalInitialRisk <= 2_000);
});

test("连续三笔完整止损令单笔基础风险减半", () => {
  const candidate = { symbol: "000001", name: "甲", industry: "银行", rank: 1, score: 90, entryPrice: 10, initialStopPrice: 9.5 };
  const normal = calculatePositionPlan({ accountEquity: 100_000, currentOpenRisk: 0, threeConsecutiveStops: false, candidates: [candidate] });
  const reduced = calculatePositionPlan({ accountEquity: 100_000, currentOpenRisk: 0, threeConsecutiveStops: true, candidates: [candidate] });
  assert.ok(reduced.items[0].plannedLoss <= normal.items[0].plannedLoss / 2);
});

test("不足一手时返回0股和整手约束", () => {
  const plan = calculatePositionPlan({ accountEquity: 10_000, currentOpenRisk: 0, threeConsecutiveStops: false, candidates: [{ symbol: "600000", name: "甲", industry: "银行", rank: 1, score: 70, entryPrice: 100, initialStopPrice: 90 }] });
  assert.equal(plan.items[0].shares, 0);
  assert.equal(plan.items[0].limitingReason, "整手约束");
});
