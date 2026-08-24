export type ScreeningStage = "加载策略" | "获取证券池" | "基础过滤" | "读取日线" | "评分排名" | "完成" | "失败" | "已取消";
export type ScreeningStatus = "running" | "completed" | "failed" | "cancelled";
export type ScreeningBucket = "candidate" | "watch" | "excluded";

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
  elapsedMs: number;
  provider: string;
  adjustment: "前复权";
  incomplete: boolean;
  error: string | null;
  candidates: ScreeningCandidate[];
  watch: ScreeningCandidate[];
  exclusions: Array<{ reason: string; count: number }>;
  cacheHit: boolean;
};

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
