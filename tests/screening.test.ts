import assert from "node:assert/strict";
import test from "node:test";

import {
  accumulateScreeningFailures,
  accumulateScreeningWorkerFailures,
  describeScreeningFailure,
  isChiNextCode,
  rankCandidateResults,
  rankScreeningResults,
  sanitizeScreeningFailure,
  type ScreeningCandidate,
} from "../lib/screening.ts";

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

test("候选排名只返回已触发候选且最多10只", () => {
  const results = Array.from({ length: 24 }, (_, index) => candidate(String(600100 + index), index, index % 2 ? "watch" : "candidate"));
  const ranked = rankCandidateResults(results, 10);
  assert.equal(ranked.length, 10);
  assert.ok(ranked.every((item) => item.bucket === "candidate"));
  assert.deepEqual(ranked.map((item) => item.rank), [1,2,3,4,5,6,7,8,9,10]);
});

test("扫描失败摘要保留上游错误类型并隐藏外部地址", () => {
  const error = Object.assign(new Error("request https://example.com/path?token=secret failed"), { code: "NOT_FOUND" });
  assert.deepEqual(describeScreeningFailure(error), {
    errorCode: "NOT_FOUND",
    errorMessage: "request [行情地址已隐藏] failed",
  });
});

test("扫描超时使用稳定的错误类型", () => {
  assert.deepEqual(describeScreeningFailure(new Error("request timed out")), {
    errorCode: "TIMEOUT",
    errorMessage: "request timed out",
  });
});

test("全市场扫描暂时排除300和301开头的创业板股票", () => {
  assert.equal(isChiNextCode("300750"), true);
  assert.equal(isChiNextCode("301269"), true);
  assert.equal(isChiNextCode("002594"), false);
  assert.equal(isChiNextCode("600519"), false);
});

test("浏览器提交的失败信息限制错误码并隐藏地址", () => {
  assert.deepEqual(sanitizeScreeningFailure("timeout", "fetch https://example.com/a failed"), {
    errorCode: "TIMEOUT",
    errorMessage: "fetch [行情地址已隐藏] failed",
  });
  assert.equal(sanitizeScreeningFailure("<script>", "").errorCode, "UPSTREAM_ERROR");
});

test("HTTP 501 使用独立错误码供失败明细识别", () => {
  const error = Object.assign(new Error("腾讯行情请求过密或暂不可用（HTTP 501）"), { code: "RATE_LIMITED", httpStatus: 501 });
  assert.deepEqual(describeScreeningFailure(error), {
    errorCode: "HTTP_501",
    errorMessage: "腾讯行情请求过密或暂不可用（HTTP 501）",
  });
});

test("任意行情失败累计到第三次时暂停", () => {
  const first = accumulateScreeningFailures(0);
  const second = accumulateScreeningFailures(first.count);
  const third = accumulateScreeningFailures(second.count);
  assert.deepEqual(first, { count: 1, shouldPause: false });
  assert.deepEqual(second, { count: 2, shouldPause: false });
  assert.deepEqual(third, { count: 3, shouldPause: true });
});

test("扫描 Worker 连续失败三次后暂停并等待用户继续", () => {
  const first = accumulateScreeningWorkerFailures(0);
  const second = accumulateScreeningWorkerFailures(first.count);
  const third = accumulateScreeningWorkerFailures(second.count);
  assert.deepEqual(first, { count: 1, shouldPause: false });
  assert.deepEqual(second, { count: 2, shouldPause: false });
  assert.deepEqual(third, { count: 3, shouldPause: true });
});
