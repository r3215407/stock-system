import { closePositionPlanItem, deletePositionPlanItem, getPositionPlan, updatePositionPlanItem } from "@/lib/position-plan-db";
import { PositionPlanConflictError } from "@/lib/position-plan";
import { cleanBars, fetchMarketBars } from "@/lib/market-data";

function failure(error: unknown) {
  if (error instanceof PositionPlanConflictError) return Response.json({ code: "REVISION_CONFLICT", message: error.message, latest: error.latest }, { status: 409 });
  return Response.json({ code: "POSITION_PLAN_ERROR", message: error instanceof Error ? error.message : "仓位项写入失败" }, { status: 500 });
}

function validId(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!validId(id)) return Response.json({ message: "仓位项 id 无效" }, { status: 400 });
    const body = await request.json() as Record<string, unknown>;
    const revision = Number(body.revision);
    const changes = body.changes && typeof body.changes === "object" ? body.changes as Record<string, unknown> : {};
    if (!Number.isInteger(revision) || revision < 0) return Response.json({ message: "revision 无效" }, { status: 400 });
    const latest = await getPositionPlan();
    const current = latest.items.find((item) => item.id === id);
    if (!current) return Response.json({ message: "仓位项不存在" }, { status: 404 });
    const merged = { ...current, ...changes };
    if (merged.positionState !== "planned" && merged.positionState !== "held") return Response.json({ message: "仓位状态无效" }, { status: 400 });
    if (merged.positionState === "held") {
      const costHasValidPrecision = Math.round(Number(merged.averageCost) * 1000) === Number(merged.averageCost) * 1000;
      if (!(Number(merged.averageCost) > 0) || !costHasValidPrecision || !Number.isInteger(Number(merged.actualShares)) || Number(merged.actualShares) <= 0 || !(Number(merged.initialStopPrice) > 0) || Number(merged.initialStopPrice) >= Number(merged.averageCost) || !/^\d{4}-\d{2}-\d{2}$/.test(String(merged.purchaseDate ?? ""))) {
        return Response.json({ message: "已持有状态需要有效成本、股数、买入日期，且初始止损必须低于成本" }, { status: 400 });
      }
    }
    return Response.json(await updatePositionPlanItem(id, { revision, changes }));
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const revision = Number(body.revision);
    if (!validId(id) || !Number.isInteger(revision)) return Response.json({ message: "删除参数无效" }, { status: 400 });
    return Response.json(await deletePositionPlanItem(id, revision));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const revision = Number(body.revision);
    const exitPrice = Number(body.exitPrice);
    const exitDate = String(body.exitDate ?? "");
    const exitReason = String(body.exitReason ?? "").trim();
    const reviewNote = String(body.reviewNote ?? "").trim();
    if (!validId(id) || !Number.isInteger(revision) || revision < 0 || !(exitPrice > 0)
      || !/^\d{4}-\d{2}-\d{2}$/.test(exitDate) || !exitReason || exitReason.length > 80 || reviewNote.length > 1000) {
      return Response.json({ message: "卖出日期、价格或复盘信息无效" }, { status: 400 });
    }
    const latest = await getPositionPlan();
    const item = latest.items.find((candidate) => candidate.id === id);
    if (!item || item.positionState !== "held" || !item.purchaseDate) return Response.json({ message: "仅已持有仓位可以卖出归档" }, { status: 400 });
    if (exitDate < item.purchaseDate) return Response.json({ message: "卖出日期不能早于买入日期" }, { status: 400 });
    const [stock, benchmark] = await Promise.all([
      fetchMarketBars(item.symbol, 1500),
      fetchMarketBars("000300.SH", 1500).catch(() => null),
    ]);
    const stockDates = cleanBars(stock.bars).filter((bar) => bar.date >= item.purchaseDate! && bar.date <= exitDate);
    if (!stockDates.length) return Response.json({ message: "买卖日期之间没有可用交易日，请检查日期" }, { status: 400 });
    const benchmarkBars = benchmark ? cleanBars(benchmark.bars) : [];
    const benchmarkEntry = [...benchmarkBars].reverse().find((bar) => bar.date <= item.purchaseDate!);
    const benchmarkExit = [...benchmarkBars].reverse().find((bar) => bar.date <= exitDate);
    const benchmarkReturn = benchmarkEntry && benchmarkExit && benchmarkExit.date >= benchmarkEntry.date
      ? benchmarkExit.close / benchmarkEntry.close - 1
      : null;
    return Response.json(await closePositionPlanItem(id, {
      revision,
      exitDate,
      exitPrice,
      holdingDays: Math.max(1, stockDates.length),
      benchmarkEntryClose: benchmarkEntry?.close ?? null,
      benchmarkExitClose: benchmarkExit?.close ?? null,
      benchmarkReturn,
      exitReason,
      reviewNote,
    }));
  } catch (error) {
    return failure(error);
  }
}
