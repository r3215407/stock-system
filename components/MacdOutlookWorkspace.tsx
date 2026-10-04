"use client";

import { useEffect, useState } from "react";

import styles from "@/app/macd-513530/macd-513530.module.css";

type Outlook = {
  symbol: string;
  name: string;
  strategyVersion: string;
  signalDate: string;
  executionDate: string;
  fetchedAt: string;
  provider: string;
  adjustment: string;
  latest: {
    close: number;
    changeRate: number;
    dif: number;
    dea: number;
    spread: number;
    sma60: number;
    sma200: number;
    signal: "BULLISH" | "BEARISH" | "GOLDEN_CROSS" | "DEATH_CROSS";
    bullishDays: number;
    bearishDays: number;
    basePosition: number;
    timingPosition: number;
    targetPosition: number;
    previousTargetPosition: number;
    action: "BUY" | "SELL" | "HOLD";
  };
  plan: {
    action: "BUY" | "SELL" | "HOLD";
    deltaPosition: number;
    amount: number;
    morningInstruction: string;
    executionWindow: string | null;
    premiumStatus: "UNAVAILABLE";
    reasons: string[];
  };
  assumptions: { initialCapital: number; modeledPosition: boolean; actualPositionTracked: boolean };
};

function percent(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function position(value: number) {
  return `${Math.round(value * 100)}%`;
}

function money(value: number) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(value);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Shanghai" }).format(new Date(`${value}T12:00:00+08:00`));
}

function signalLabel(signal: Outlook["latest"]["signal"]) {
  return ({ BULLISH: "MACD 多头", BEARISH: "MACD 空头", GOLDEN_CROSS: "正式金叉", DEATH_CROSS: "正式死叉" })[signal];
}

export default function MacdOutlookWorkspace() {
  const [data, setData] = useState<Outlook | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/strategies/macd-513530/outlook", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as Outlook | { message?: string };
        if (!response.ok) throw new Error("message" in payload ? payload.message : "策略状态读取失败。");
        setData(payload as Outlook);
      })
      .catch((reason: unknown) => {
        if ((reason as { name?: string }).name !== "AbortError") setError(reason instanceof Error ? reason.message : "策略状态读取失败。");
      });
    return () => controller.abort();
  }, []);

  if (error) return <main className={styles.shell}><section className={styles.stateTicket} role="alert"><span className={styles.stateMark}>!</span><h1>暂时不能给出结论</h1><p>{error}</p><button onClick={() => window.location.reload()} type="button">重新读取</button></section></main>;
  if (!data) return <main className={styles.shell}><section aria-busy="true" className={styles.stateTicket}><span className={styles.loadingMark} /><h1>正在核对最新收盘信号</h1><p>读取 513530 前复权日线并计算 MACD、SMA60 与 SMA200。</p></section></main>;

  const isBuy = data.plan.action === "BUY";
  const isSell = data.plan.action === "SELL";
  const verdict = isBuy ? "明日有买入计划" : isSell ? "明日不买，执行减仓" : "明日不买，继续持有";
  const sequenceDays = data.latest.spread > 0 ? data.latest.bullishDays : data.latest.bearishDays;

  return <main className={styles.shell}>
    <section className={styles.hero}>
      <div><span className={styles.eyebrow}>513530 · 次日执行单</span><h1>{data.name}</h1><p>用最新完整交易日的正式收盘信号，回答下一交易日是否需要增加仓位。</p></div>
      <div className={styles.version}>{data.strategyVersion}<span>初始资金 {money(data.assumptions.initialCapital)}</span></div>
    </section>

    <section className={styles.verdictCarrier} data-action={data.plan.action}>
      <article className={styles.verdict}>
        <div className={styles.verdictTopline}><span>{dateLabel(data.executionDate)}计划</span><strong>{isBuy ? "BUY PLAN" : isSell ? "RISK REDUCTION" : "NO NEW ORDER"}</strong></div>
        <h2>{verdict}</h2>
        <p className={styles.instruction}>{data.plan.morningInstruction}</p>
        <div className={styles.planGrid}>
          <div><span>仓位变化</span><strong>{data.plan.deltaPosition === 0 ? "0%" : `${data.plan.deltaPosition > 0 ? "+" : ""}${Math.round(data.plan.deltaPosition * 100)}%`}</strong></div>
          <div><span>计划金额</span><strong>{data.plan.amount > 0 ? money(data.plan.amount) : "无订单"}</strong></div>
          <div><span>执行窗口</span><strong>{data.plan.executionWindow ?? "无需执行"}</strong></div>
        </div>
      </article>
      <aside className={styles.checks} aria-label="执行前检查">
        <div className={styles.checkHeader}><span>执行条件</span><strong>{isBuy ? "尚未放行" : "无需买入检查"}</strong></div>
        <div className={styles.checkRow} data-state="known"><span>正式收盘信号</span><strong>{signalLabel(data.latest.signal)}</strong></div>
        <div className={styles.checkRow} data-state={isBuy ? "pending" : "known"}><span>当日涨幅</span><strong>{isBuy ? "14:40 检查" : "不适用"}</strong></div>
        <div className={styles.checkRow} data-state={isBuy ? "pending" : "known"}><span>场内溢价</span><strong>{isBuy ? "需人工确认" : "不适用"}</strong></div>
        {isBuy ? <p>涨幅超过 2% 或溢价超过 1% 时，当日不买并顺延。涨幅在 1%–2% 之间时，只执行计划金额的 50%。</p> : <p>当前没有新增买入单位。页面只展示策略模型仓位，不代表你的实际账户持仓。</p>}
      </aside>
    </section>

    <section className={styles.metrics} aria-label="最新指标">
      <div className={styles.metricLead}><span>策略目标仓位</span><strong>{position(data.latest.targetPosition)}</strong><small>底仓 {position(data.latest.basePosition)} + 择时仓 {position(data.latest.timingPosition)}</small></div>
      <div><span>收盘价</span><strong>¥{data.latest.close.toFixed(3)}</strong><small>当日 {percent(data.latest.changeRate)}</small></div>
      <div><span>DIF / DEA</span><strong>{data.latest.dif.toFixed(4)} / {data.latest.dea.toFixed(4)}</strong><small>差值 {data.latest.spread >= 0 ? "+" : ""}{data.latest.spread.toFixed(4)}</small></div>
      <div><span>SMA60</span><strong>¥{data.latest.sma60.toFixed(3)}</strong><small>{data.latest.close >= data.latest.sma60 ? "收盘位于均线上方" : "收盘位于均线下方"}</small></div>
      <div><span>SMA200</span><strong>¥{data.latest.sma200.toFixed(3)}</strong><small>{data.latest.close >= data.latest.sma200 ? "长期风险线之上" : "长期风险线之下"}</small></div>
    </section>

    <section className={styles.detailSection}>
      <header><div><h2>这次结论如何形成</h2><p>所有判断使用 {data.signalDate} 正式收盘，最早在下一交易日执行。</p></div><span>{signalLabel(data.latest.signal)} · 连续 {sequenceDays} 日</span></header>
      <div className={styles.reasonTicket}>
        <ol>{data.plan.reasons.map((reason, index) => <li key={reason}><span>{String(index + 1).padStart(2, "0")}</span><p>{reason}</p></li>)}</ol>
        <dl>
          <div><dt>信号日期</dt><dd>{data.signalDate}</dd></div>
          <div><dt>下一交易日</dt><dd>{data.executionDate}</dd></div>
          <div><dt>行情口径</dt><dd>{data.adjustment} · 日线</dd></div>
          <div><dt>数据来源</dt><dd>{data.provider}</dd></div>
          <div><dt>更新时间</dt><dd>{new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(data.fetchedAt))}</dd></div>
        </dl>
      </div>
    </section>

    <p className={styles.disclaimer}>本页按规则生成交易计划，不预测未来价格，不构成投资建议。当前目标仓位为策略模型推演值，尚未接入你的实际成交与 ETF IOPV。</p>
  </main>;
}
