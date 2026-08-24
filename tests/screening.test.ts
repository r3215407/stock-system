import assert from "node:assert/strict";
import test from "node:test";

import { rankScreeningResults, type ScreeningCandidate } from "../lib/screening.ts";

function candidate(code: string, score: number, bucket: ScreeningCandidate["bucket"]): ScreeningCandidate {
  return { rank: null, symbol: `${code}.SH`, code, name: code, market: "上海", industry: "测试", bucket, conclusion: bucket === "candidate" ? "候选" : "已排除", score, technicalScore: score, strengthScore: score / 2, stopDistanceRate: 0.05, riskFactor: 1, riskLabel: "正常风险", pressureStatus: "sufficient", averageAmount20: 100_000_000, signalDate: "2026-08-24", entryPrice: 10, initialStopPrice: 9.5, firstReason: "测试", rankingReason: "测试" };
}

test("全市场排名返回前10且不按达标桶过滤", () => {
  const results = Array.from({ length: 12 }, (_, index) => candidate(String(600000 + index), index, index % 2 ? "excluded" : "candidate"));
  const ranked = rankScreeningResults(results, 10);
  assert.equal(ranked.length, 10);
  assert.equal(ranked[0].score, 11);
  assert.equal(ranked[0].rank, 1);
  assert.ok(ranked.some((item) => item.bucket === "excluded"));
});
