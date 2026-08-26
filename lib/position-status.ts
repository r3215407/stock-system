import "server-only";

import { applyExitClose, createExitState, describeNextObservation, evaluateOpenAndStop, type ExitEvent, type ExitState } from "@/lib/position-exit";
import { atrSeries, cleanBars, fetchLiveQuote, fetchMarketBars, shanghaiClock, smaSeries, type DailyBar, type LiveQuote } from "@/lib/market-data";

export type HoldingStatus = {
  available: boolean;
  reason: string | null;
  symbol: string;
  quoteDate: string;
  quoteTime: string | null;
  quoteProvider: string;
  priceSource: "live" | "complete-close";
  strategyDate: string;
  strategyClose: number;
  dayOpen: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  calculatedAt: string;
  currentPrice: number;
  averageCost: number;
  actualShares: number;
  initialStopPrice: number;
  oneRPrice: number;
  twoRPrice: number;
  profit: number;
  returnRate: number;
  rMultiple: number;
  stage: "未到1R" | "保本保护（已到1R）" | "趋势止盈（已到2R）";
  activeStop: number;
  trailingTakeProfitPrice: number | null;
  trailingStopUpdatedAt: string | null;
  protectedRisk: number;
  lockedProfit: number;
  holdingDays: number;
  hitOneR: boolean;
  hitTwoR: boolean;
  exitEvent: ExitEvent | null;
  pendingExitReason: string | null;
  nextObservation: string;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  atr14: number | null;
};

function latestCompleteBars(bars: DailyBar[]) {
  const result = [...bars];
  const clock = shanghaiClock();
  if (result.at(-1)?.date === clock.date && clock.minutes < 15 * 60 + 5) result.pop();
  return result;
}

export function replayHoldingPath(input: {
  symbol: string;
  bars: DailyBar[];
  purchaseDate: string;
  averageCost: number;
  actualShares: number;
  initialStopPrice: number;
}): HoldingStatus {
  const bars = latestCompleteBars(cleanBars(input.bars));
  const latest = bars.at(-1);
  if (!latest) throw new Error("没有可用的完整交易日日线");
  const risk = input.averageCost - input.initialStopPrice;
  const oneRPrice = input.averageCost + risk;
  const twoRPrice = input.averageCost + risk * 2;
  const profit = (latest.close - input.averageCost) * input.actualShares;
  const returnRate = latest.close / input.averageCost - 1;
  const rMultiple = (latest.close - input.averageCost) / risk;
  const entryIndex = bars.findIndex((bar) => bar.date >= input.purchaseDate);
  const ma10 = smaSeries(bars, 10);
  const ma20 = smaSeries(bars, 20);
  const ma60 = smaSeries(bars, 60);
  const atr14 = atrSeries(bars, 14);
  let state: ExitState = createExitState(input.averageCost, input.initialStopPrice);
  let exitEvent: ExitEvent | null = null;
  const historyAvailable = entryIndex >= 59 && bars[entryIndex]?.date === input.purchaseDate;
  if (historyAvailable) {
    for (let index = entryIndex; index < bars.length; index += 1) {
      const bar = bars[index];
      exitEvent = evaluateOpenAndStop(state, bar);
      if (exitEvent) break;
      state = applyExitClose(state, bar, { ma10: ma10[index], ma20: ma20[index], ma60: ma60[index], atr14: atr14[index] });
    }
  }
  const stage = state.hitTwoR ? "趋势止盈（已到2R）" : state.hitOneR ? "保本保护（已到1R）" : "未到1R";
  return {
    available: historyAvailable,
    reason: historyAvailable ? null : "买入日期之前缺少足够行情，已暂停动态退出结论",
    symbol: input.symbol,
    quoteDate: latest.date,
    quoteTime: null,
    quoteProvider: "完整交易日日线",
    priceSource: "complete-close",
    strategyDate: latest.date,
    strategyClose: latest.close,
    dayOpen: null,
    dayHigh: null,
    dayLow: null,
    calculatedAt: new Date().toISOString(),
    currentPrice: latest.close,
    averageCost: input.averageCost,
    actualShares: input.actualShares,
    initialStopPrice: input.initialStopPrice,
    oneRPrice,
    twoRPrice,
    profit,
    returnRate,
    rMultiple,
    stage,
    activeStop: state.activeStop,
    trailingTakeProfitPrice: state.hitTwoR ? state.activeStop : null,
    trailingStopUpdatedAt: state.trailingStopUpdatedAt,
    protectedRisk: Math.max(0, (latest.close - state.activeStop) * input.actualShares),
    lockedProfit: Math.max(0, (state.activeStop - input.averageCost) * input.actualShares),
    holdingDays: state.holdingDays,
    hitOneR: state.hitOneR,
    hitTwoR: state.hitTwoR,
    exitEvent: historyAvailable ? exitEvent : null,
    pendingExitReason: historyAvailable ? state.pendingExitReason : null,
    nextObservation: historyAvailable ? describeNextObservation(state, latest.close) : "补足买入日前行情后重新计算",
    ma10: ma10.at(-1) ?? null,
    ma20: ma20.at(-1) ?? null,
    ma60: ma60.at(-1) ?? null,
    atr14: atr14.at(-1) ?? null,
  };
}

function withLiveQuote(status: HoldingStatus, quote: LiveQuote): HoldingStatus {
  if (quote.date < status.strategyDate) return status;
  const risk = status.averageCost - status.initialStopPrice;
  const profit = (quote.price - status.averageCost) * status.actualShares;
  const currentDay = quote.date > status.strategyDate
    ? { date: quote.date, open: quote.open, high: quote.high, low: quote.low, close: quote.price }
    : null;
  const intradayExit = !status.exitEvent && currentDay
    ? evaluateOpenAndStop({
        activeStop: status.activeStop,
        initialStop: status.initialStopPrice,
        entryPrice: status.averageCost,
        hitOneR: status.hitOneR,
        hitTwoR: status.hitTwoR,
        belowMa20Days: 0,
        holdingDays: status.holdingDays,
        pendingExitReason: status.pendingExitReason as ExitState["pendingExitReason"],
        trailingStopUpdatedAt: status.trailingStopUpdatedAt,
      }, currentDay)
    : null;
  return {
    ...status,
    quoteDate: quote.date,
    quoteTime: quote.time,
    quoteProvider: quote.provider,
    priceSource: "live",
    currentPrice: quote.price,
    dayOpen: quote.open,
    dayHigh: quote.high,
    dayLow: quote.low,
    profit,
    returnRate: quote.price / status.averageCost - 1,
    rMultiple: (quote.price - status.averageCost) / risk,
    protectedRisk: Math.max(0, (quote.price - status.activeStop) * status.actualShares),
    exitEvent: intradayExit ?? status.exitEvent,
  };
}

export async function getHoldingStatus(input: { symbol: string; purchaseDate: string; averageCost: number; actualShares: number; initialStopPrice: number }) {
  const [market, quote] = await Promise.all([
    fetchMarketBars(input.symbol, 1500),
    fetchLiveQuote(input.symbol).catch(() => null),
  ]);
  const status = replayHoldingPath({ ...input, bars: market.bars });
  return quote ? withLiveQuote(status, quote) : status;
}
