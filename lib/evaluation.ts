export type EvaluationStatus = "pass" | "fail" | "pending";

export type ScoreModule = {
  id: string;
  label: string;
  earned: number;
  determined: number;
  total: number;
  passed: number;
  failed: number;
  pending: number;
  reason: string;
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

export const modelVersion = "0.2";
export const minimumTechnicalScore = 65;
export const minimumStrengthScore = 21;
export const riskBufferRate = 0.1;

export function getScorePositionRule(score: number) {
  return scorePositionRules.find((rule) => score >= rule.minScore);
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
