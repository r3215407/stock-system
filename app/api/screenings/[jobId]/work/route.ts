import { claimBrowserScreeningWork, getScreeningJob, submitBrowserScreeningWork } from "@/lib/screening-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  if (!UUID_PATTERN.test(jobId)) {
    return Response.json({ error: { code: "INVALID_JOB_ID", message: "扫描任务编号无效。" } }, { status: 400 });
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: { code: "CROSS_ORIGIN_FORBIDDEN", message: "仅允许当前页面驱动扫描任务。" } }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({})) as {
      action?: unknown;
      batchId?: unknown;
      leaseToken?: unknown;
      results?: unknown;
      failures?: unknown;
      shortHistorySymbols?: unknown;
      unprocessedSymbols?: unknown;
      dataDate?: unknown;
    };
    const action = body.action === "pause" ? "pause" : body.action === "complete" ? "complete" : "claim";
    const current = await getScreeningJob(jobId);
    if (!current) {
      return Response.json({ error: { code: "JOB_EXPIRED", message: "扫描任务不存在或已过期，请重新运行。" } }, { status: 410 });
    }
    if (current.status !== "running") {
      return Response.json({ data: current, work: { processed: false, reason: "JOB_NOT_RUNNING" } }, { headers: { "Cache-Control": "no-store" } });
    }

    let work: unknown;
    if (action === "complete" || action === "pause") {
      if (typeof body.batchId !== "string" || !UUID_PATTERN.test(body.batchId)
        || typeof body.leaseToken !== "string" || !UUID_PATTERN.test(body.leaseToken)
        || !Array.isArray(body.results) || !Array.isArray(body.failures) || !Array.isArray(body.shortHistorySymbols)
        || (action === "pause" && !Array.isArray(body.unprocessedSymbols))
        || body.results.length > 100 || body.failures.length > 100 || body.shortHistorySymbols.length > 100
        || (Array.isArray(body.unprocessedSymbols) && body.unprocessedSymbols.length > 100)
        || (body.dataDate !== null && typeof body.dataDate !== "string")) {
        return Response.json({ error: { code: "INVALID_WORK_RESULT", message: "浏览器提交的扫描分片格式无效。" } }, { status: 400 });
      }
      work = await submitBrowserScreeningWork({
        jobId,
        batchId: body.batchId,
        leaseToken: body.leaseToken,
        results: body.results,
        failures: body.failures,
        shortHistorySymbols: body.shortHistorySymbols,
        paused: action === "pause",
        unprocessedSymbols: Array.isArray(body.unprocessedSymbols) ? body.unprocessedSymbols : [],
        dataDate: body.dataDate,
      });
    } else {
      work = await claimBrowserScreeningWork(jobId);
    }
    const job = await getScreeningJob(jobId);
    if (!job) {
      return Response.json({ error: { code: "JOB_EXPIRED", message: "扫描任务处理后无法读取，请重新运行。" } }, { status: 410 });
    }
    return Response.json({ data: job, work }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Browser-driven screening worker failed", error instanceof Error ? error.message : "unknown error");
    const message = error instanceof Error ? error.message : "本次扫描分片处理失败。";
    const conflict = /租约|重复提交|不完整/.test(message);
    return Response.json({
      error: {
        code: "SCREENING_WORKER_FAILED",
        message: `本次扫描分片处理失败：${message}`,
      },
    }, { status: conflict ? 409 : 503 });
  }
}
