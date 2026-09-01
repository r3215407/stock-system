import { cancelScreeningJob, getScreeningJob, pauseScreeningJobForWorkerFailures, resumeScreeningJob } from "@/lib/screening-jobs";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  try {
    const job = await getScreeningJob(jobId);
    if (!job) return Response.json({ error: { code: "JOB_EXPIRED", message: "扫描任务不存在或已过期，请重新运行。" } }, { status: 410 });
    return Response.json({ data: job }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: { code: "DATABASE_UNAVAILABLE", message: error instanceof Error ? `任务状态读取失败：${error.message}` : "任务状态读取失败。" } }, { status: 503 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  try {
    const job = await cancelScreeningJob(jobId);
    if (!job) return Response.json({ error: { code: "JOB_EXPIRED", message: "扫描任务不存在或已过期。" } }, { status: 410 });
    return Response.json({ data: job }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: { code: "DATABASE_UNAVAILABLE", message: error instanceof Error ? `取消任务失败：${error.message}` : "取消任务失败。" } }, { status: 503 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  try {
    const body = await request.json().catch(() => ({})) as { action?: unknown };
    if (body.action !== "continue" && body.action !== "pause_after_failures") {
      return Response.json({ error: { code: "INVALID_ACTION", message: "不支持该扫描任务操作。" } }, { status: 400 });
    }
    const job = body.action === "continue"
      ? await resumeScreeningJob(jobId)
      : await pauseScreeningJobForWorkerFailures(jobId);
    if (!job) {
      const message = body.action === "continue" ? "任务不存在或当前不是暂停状态。" : "任务不存在或当前不是运行状态。";
      return Response.json({ error: { code: "JOB_STATE_CONFLICT", message } }, { status: 409 });
    }
    return Response.json({ data: job }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: { code: "DATABASE_UNAVAILABLE", message: error instanceof Error ? `更新任务状态失败：${error.message}` : "更新任务状态失败。" } }, { status: 503 });
  }
}
