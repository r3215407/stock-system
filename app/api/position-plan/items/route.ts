import { addPositionPlanItem, clearPositionPlan } from "@/lib/position-plan-db";
import { PositionPlanConflictError, PositionSignalConflictError, type ConfirmationState, type NewPositionPlanItem, type PositionSource } from "@/lib/position-plan";
import { normalizeSymbol } from "@/lib/evaluation";

function failure(error: unknown) {
  if (error instanceof PositionPlanConflictError) return Response.json({ code: "REVISION_CONFLICT", message: error.message, latest: error.latest }, { status: 409 });
  if (error instanceof PositionSignalConflictError) return Response.json({ code: "SIGNAL_REPLACE_REQUIRED", message: error.message, current: error.current }, { status: 409 });
  return Response.json({ code: "POSITION_PLAN_ERROR", message: error instanceof Error ? error.message : "仓位项写入失败" }, { status: 500 });
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const sourceItem = (body.item && typeof body.item === "object" ? body.item : body) as Record<string, unknown>;
    const revision = Number(body.revision);
    const symbol = normalizeSymbol(text(sourceItem.symbol));
    const source = text(sourceItem.source) as PositionSource;
    const confirmationState = text(sourceItem.confirmationState) as ConfirmationState;
    const item: NewPositionPlanItem = {
      symbol: symbol.normalized,
      name: text(sourceItem.name),
      industry: text(sourceItem.industry, "未分类") || "未分类",
      strategyId: text(sourceItem.strategyId),
      strategyVersion: text(sourceItem.strategyVersion),
      parameterVersion: text(sourceItem.parameterVersion),
      score: Number(sourceItem.score),
      technicalScore: Number(sourceItem.technicalScore),
      strengthScore: Number(sourceItem.strengthScore),
      signalDate: text(sourceItem.signalDate),
      plannedEntryPrice: Number(sourceItem.plannedEntryPrice),
      initialStopPrice: Number(sourceItem.initialStopPrice),
      existingStockValue: Number(sourceItem.existingStockValue ?? 0),
      existingIndustryValue: Number(sourceItem.existingIndustryValue ?? 0),
      source,
      confirmationState,
    };
    const numeric = [item.score, item.technicalScore, item.strengthScore, item.plannedEntryPrice, item.initialStopPrice, item.existingStockValue, item.existingIndustryValue];
    if (!Number.isInteger(revision) || revision < 0 || !symbol.valid || !item.name || !item.strategyId || !item.strategyVersion || !item.parameterVersion || !/^\d{4}-\d{2}-\d{2}$/.test(item.signalDate) || numeric.some((value) => !Number.isFinite(value)) || item.plannedEntryPrice <= 0 || item.initialStopPrice <= 0) {
      return Response.json({ message: "仓位项字段不完整或格式无效" }, { status: 400 });
    }
    if (!(["individual-evaluation", "market-screening", "shared-link"] as string[]).includes(source) || !(["confirmed", "pending-t1-open"] as string[]).includes(confirmationState)) return Response.json({ message: "来源或确认状态无效" }, { status: 400 });
    return Response.json(await addPositionPlanItem({ revision, item, replaceSignal: body.replaceSignal === true }));
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const revision = Number(body.revision);
    if (body.confirm !== "CLEAR_DEFAULT_SIMULATION" || !Number.isInteger(revision)) return Response.json({ message: "清空确认无效" }, { status: 400 });
    return Response.json(await clearPositionPlan(revision));
  } catch (error) {
    return failure(error);
  }
}
