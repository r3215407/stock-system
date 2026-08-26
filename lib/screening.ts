export type ScreeningStage = "加载策略" | "获取证券池" | "基础过滤" | "读取日线" | "评分排名" | "已暂停" | "完成" | "失败" | "已取消";
export type ScreeningStatus = "running" | "paused" | "completed" | "failed" | "cancelled";
export type ScreeningBucket = "candidate" | "watch" | "excluded";

export type ScreeningSecurity = {
  symbol: string;
  code: string;
  name: string;
  market: "上海" | "深圳";
  latestAmount: number;
  industry: string;
};

export type ScreeningFailure = {
  symbol: string;
  code: string;
  name: string;
  market: "上海" | "深圳";
  errorCode: string;
  errorMessage: string;
};

export type ScreeningCandidate = {
  rank: number | null;
  symbol: string;
  code: string;
  name: string;
  market: "上海" | "深圳";
  industry: string;
  bucket: ScreeningBucket;
  conclusion: string;
  score: number;
  technicalScore: number;
  strengthScore: number;
  stopDistanceRate: number;
  riskFactor: number;
  riskLabel: string;
  pressureStatus: "breakout" | "sufficient" | "insufficient";
  averageAmount20: number;
  signalDate: string;
  entryPrice: number;
  initialStopPrice: number;
  firstReason: string;
  rankingReason: string;
};

export type ScreeningJob = {
  jobId: string;
  status: ScreeningStatus;
  stage: ScreeningStage;
  strategyId: string;
  strategyVersion: string;
  parameterVersion: string;
  requestedDate: string | null;
  dataDate: string | null;
  createdAt: string;
  generatedAt: string | null;
  expiresAt: string;
  processed: number;
  universeTotal: number;
  afterBasicFilter: number;
  scored: number;
  failedCount: number;
  rateLimit501Count: number;
  elapsedMs: number;
  provider: string;
  adjustment: "前复权";
  incomplete: boolean;
  error: string | null;
  candidates: ScreeningCandidate[];
  candidateTop10: ScreeningCandidate[];
  exclusions: Array<{ reason: string; count: number }>;
  failures: ScreeningFailure[];
  failureDetailsTotal: number;
  cacheHit: boolean;
};

export type BrowserScreeningBatch = {
  kind: "BATCH";
  batchId: string;
  leaseToken: string;
  securities: ScreeningSecurity[];
  strategyId: string;
  strategyVersion: string;
  requestedDate: string | null;
  environmentScore: number;
};

export type BrowserScreeningWork =
  | BrowserScreeningBatch
  | { kind: "INITIALIZATION" }
  | { kind: "IDLE" };

export const HTTP_501_PAUSE_THRESHOLD = 3;

export function accumulateHttp501Failures(current: number, httpStatus: number | null) {
  const count = current + (httpStatus === 501 ? 1 : 0);
  return { count, shouldPause: count >= HTTP_501_PAUSE_THRESHOLD };
}

export function isChiNextCode(code: string) {
  return /^(?:300|301)\d{3}$/.test(code);
}

export function describeScreeningFailure(error: unknown) {
  const source = error instanceof Error ? error : new Error("未知行情错误");
  const httpStatus = typeof (error as { httpStatus?: unknown } | null)?.httpStatus === "number"
    ? Number((error as { httpStatus: number }).httpStatus)
    : null;
  const upstreamCode = httpStatus === 501
    ? "HTTP_501"
    : typeof (error as { code?: unknown } | null)?.code === "string"
      ? String((error as { code: string }).code)
      : null;
  const errorCode = upstreamCode
    ?? (/timeout|timed out|超时/i.test(source.message) ? "TIMEOUT" : "UPSTREAM_ERROR");
  const errorMessage = (source.message || "行情数据读取失败")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[数据库连接已隐藏]")
    .replace(/https?:\/\/\S+/gi, "[行情地址已隐藏]")
    .slice(0, 240);
  return { errorCode, errorMessage };
}

export function sanitizeScreeningFailure(errorCode: unknown, errorMessage: unknown) {
  const safeCode = typeof errorCode === "string" && /^[A-Z0-9_:-]{1,64}$/i.test(errorCode)
    ? errorCode.toUpperCase()
    : "UPSTREAM_ERROR";
  const safeMessage = (typeof errorMessage === "string" && errorMessage.trim() ? errorMessage : "行情数据读取失败")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[数据库连接已隐藏]")
    .replace(/https?:\/\/\S+/gi, "[行情地址已隐藏]")
    .slice(0, 240);
  return { errorCode: safeCode, errorMessage: safeMessage };
}

export function rankScreeningResults(results: ScreeningCandidate[], topN: number) {
  return [...results]
    .sort((left, right) =>
      right.score - left.score
      || right.strengthScore - left.strengthScore
      || left.stopDistanceRate - right.stopDistanceRate
      || right.averageAmount20 - left.averageAmount20
      || left.code.localeCompare(right.code))
    .slice(0, Math.max(0, topN))
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export function rankCandidateResults(results: ScreeningCandidate[], topN: number) {
  return rankScreeningResults(results.filter((item) => item.bucket === "candidate"), topN);
}
