import { isChinaTradingDay, shanghaiBusinessClock } from "@/lib/etf-rotation";
import { prepareScreeningJob } from "@/lib/screening-jobs";
import { currentStrategy } from "@/lib/strategies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 240;

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
  try {
    const result = await prepareScreeningJob(currentStrategy, null, {
      idempotencyKey: `cron:${currentStrategy.strategyId}:${businessDate}`,
      reuseCompleted: false,
    });
    return Response.json({ processed: result.created, businessDate, job: result.job }, { status: result.job?.status === "running" ? 202 : 200 });
  } catch (error) {
    console.error("Stock screening cron entry failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "SCREENING_CRON_FAILED" }, { status: 500 });
  }
}
