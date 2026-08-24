import { getScorePositionRule, getStopDistanceRiskAdjustment, riskBufferRate } from "./evaluation.ts";

export type PositionCandidateInput = {
  symbol: string;
  name: string;
  industry: string;
  rank: number;
  score: number;
  entryPrice: number;
  initialStopPrice: number;
  existingStockValue?: number;
  existingIndustryValue?: number;
};

export type PositionPlanInput = {
  accountEquity: number;
  currentOpenRisk: number;
  threeConsecutiveStops: boolean;
  candidates: PositionCandidateInput[];
};

export type PositionPlanItem = PositionCandidateInput & {
  stopDistanceRate: number;
  riskFactor: number;
  riskLabel: string;
  shares: number;
  plannedValue: number;
  plannedLoss: number;
  allocationRate: number;
  limitingReason: string;
};

export type PositionPlan = {
  items: PositionPlanItem[];
  plannedValue: number;
  plannedValueRate: number;
  addedRisk: number;
  totalInitialRisk: number;
  remainingRisk: number;
};

function floorLots(value: number) {
  return Math.max(0, Math.floor(value / 100) * 100);
}

export function calculatePositionPlan(input: PositionPlanInput): PositionPlan {
  const equity = Math.max(0, input.accountEquity);
  const riskCap = equity * 0.02;
  let occupiedRisk = Math.max(0, input.currentOpenRisk);
  let plannedValue = 0;
  let addedRisk = 0;
  const industryPlanned = new Map<string, number>();

  const items = input.candidates.map((candidate): PositionPlanItem => {
    const entryPrice = Math.max(0, candidate.entryPrice);
    const perShareRisk = entryPrice - candidate.initialStopPrice;
    const stopDistanceRate = entryPrice > 0 ? perShareRisk / entryPrice : 0;
    const scoreRule = getScorePositionRule(candidate.score);
    const stopRule = getStopDistanceRiskAdjustment(stopDistanceRate, candidate.score);
    const remainingRisk = Math.max(0, riskCap - occupiedRisk);
    const baseRisk = scoreRule
      ? equity * scoreRule.riskBudgetRate * stopRule.factor * (input.threeConsecutiveStops ? 0.5 : 1)
      : 0;
    const usableRisk = Math.min(baseRisk, remainingRisk) * (1 - riskBufferRate);
    const riskShares = perShareRisk > 0 && stopRule.executable ? floorLots(usableRisk / perShareRisk) : 0;
    const stockCapacity = Math.max(0, equity * 0.15 - (candidate.existingStockValue ?? 0));
    const industryCapacity = Math.max(
      0,
      equity * 0.3 - (candidate.existingIndustryValue ?? 0) - (industryPlanned.get(candidate.industry) ?? 0),
    );
    const valueShares = entryPrice > 0 ? floorLots(Math.min(stockCapacity, industryCapacity) / entryPrice) : 0;
    const shares = Math.min(riskShares, valueShares);
    const plannedItemValue = shares * entryPrice;
    const plannedLoss = shares * Math.max(0, perShareRisk);
    let limitingReason = "风险预算";
    if (!scoreRule) limitingReason = "评分档位不可执行";
    else if (!stopRule.executable || perShareRisk <= 0) limitingReason = "止损距离不可执行";
    else if (shares < 100) limitingReason = "整手约束";
    else if (valueShares < riskShares) limitingReason = stockCapacity <= industryCapacity ? "单股15%上限" : "行业30%上限";
    else if (remainingRisk <= baseRisk) limitingReason = "组合风险2%上限";

    occupiedRisk += plannedLoss;
    addedRisk += plannedLoss;
    plannedValue += plannedItemValue;
    industryPlanned.set(candidate.industry, (industryPlanned.get(candidate.industry) ?? 0) + plannedItemValue);
    return {
      ...candidate,
      entryPrice,
      stopDistanceRate,
      riskFactor: stopRule.factor,
      riskLabel: stopRule.label,
      shares,
      plannedValue: plannedItemValue,
      plannedLoss,
      allocationRate: equity > 0 ? plannedItemValue / equity : 0,
      limitingReason,
    };
  });

  return {
    items,
    plannedValue,
    plannedValueRate: equity > 0 ? plannedValue / equity : 0,
    addedRisk,
    totalInitialRisk: Math.max(0, input.currentOpenRisk) + addedRisk,
    remainingRisk: Math.max(0, riskCap - occupiedRisk),
  };
}
