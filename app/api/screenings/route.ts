import { getCurrentScreeningJob, prepareScreeningJob } from "@/lib/screening-jobs";
import { currentStrategy, getStrategy } from "@/lib/strategies";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    return Response.json(
      { data: await getCurrentScreeningJob(currentStrategy) ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json({ error: { code: "DATABASE_UNAVAILABLE", message: error instanceof Error ? `任务状态读取失败：${error.message}` : "任务状态读取失败。" } }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let body: { strategyId?: unknown; strategyVersion?: unknown; scanDate?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return Response.json({ error: { code: "INVALID_BODY", message: "请求内容必须是有效 JSON。" } }, { status: 400 }); }
  const strategyId = typeof body.strategyId === "string" ? body.strategyId : "";
  const strategyVersion = typeof body.strategyVersion === "string" ? body.strategyVersion : "";
  const strategy = getStrategy(strategyId, strategyVersion);
  if (!strategy || strategy.status === "disabled") return Response.json({ error: { code: "STRATEGY_NOT_FOUND", message: "策略不存在或未启用。" } }, { status: 404 });
  const scanDate = typeof body.scanDate === "string" && body.scanDate ? body.scanDate : null;
  if (scanDate && !/^\d{4}-\d{2}-\d{2}$/.test(scanDate)) return Response.json({ error: { code: "INVALID_DATE", message: "扫描日期格式应为 YYYY-MM-DD。" } }, { status: 400 });
  try {
    const { job, created } = await prepareScreeningJob(strategy, scanDate);
    return Response.json({ data: job }, { status: job?.status === "running" || created ? 202 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: { code: "SCREENING_SETUP_FAILED", message: error instanceof Error ? error.message : "扫描任务初始化失败。" } }, { status: 503 });
  }
}
