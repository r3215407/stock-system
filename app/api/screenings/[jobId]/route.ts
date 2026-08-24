import { cancelScreeningJob, getScreeningJob } from "@/lib/screening-jobs";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  try {
    const job = await getScreeningJob(jobId);
    if (!job) return Response.json({ error: { code: "JOB_EXPIRED", message: "扫描任务不存在或已过期，请重新运行。" } }, { status: 410 });
    return Response.json({ data: job }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: { code: "REDIS_UNAVAILABLE", message: error instanceof Error ? `任务状态读取失败：${error.message}` : "任务状态读取失败。" } }, { status: 503 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  try {
    const job = await cancelScreeningJob(jobId);
    if (!job) return Response.json({ error: { code: "JOB_EXPIRED", message: "扫描任务不存在或已过期。" } }, { status: 410 });
    return Response.json({ data: job }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: { code: "REDIS_UNAVAILABLE", message: error instanceof Error ? `取消任务失败：${error.message}` : "取消任务失败。" } }, { status: 503 });
  }
}
