import { floorStockPrice, stockStrategyV04 } from "./stock-strategy-v04.ts";

export type ExitReason =
  | "跳空止损"
  | "初始止损"
  | "保护止损"
  | "移动止盈"
  | "跳空移动止盈"
  | "MA20跌破MA60"
  | "收盘跌破MA60超过2%"
  | "连续2日收盘低于MA20"
  | "10日未达到1R"
  | "最长持有40日";

export type ExitState = {
  activeStop: number;
  initialStop: number;
  entryPrice: number;
  hitOneR: boolean;
  hitTwoR: boolean;
  belowMa20Days: number;
  holdingDays: number;
  pendingExitReason: ExitReason | null;
  trailingStopUpdatedAt: string | null;
};

export type ExitBar = { date: string; open: number; high: number; low: number; close: number };
export type ExitEvent = { date: string; price: number; reason: ExitReason; timing: "intraday" | "next-open" };

export function createExitState(entryPrice: number, initialStop: number): ExitState {
  return { activeStop: initialStop, initialStop, entryPrice, hitOneR: false, hitTwoR: false, belowMa20Days: 0, holdingDays: 0, pendingExitReason: null, trailingStopUpdatedAt: null };
}

export function evaluateOpenAndStop(state: ExitState, bar: ExitBar): ExitEvent | null {
  if (state.pendingExitReason) return { date: bar.date, price: bar.open, reason: state.pendingExitReason, timing: "next-open" };
  if (bar.open <= state.activeStop) return { date: bar.date, price: bar.open, reason: state.hitTwoR ? "跳空移动止盈" : "跳空止损", timing: "intraday" };
  if (bar.low <= state.activeStop) {
    return { date: bar.date, price: state.activeStop, reason: state.hitTwoR ? "移动止盈" : state.activeStop > state.initialStop ? "保护止损" : "初始止损", timing: "intraday" };
  }
  return null;
}

export function applyExitClose(state: ExitState, bar: ExitBar, averages: { ma10: number | null; ma20: number | null; ma60: number | null; atr14?: number | null }): ExitState {
  const next = { ...state, holdingDays: state.holdingDays + 1 };
  const risk = next.entryPrice - next.initialStop;
  if (bar.close >= next.entryPrice + risk * stockStrategyV04.exit.oneR) {
    next.hitOneR = true;
    next.activeStop = Math.max(next.activeStop, next.entryPrice);
  }
  if (bar.close >= next.entryPrice + risk * stockStrategyV04.exit.twoR) next.hitTwoR = true;
  if (next.hitTwoR) {
    const oneRPrice = next.entryPrice + risk;
    const priceStep = bar.close < 10 ? 0.001 : 0.01;
    const maximumStop = floorStockPrice(bar.close - priceStep);
    const indicatorStop = averages.ma10 !== null && averages.atr14 != null
      ? floorStockPrice(Math.min(maximumStop, averages.ma10 - stockStrategyV04.exit.trailingAtrMultiple * averages.atr14))
      : oneRPrice;
    const activeStop = Math.max(next.activeStop, oneRPrice, indicatorStop);
    if (activeStop > next.activeStop) next.trailingStopUpdatedAt = bar.date;
    next.activeStop = activeStop;
  }
  next.belowMa20Days = averages.ma20 !== null && bar.close < averages.ma20 ? next.belowMa20Days + 1 : 0;
  if (averages.ma20 !== null && averages.ma60 !== null && averages.ma20 <= averages.ma60) next.pendingExitReason = "MA20跌破MA60";
  else if (averages.ma60 !== null && bar.close < averages.ma60 * stockStrategyV04.exit.ma60CloseFactor) next.pendingExitReason = "收盘跌破MA60超过2%";
  else if (next.belowMa20Days >= stockStrategyV04.exit.consecutiveDays) next.pendingExitReason = "连续2日收盘低于MA20";
  else if (next.holdingDays >= stockStrategyV04.exit.staleTradeDays && !next.hitOneR && bar.close <= next.entryPrice) next.pendingExitReason = "10日未达到1R";
  else if (next.holdingDays >= stockStrategyV04.exit.maximumHoldingDays) next.pendingExitReason = "最长持有40日";
  return next;
}

export function describeNextObservation(state: ExitState, currentPrice: number) {
  const risk = state.entryPrice - state.initialStop;
  const twoRPrice = state.entryPrice + risk * 2;
  if (state.pendingExitReason) return `已生成${state.pendingExitReason}信号，下一交易日开盘退出`;
  if (!state.hitOneR) return `距 1R 还差 ¥${Math.max(0, state.entryPrice + risk - currentPrice).toFixed(2)}`;
  if (!state.hitTwoR) return `距 2R 还差 ¥${Math.max(0, twoRPrice - currentPrice).toFixed(2)}`;
  return `移动止盈价 ¥${state.activeStop.toFixed(2)}，仅上移不下调`;
}
