import type { DailyBar } from "@/lib/market-data";

export const MACD_ETF_SYMBOL = "513530.SH";
export const MACD_ETF_CODE = "513530";
export const MACD_ETF_NAME = "港股通红利 ETF 华泰柏瑞";
export const MACD_INITIAL_CAPITAL = 400_000;

export type MacdSignal = "WARMING_UP" | "BULLISH" | "BEARISH" | "GOLDEN_CROSS" | "DEATH_CROSS";
export type MacdAction = "BUY" | "SELL" | "HOLD";

export type MacdPositionDay = {
  date: string;
  close: number;
  changeRate: number;
  dif: number;
  dea: number;
  spread: number;
  sma60: number;
  sma200: number;
  signal: MacdSignal;
  bullishDays: number;
  bearishDays: number;
  basePosition: number;
  timingPosition: number;
  targetPosition: number;
  previousTargetPosition: number;
  action: MacdAction;
  actionReasons: string[];
};

function ema(values: number[], period: number) {
  const multiplier = 2 / (period + 1);
  const output: number[] = [];
  values.forEach((value, index) => {
    output[index] = index === 0 ? value : value * multiplier + output[index - 1] * (1 - multiplier);
  });
  return output;
}

function sma(values: number[], period: number) {
  const output: Array<number | null> = Array(values.length).fill(null);
  let sum = 0;
  values.forEach((value, index) => {
    sum += value;
    if (index >= period) sum -= values[index - period];
    if (index >= period - 1) output[index] = sum / period;
  });
  return output;
}

export function calculateMacdPositionSeries(bars: DailyBar[]): MacdPositionDay[] {
  if (bars.length < 200) return [];
  const closes = bars.map((bar) => bar.close);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const dif = closes.map((_, index) => ema12[index] - ema26[index]);
  const dea = ema(dif, 9);
  const sma60 = sma(closes, 60);
  const sma200 = sma(closes, 200);

  let basePosition = 0.4;
  let timingPosition = 0;
  let bullishDays = 0;
  let bearishDays = 0;
  let belowSma200BearishDays = 0;
  const output: MacdPositionDay[] = [];

  for (let index = 199; index < bars.length; index += 1) {
    const previousSpread = dif[index - 1] - dea[index - 1];
    const spread = dif[index] - dea[index];
    const bullish = spread > 0;
    const bearish = spread < 0;
    const goldenCross = previousSpread <= 0 && bullish;
    const deathCross = previousSpread >= 0 && bearish;
    bullishDays = bullish ? bullishDays + 1 : 0;
    bearishDays = bearish ? bearishDays + 1 : 0;
    belowSma200BearishDays = bearish && closes[index] < (sma200[index] as number)
      ? belowSma200BearishDays + 1
      : 0;

    const previousTargetPosition = Math.min(1, basePosition + timingPosition);
    const actionReasons: string[] = [];

    if (goldenCross) {
      const before = timingPosition;
      timingPosition = Math.min(0.6, timingPosition + 0.2);
      if (timingPosition > before) actionReasons.push("正式 MACD 金叉，择时仓增加 20%");
    }
    if (bullishDays === 3) {
      const before = timingPosition;
      timingPosition = Math.min(0.6, timingPosition + 0.2);
      if (timingPosition > before) actionReasons.push("MACD 连续 3 个交易日保持多头，择时仓增加 20%");
      if (closes[index] > (sma60[index] as number)) {
        const beforeSma = timingPosition;
        timingPosition = Math.min(0.6, timingPosition + 0.2);
        if (timingPosition > beforeSma) actionReasons.push("连续多头且收盘高于 SMA60，择时仓再增加 20%");
      }
    }
    if (deathCross && timingPosition > 0) {
      const reduction = timingPosition / 2;
      timingPosition -= reduction;
      actionReasons.push(`正式 MACD 死叉，卖出当前择时仓的 50%（${Math.round(reduction * 100)}% 总仓位）`);
    }
    if (bearishDays === 3 && timingPosition > 0) {
      timingPosition = 0;
      actionReasons.push("MACD 连续 3 个交易日保持空头，清空剩余择时仓");
    }
    if (belowSma200BearishDays === 2 && basePosition > 0.2) {
      basePosition = 0.2;
      actionReasons.push("MACD 空头且连续 2 日低于 SMA200，底仓降至 20%");
    }
    if (basePosition === 0.2 && bullish && closes[index] > (sma200[index] as number)) {
      basePosition = 0.4;
      actionReasons.push("收盘重回 SMA200 上方且 MACD 多头，底仓恢复至 40%");
    }

    const targetPosition = Math.min(1, Math.max(0, basePosition + timingPosition));
    const delta = targetPosition - previousTargetPosition;
    output.push({
      date: bars[index].date,
      close: bars[index].close,
      changeRate: index > 0 ? bars[index].close / bars[index - 1].close - 1 : 0,
      dif: dif[index],
      dea: dea[index],
      spread,
      sma60: sma60[index] as number,
      sma200: sma200[index] as number,
      signal: goldenCross ? "GOLDEN_CROSS" : deathCross ? "DEATH_CROSS" : bullish ? "BULLISH" : "BEARISH",
      bullishDays,
      bearishDays,
      basePosition,
      timingPosition,
      targetPosition,
      previousTargetPosition,
      action: delta > 1e-10 ? "BUY" : delta < -1e-10 ? "SELL" : "HOLD",
      actionReasons,
    });
  }
  return output;
}

export function nextTradingDate(date: string) {
  const knownClosures = new Set([
    "2026-01-01", "2026-01-02", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19",
    "2026-02-20", "2026-02-23", "2026-04-06", "2026-05-01", "2026-05-04", "2026-05-05",
    "2026-06-19", "2026-09-25", "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07",
  ]);
  const candidate = new Date(`${date}T12:00:00+08:00`);
  do {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
    const formatted = candidate.toISOString().slice(0, 10);
    const weekday = candidate.getUTCDay();
    if (weekday >= 1 && weekday <= 5 && !knownClosures.has(formatted)) return formatted;
  } while (true);
}
