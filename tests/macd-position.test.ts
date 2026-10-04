import assert from "node:assert/strict";
import test from "node:test";

import { calculateMacdPositionSeries, nextTradingDate } from "../lib/macd-position.ts";
import type { DailyBar } from "../lib/market-data.ts";

function barsFromCloses(closes: number[]): DailyBar[] {
  return closes.map((close, index) => ({
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    amount: close,
  }));
}

test("MACD 序列少于 200 日时不生成可交易信号", () => {
  assert.deepEqual(calculateMacdPositionSeries(barsFromCloses(Array(199).fill(1))), []);
});

test("持续上涨序列的目标仓位始终限制在 100%", () => {
  const closes = Array.from({ length: 260 }, (_, index) => index < 205 ? 100 : 100 + (index - 204) * 0.8);
  const series = calculateMacdPositionSeries(barsFromCloses(closes));
  assert.ok(series.length > 0);
  assert.ok(series.every((day) => day.targetPosition >= 0 && day.targetPosition <= 1));
  assert.ok(series.some((day) => day.action === "BUY"));
});

test("下一交易日跳过周末和 2026 国庆休市日", () => {
  assert.equal(nextTradingDate("2026-09-30"), "2026-10-08");
  assert.equal(nextTradingDate("2026-10-09"), "2026-10-12");
});
