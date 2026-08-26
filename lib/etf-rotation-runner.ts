import "server-only";

import {
  completeSkippedRun,
  createRotationRun,
  executeRotationLedger,
  failRotationRun,
  getRotationOverview,
  updateRunEmailStatus,
} from "@/lib/etf-rotation-db";
import { sendRotationNotification } from "@/lib/etf-rotation-email";
import { fetchRotationMarketData } from "@/lib/etf-market-data";
import {
  isChinaTradingDay,
  RotationDataError,
  shanghaiBusinessClock,
} from "@/lib/etf-rotation";

async function persistEmailResult(runId: string, operation: () => ReturnType<typeof sendRotationNotification>) {
  try {
    const result = await operation();
    await updateRunEmailStatus(runId, result.status);
    return result.status;
  } catch (error) {
    console.error("ETF rotation email failed", error instanceof Error ? error.message : "unknown error");
    await updateRunEmailStatus(runId, "FAILED");
    return "FAILED" as const;
  }
}

export async function runEtfRotation(now = new Date()) {
  const clock = shanghaiBusinessClock(now);
  const businessDate = clock.date;
  if (clock.weekday === "Sat" || clock.weekday === "Sun") {
    return { processed: false as const, reason: "WEEKEND_NO_RUN" as const, status: "SKIPPED_WEEKEND" as const };
  }
  const run = await createRotationRun(businessDate);
  if (!run.created) {
    return { processed: false as const, reason: "ALREADY_PROCESSED", runId: run.runId, status: run.status };
  }

  if (!isChinaTradingDay(businessDate)) {
    await completeSkippedRun(run.runId);
    let latestSuccessAt: string | null = null;
    try {
      latestSuccessAt = (await getRotationOverview()).latestSuccess?.finishedAt ?? null;
    } catch {
      // 跳过通知仍可发送，数据库读取摘要失败不影响休市状态。
    }
    const emailStatus = await persistEmailResult(run.runId, () => sendRotationNotification({
      kind: "skipped", businessDate, runId: run.runId, latestSuccessAt,
    }));
    return { processed: true as const, runId: run.runId, status: "SKIPPED_NON_TRADING_DAY" as const, emailStatus };
  }

  try {
    const market = await fetchRotationMarketData(businessDate, { strictTradingSnapshot: true });
    const ledger = await executeRotationLedger(run.runId, businessDate, market.marketDataAt, market.rankings);
    const emailStatus = await persistEmailResult(run.runId, () => sendRotationNotification({
      kind: "success", businessDate, runId: run.runId, ledger, rankings: market.rankings, marketDataAt: market.marketDataAt,
    }));
    return { processed: true as const, runId: run.runId, status: "SUCCESS" as const, ledger, emailStatus };
  } catch (error) {
    const errorCode = error instanceof RotationDataError ? error.code : "STRATEGY_EXECUTION_FAILED";
    const errorMessage = error instanceof Error ? error.message : "未知策略执行错误";
    await failRotationRun(run.runId, errorCode, error);
    const emailStatus = await persistEmailResult(run.runId, () => sendRotationNotification({
      kind: "failed", businessDate, runId: run.runId, errorCode, errorMessage,
    }));
    return { processed: true as const, runId: run.runId, status: "FAILED" as const, errorCode, emailStatus };
  }
}
