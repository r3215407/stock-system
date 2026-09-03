import { isChinaTradingDay, shanghaiBusinessClock } from "@/lib/etf-rotation";
import { processNextScreeningWork } from "@/lib/screening-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 240;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const clock = shanghaiBusinessClock();
  const businessDate = clock.date;
  if (!isChinaTradingDay(businessDate)) {
    return Response.json({ processed: false, reason: "NON_TRADING_DAY", businessDate });
  }
  if (clock.time < "15:30:00") {
    return Response.json({ processed: false, reason: "BEFORE_SCREENING_WINDOW", businessDate });
  }
  const jobId = new URL(request.url).searchParams.get("jobId") ?? undefined;
  if (jobId && !UUID_PATTERN.test(jobId)) {
    return Response.json({ error: "INVALID_JOB_ID" }, { status: 400 });
  }
  try {
    return Response.json(await processNextScreeningWork(jobId));
  } catch (error) {
    console.error("Stock screening worker failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "SCREENING_WORKER_FAILED" }, { status: 500 });
  }
}
