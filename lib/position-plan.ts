export type PositionState = "planned" | "held";
export type PositionSource = "individual-evaluation" | "market-screening" | "shared-link";
export type ConfirmationState = "confirmed" | "pending-t1-open";

export type PositionPlanItemRecord = {
  id: string;
  symbol: string;
  name: string;
  industry: string;
  priority: number;
  positionState: PositionState;
  strategyId: string;
  strategyVersion: string;
  parameterVersion: string;
  score: number;
  technicalScore: number;
  strengthScore: number;
  signalDate: string;
  plannedEntryPrice: number;
  initialStopPrice: number;
  existingStockValue: number;
  existingIndustryValue: number;
  averageCost: number | null;
  actualShares: number | null;
  purchaseDate: string | null;
  source: PositionSource;
  confirmationState: ConfirmationState;
  updatedAt: string;
};

export type PositionTradeRecord = {
  id: string;
  symbol: string;
  name: string;
  industry: string;
  strategyId: string;
  strategyVersion: string;
  parameterVersion: string;
  score: number;
  technicalScore: number;
  strengthScore: number;
  signalDate: string;
  purchaseDate: string;
  exitDate: string;
  averageCost: number;
  exitPrice: number;
  actualShares: number;
  initialStopPrice: number;
  grossProfit: number;
  netProfit: number;
  returnRate: number;
  rMultiple: number;
  holdingDays: number;
  benchmarkEntryClose: number | null;
  benchmarkExitClose: number | null;
  benchmarkReturn: number | null;
  excessReturn: number | null;
  exitReason: string;
  reviewNote: string;
  source: PositionSource;
  createdAt: string;
};

export type PositionPlanRecord = {
  planKey: "default-simulation";
  accountEquity: number;
  currentOpenRisk: number;
  threeConsecutiveStops: boolean;
  revision: number;
  updatedAt: string;
  items: PositionPlanItemRecord[];
  history: PositionTradeRecord[];
};

export type NewPositionPlanItem = Omit<PositionPlanItemRecord, "id" | "priority" | "positionState" | "averageCost" | "actualShares" | "purchaseDate" | "updatedAt">;

export class PositionPlanConflictError extends Error {
  constructor(public readonly latest: PositionPlanRecord) {
    super("模拟盘已在其他页面更新");
    this.name = "PositionPlanConflictError";
  }
}

export class PositionSignalConflictError extends Error {
  constructor(public readonly current: PositionPlanItemRecord) {
    super("同一股票已有不同信号");
    this.name = "PositionSignalConflictError";
  }
}
