export type EvaluationStatus = "pass" | "fail" | "pending";
export type ScoreDetailStatus = EvaluationStatus | "partial";

export type ScoreModule = {
  id: string;
  label: string;
  earned: number;
  determined: number;
  total: number;
  passed: number;
  failed: number;
  pending: number;
  partial?: number;
  reason: string;
  details?: Array<{
    label: string;
    value: string;
    status: ScoreDetailStatus;
    points?: number;
    maximumPoints?: number;
  }>;
  source: "自动" | "用户确认" | "混合";
};

export type AutomaticFilter = {
  id: string;
  label: string;
  detail: string;
  status: EvaluationStatus;
};

export type MarketDataSnapshot = {
  symbol: string;
  name: string;
  instrumentType: "A股" | "交易所交易基金";
  market: string;
  dataDate: string;
  open: number;
  close: number;
  records: number;
  adjustment: string;
  stage: string;
  completeness: number;
  fetchedAt: string;
  provider: string;
  benchmark: string;
  plannedEntryPrice: number;
  initialStopPrice: number;
  resistancePrice: number;
  stopAlgorithm: string;
  stopDistanceRate: number;
  pressureStatus: "breakout" | "sufficient" | "critical" | "insufficient";
  pressureDistanceRate: number;
  rewardRiskRatio: number | null;
  entryTriggerPassed: boolean;
  automaticFilters: AutomaticFilter[];
  automaticModules: ScoreModule[];
  t1Open: null | {
    date: string;
    open: number;
    gapRate: number;
    status: "pass" | "fail";
  };
};

export const scorePositionRules = [
  { minScore: 90, riskBudgetRate: 0.0075, label: "高匹配" },
  { minScore: 80, riskBudgetRate: 0.005, label: "标准交易" },
  { minScore: 70, riskBudgetRate: 0.0025, label: "允许试仓" },
] as const;

export const modelVersion = "0.4";
export const minimumTechnicalScore = 65;
export const minimumStrengthScore = 21;
export const riskBufferRate = 0.1;

export function getScorePositionRule(score: number) {
  return scorePositionRules.find((rule) => score >= rule.minScore);
}

export function getPullbackAmplitudeScore(rate: number) {
  if (rate >= 0.03 && rate < 0.06) return 7;
  if ((rate >= 0.02 && rate < 0.03) || (rate >= 0.06 && rate < 0.08)) return 5;
  if (rate >= 0.08 && rate < 0.1) return 3;
  return 0;
}

export function getMa20DistanceScore(rate: number) {
  if (rate <= 0.03) return 6;
  if (rate <= 0.05) return 3;
  return 0;
}

export function getMa60RelationshipScore(minimumCloseToMa60: number) {
  if (minimumCloseToMa60 >= 1) return 6;
  if (minimumCloseToMa60 >= 0.98) return 3;
  return 0;
}

export function getStopDistanceRiskAdjustment(stopDistanceRate: number, score: number) {
  if (stopDistanceRate <= 0 || stopDistanceRate > 0.12) {
    return { factor: 0, executable: false, label: "超过可执行范围" } as const;
  }
  if (stopDistanceRate <= 0.08) {
    return { factor: 1, executable: true, label: "正常风险" } as const;
  }
  if (stopDistanceRate <= 0.1) {
    return { factor: 0.5, executable: true, label: "半风险" } as const;
  }
  return score >= 80
    ? { factor: 0.25, executable: true, label: "四分之一风险" } as const
    : { factor: 0.25, executable: false, label: "需总分至少80分" } as const;
}

export function normalizeSymbol(input: string | string[] | undefined) {
  const raw = Array.isArray(input) ? input[0] : input;
  if (!raw) return { raw: "", normalized: "", valid: false };

  const normalizedInput = raw.trim().toUpperCase();
  const match = normalizedInput.match(/^(\d{6})$/);
  if (!match) return { raw: normalizedInput, normalized: "", valid: false };

  const code = match[1];
  const inferredMarket = /^(?:4|8|92)/.test(code) ? "BJ" : /^[56]/.test(code) ? "SH" : "SZ";
  return {
    raw: normalizedInput,
    normalized: `${code}.${inferredMarket}`,
    valid: true,
  };
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
