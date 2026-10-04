import assert from "node:assert/strict";
import test from "node:test";

import {
  accumulateScreeningFailures,
  accumulateScreeningWorkerFailures,
  describeScreeningFailure,
  getBasicScreeningExclusion,
  hasMinimumListingTradingDays,
  isChiNextCode,
  normalizeListingDate,
  rankCandidateResults,
  rankScreeningResults,
  sanitizeScreeningFailure,
  type ScreeningCandidate,
  type ScreeningSecurity,
} from "../lib/screening.ts";

function candidate(code: string, score: number, bucket: ScreeningCandidate["bucket"]): ScreeningCandidate {
  return { rank: null, symbol: `${code}.SH`, code, name: code, market: "上海", industry: "测试", bucket, conclusion: bucket === "candidate" ? "候选" : "已排除", score, technicalScore: score, strengthScore: score / 2, stopDistanceRate: 0.05, riskFactor: 1, riskLabel: "正常风险", pressureStatus: "sufficient", averageAmount20: 100_000_000, signalDate: "2026-08-24", entryPrice: 10, initialStopPrice: 9.5, firstReason: "测试", rankingReason: "测试" };
}

function security(overrides: Partial<ScreeningSecurity> = {}): ScreeningSecurity {
  return {
    symbol: "600000.SH",
    code: "600000",
    name: "测试股份",
    market: "上海",
    latestPrice: 10,
    latestAmount: 100_000_000,
    listingDate: "2020-01-01",
    industry: "测试",
    ...overrides,
  };
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

test("上市日期快照支持东方财富数字日期并拒绝无效日期", () => {
  assert.equal(normalizeListingDate(20251008), "2025-10-08");
  assert.equal(normalizeListingDate("2025-10-08"), "2025-10-08");
  assert.equal(normalizeListingDate("2025-02-30"), null);
  assert.equal(normalizeListingDate("-"), null);
});

test("只有明确晚于第250个交易日边界的股票才在快照阶段排除", () => {
  assert.equal(hasMinimumListingTradingDays("2025-09-30", "2025-10-01"), true);
  assert.equal(hasMinimumListingTradingDays("2025-10-01", "2025-10-01"), true);
  assert.equal(hasMinimumListingTradingDays("2025-10-02", "2025-10-01"), false);
  assert.equal(hasMinimumListingTradingDays(null, "2025-10-01"), true);
});

test("实时快照先排除风险名称、无报价和上市日不足", () => {
  const options = { useLiveSnapshot: true, oldestRequiredTradingDate: "2025-10-01" };
  assert.equal(getBasicScreeningExclusion(security({ name: "*ST测试" }), options), "ST / 退市风险");
  assert.equal(getBasicScreeningExclusion(security({ latestPrice: 0 }), options), "停牌或无有效报价");
  assert.equal(getBasicScreeningExclusion(security({ listingDate: "2025-10-02" }), options), "上市不足250个交易日");
  assert.equal(getBasicScreeningExclusion(security(), options), null);
});

test("历史日期扫描只应用与今天状态无关的板块过滤", () => {
  const historical = { useLiveSnapshot: false, oldestRequiredTradingDate: "2025-10-01" };
  assert.equal(getBasicScreeningExclusion(security({ name: "*ST测试", latestPrice: 0, listingDate: "2025-10-02" }), historical), null);
  assert.equal(getBasicScreeningExclusion(security({ code: "300750", symbol: "300750.SZ" }), historical), "创业板（暂不扫描）");
});

test("扫描 Worker 连续失败三次后暂停并等待用户继续", () => {
  const first = accumulateScreeningWorkerFailures(0);
  const second = accumulateScreeningWorkerFailures(first.count);
  const third = accumulateScreeningWorkerFailures(second.count);
  assert.deepEqual(first, { count: 1, shouldPause: false });
  assert.deepEqual(second, { count: 2, shouldPause: false });
  assert.deepEqual(third, { count: 3, shouldPause: true });
});
