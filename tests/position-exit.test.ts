import assert from "node:assert/strict";
import test from "node:test";

import { applyExitClose, createExitState, evaluateOpenAndStop } from "../lib/position-exit.ts";

const averages = { ma10: 10, ma20: 9, ma60: 8, atr14: 1 };

test("达到1R后保护止损上移到成本且不会下调", () => {
  const first = applyExitClose(createExitState(10, 9), { date: "2026-01-01", open: 10, high: 11.2, low: 9.8, close: 11 }, averages);
  const second = applyExitClose(first, { date: "2026-01-02", open: 11, high: 11, low: 10.2, close: 10.3 }, averages);
  assert.equal(first.hitOneR, true);
  assert.equal(first.activeStop, 10);
  assert.equal(second.activeStop, 10);
});

test("达到2R后生成移动止盈价且只能上移", () => {
  let state = applyExitClose(createExitState(10, 9), { date: "2026-01-01", open: 10, high: 12.2, low: 10, close: 12 }, { ma10: 11.5, ma20: 9, ma60: 8, atr14: 1 });
  assert.equal(state.hitTwoR, true);
  assert.equal(state.activeStop, 11.2);
  state = applyExitClose(state, { date: "2026-01-02", open: 12, high: 12, low: 11.4, close: 11.5 }, { ma10: 11.3, ma20: 9, ma60: 8, atr14: 1 });
  assert.equal(state.activeStop, 11.2);
  state = applyExitClose(state, { date: "2026-01-03", open: 11.6, high: 12.4, low: 11.5, close: 12.3 }, { ma10: 12, ma20: 9, ma60: 8, atr14: 1 });
  assert.equal(state.activeStop, 11.7);
  const exit = evaluateOpenAndStop(state, { date: "2026-01-04", open: 11.8, high: 11.9, low: 11.6, close: 11.7 });
  assert.deepEqual(exit, { date: "2026-01-04", price: 11.7, reason: "移动止盈", timing: "intraday" });
});

test("移动止盈价不会高于生成信号当日收盘", () => {
  const state = applyExitClose(createExitState(10, 9), { date: "2026-01-01", open: 12, high: 12.5, low: 11.8, close: 12 }, { ma10: 12.5, ma20: 9, ma60: 8, atr14: 0.2 });
  assert.equal(state.activeStop, 11.99);
});

test("跳空止损优先使用开盘价", () => {
  const exit = evaluateOpenAndStop(createExitState(10, 9), { date: "2026-01-01", open: 8.8, high: 9, low: 8.5, close: 8.9 });
  assert.equal(exit?.reason, "跳空止损");
  assert.equal(exit?.price, 8.8);
});

test("多个收盘条件同时成立时使用既定优先级", () => {
  const state = applyExitClose(createExitState(10, 9), { date: "2026-01-01", open: 10, high: 10, low: 7, close: 7.5 }, { ma10: 10, ma20: 8, ma60: 8 });
  assert.equal(state.pendingExitReason, "MA20跌破MA60");
});
