"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "@/app/etf-rotation/etf-rotation.module.css";

type RunState = "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED_NON_TRADING_DAY" | "NOT_RUN_TODAY";

type Overview = {
  asOf: string;
  timezone: "Asia/Shanghai";
  today: string;
  runState: RunState;
  latestRun: null | {
    id: string;
    businessDate: string;
    status: Exclude<RunState, "NOT_RUN_TODAY">;
    action: "BUY" | "SELL_BUY" | "HOLD" | null;
    targetSymbol: string | null;
    startedAt: string;
    finishedAt: string | null;
    marketDataAt: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    emailStatus: string;
  };
  latestSuccess: null | { finishedAt: string; marketDataAt: string; targetSymbol: string };
  portfolio: {
    startDate: string;
    startValue: string;
    totalValue: string;
    cash: string;
    positionValue: string;
    positionRate: number | null;
    cashRate: number | null;
    cumulativeReturn: string;
    annualizedReturn: string;
    sharpeRatio: number | null;
  };
  position: null | {
    symbol: string;
    quantity: string;
    entryPrice: string;
    entryAmount: string;
    entryAt: string;
    lastPrice: string;
    lastValuedAt: string;
    marketValue: string;
    unrealizedPnl: string;
    unrealizedReturn: number | null;
    positionRate: number | null;
  };
  snapshots: Array<{
    snapshotDate: string;
    totalValue: string;
    cash: string;
    positionValue: string;
    cumulativeReturn: string;
    annualizedReturn: string;
  }>;
  trades: Array<{
    id: string;
    runId: string;
    side: "BUY" | "SELL";
    symbol: string;
    executedAt: string;
    price: string;
    quantity: string;
    amount: string;
    realizedPnl: string | null;
    cashAfter: string;
  }>;
  pool: Array<{
    symbol: string;
    name: string | null;
    currentPrice: string | null;
    score: number | null;
    rank: number | null;
    marketDataAt: string | null;
  }>;
  poolError: string | null;
  poolLoading?: boolean;
};

function money(value: string | number, digits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(parsed);
}

function number(value: string | number | null, digits = 2) {
  const parsed = Number(value);
  return value === null || !Number.isFinite(parsed) ? "—" : new Intl.NumberFormat("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(parsed);
}

function percent(value: string | number | null, digits = 2) {
  const parsed = Number(value);
  if (value === null || !Number.isFinite(parsed)) return "—";
  return `${parsed >= 0 ? "+" : ""}${(parsed * 100).toFixed(digits)}%`;
}

function beijingTime(value: string | null, minuteOnly = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    ...(minuteOnly ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}),
  }).format(date)}${minuteOnly ? " 北京时间" : ""}`;
}

function nextRun(asOf: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(asOf));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const target = new Date(`${date}T14:45:00+08:00`);
  if (minutes >= 14 * 60 + 45) target.setUTCDate(target.getUTCDate() + 1);
  return `${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }).format(target)} 14:45 北京时间`;
}

function StatusMark({ state }: { state: RunState }) {
  const kind = state === "SUCCESS" ? "success" : state === "FAILED" ? "failed" : state === "SKIPPED_NON_TRADING_DAY" ? "skipped" : "pending";
  return <svg aria-hidden="true" className={styles.statusIcon} data-kind={kind} viewBox="0 0 24 24">
    {kind === "success" ? <path d="m5 12 4 4L19 6" /> : kind === "failed" ? <path d="m7 7 10 10M17 7 7 17" /> : kind === "skipped" ? <path d="M7 12h10" /> : <><circle cx="12" cy="12" r="7" /><path d="M12 8v5l3 2" /></>}
  </svg>;
}

function runCopy(state: RunState) {
  if (state === "SUCCESS") return { label: "今日运行成功", detail: "账本已按 14:45 行情更新" };
  if (state === "FAILED") return { label: "今日运行失败", detail: "持仓未改变，继续展示最近成功账本" };
  if (state === "SKIPPED_NON_TRADING_DAY") return { label: "今日休市，策略未运行", detail: "组合与资产快照均未发生变化" };
  if (state === "RUNNING") return { label: "任务正在运行", detail: "行情校验完成前不会改变持仓" };
  return { label: "今日尚未运行", detail: "每天 14:45 自动触发，也可手动运行一次" };
}

function Curve({ snapshots }: { snapshots: Overview["snapshots"] }) {
  const [metric, setMetric] = useState<"return" | "asset">("return");
  const [active, setActive] = useState(Math.max(0, snapshots.length - 1));
  const curve = useMemo(() => {
    const values = snapshots.map((item) => metric === "return" ? Number(item.cumulativeReturn) * 100 : Number(item.totalValue));
    const baseline = metric === "return" ? 0 : Number(snapshots[0]?.totalValue ?? 100000);
    const min = Math.min(...values, baseline);
    const max = Math.max(...values, baseline);
    const range = Math.max(max - min, metric === "return" ? 1 : 1000);
    const points = values.map((value, index) => ({
      x: snapshots.length === 1 ? 55 : 18 + index / (snapshots.length - 1) * 78,
      y: 86 - (value - min) / range * 70,
      value,
    }));
    return { points, min, max };
  }, [metric, snapshots]);
  const { points } = curve;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const selected = snapshots[active] ?? snapshots[0];
  const previous = active > 0 ? snapshots[active - 1] : null;
  const dailyReturn = previous ? Number(selected.totalValue) / Number(previous.totalValue) - 1 : null;

  return <div className={styles.chartTicket}>
    <div className={styles.chartControls} role="group" aria-label="曲线指标">
      <button aria-pressed={metric === "return"} onClick={() => setMetric("return")} type="button">累计收益率</button>
      <button aria-pressed={metric === "asset"} onClick={() => setMetric("asset")} type="button">总资产</button>
    </div>
    {selected ? <div className={styles.chartReadout} aria-live="polite">
      <strong>{selected.snapshotDate}</strong>
      <span>总资产 {money(selected.totalValue)}</span>
      <span>当日收益 {dailyReturn === null ? "首个快照" : percent(dailyReturn)}</span>
      <span>累计 {percent(selected.cumulativeReturn)}</span>
      <span>年化 {percent(selected.annualizedReturn)}</span>
    </div> : null}
    <div className={styles.chartCanvas}>
      <div className={styles.chartScale} aria-hidden="true">
        <span>{metric === "return" ? `${curve.max >= 0 ? "+" : ""}${curve.max.toFixed(2)}%` : money(curve.max, 0)}</span>
        <span>{metric === "return" ? `${((curve.max + curve.min) / 2).toFixed(2)}%` : money((curve.max + curve.min) / 2, 0)}</span>
        <span>{metric === "return" ? `${curve.min >= 0 ? "+" : ""}${curve.min.toFixed(2)}%` : money(curve.min, 0)}</span>
      </div>
      <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 100">
        <path className={styles.zeroLine} d="M 4 86 L 96 86" />
        {points.length > 1 ? <path className={styles.curveArea} d={`${path} L ${points.at(-1)!.x} 92 L ${points[0].x} 92 Z`} /> : null}
        {points.length > 1 ? <path className={styles.curveLine} d={path} /> : null}
      </svg>
      {points.map((point, index) => <button
        aria-label={`${snapshots[index].snapshotDate}，${metric === "return" ? `累计收益 ${percent(snapshots[index].cumulativeReturn)}` : `总资产 ${money(snapshots[index].totalValue)}`}`}
        className={styles.chartPoint}
        data-active={index === active}
        key={snapshots[index].snapshotDate}
        onFocus={() => setActive(index)}
        onMouseEnter={() => setActive(index)}
        onClick={() => setActive(index)}
        style={{ left: `${point.x}%`, top: `${point.y}%` }}
        type="button"
      />)}
    </div>
    <div className={styles.chartAxis}><span>{snapshots[0]?.snapshotDate ?? "—"}</span><span>{snapshots.at(-1)?.snapshotDate ?? "—"}</span></div>
    {snapshots.length === 1 ? <p className={styles.singlePoint}>当前只有初始快照，等待下一次有效运行后形成曲线。</p> : null}
  </div>;
}

export default function EtfRotationWorkspace() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualRunning, setManualRunning] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  async function runManually() {
    setManualRunning(true);
    setManualError(null);
    try {
      const response = await fetch("/api/strategies/etf-rotation/run", { method: "POST", headers: { "Content-Type": "application/json" } });
      const payload = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? "手动运行失败，请稍后重试。");
      window.location.reload();
    } catch (reason) {
      setManualError(reason instanceof Error ? reason.message : "手动运行失败，请稍后重试。");
      setManualRunning(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/strategies/etf-rotation/overview", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as Overview | { message?: string };
        if (!response.ok) throw new Error("message" in payload ? payload.message : "ETF 轮动账本暂时不可用。");
        setData(payload as Overview);
        try {
          const poolResponse = await fetch("/api/strategies/etf-rotation/pool", { cache: "no-store", signal: controller.signal });
          if (!poolResponse.ok) throw new Error("MARKET_DATA_UNAVAILABLE");
          const poolPayload = await poolResponse.json() as { pool: Overview["pool"] };
          setData((current) => current ? { ...current, pool: poolPayload.pool, poolError: null, poolLoading: false } : current);
        } catch (poolReason) {
          if ((poolReason as { name?: string }).name !== "AbortError") {
            setData((current) => current ? { ...current, poolLoading: false, poolError: "ETF 池即时行情暂不可用，账本与历史数据不受影响。" } : current);
          }
        }
      })
      .catch((reason: unknown) => {
        if ((reason as { name?: string }).name !== "AbortError") setError(reason instanceof Error ? reason.message : "ETF 轮动账本暂时不可用。");
      });
    return () => controller.abort();
  }, []);

  if (error) return <main className={styles.shell}><section className={styles.errorTicket} role="alert"><StatusMark state="FAILED" /><h1>账本暂时不可用</h1><p>{error}</p><button onClick={() => window.location.reload()} type="button">重新读取</button></section></main>;
  if (!data) return <main className={styles.shell}><section aria-busy="true" className={styles.loadingTicket}><span className={styles.loadingMark} /><h1>正在核对 ETF 轮动账本</h1><p>读取组合、持仓、快照与最近运行状态。</p></section></main>;

  const status = runCopy(data.runState);
  const nameFor = (symbol: string) => data.pool.find((item) => item.symbol === symbol)?.name ?? null;
  const changeAmount = Number(data.portfolio.totalValue) - Number(data.portfolio.startValue);

  return <main className={styles.shell}>
    <section className={styles.hero}>
      <div>
        <h1>ETF 动量轮动</h1>
        <p>每天 14:45 自动计算，模拟持有固定 ETF 池中动量排名第 1 的标的。</p>
      </div>
      <div className={styles.version}>ETF 动量 1.0<span>只读模拟组合</span></div>
    </section>

    <section className={styles.statusStrip} data-state={data.runState}>
      <div className={styles.statusLead}><StatusMark state={data.runState} /><div><strong>{status.label}</strong><span>{status.detail}</span></div>{data.runState === "NOT_RUN_TODAY" ? <button aria-busy={manualRunning} className={styles.manualRunButton} disabled={manualRunning} onClick={runManually} type="button">{manualRunning ? "正在运行…" : "立即运行"}</button> : null}</div>
      <dl className={styles.statusFacts}>
        <div><dt>最近成功估值</dt><dd>{beijingTime(data.latestSuccess?.finishedAt ?? null)}</dd></div>
        <div><dt>行情数据时间</dt><dd>{beijingTime(data.latestSuccess?.marketDataAt ?? null)}</dd></div>
        <div><dt>目标 / 动作</dt><dd>{data.latestRun?.targetSymbol ?? data.latestSuccess?.targetSymbol ?? "—"} · {data.latestRun?.action?.replace("SELL_BUY", "卖出→买入") ?? "等待"}</dd></div>
        <div><dt>下一次计划运行</dt><dd>{nextRun(data.asOf)}</dd></div>
      </dl>
      {data.runState === "FAILED" ? <div className={styles.failureReason}><strong>{data.latestRun?.errorCode ?? "RUN_FAILED"}</strong><span>{data.latestRun?.errorMessage ?? "本次运行没有完成，持仓未改变。"}</span></div> : null}
      {manualError ? <div className={styles.failureReason} role="alert"><strong>MANUAL_RUN_FAILED</strong><span>{manualError}</span></div> : null}
    </section>

    <section aria-label="关键资产指标" className={styles.metrics}>
      <div className={styles.metricPrimary}><span>总资产</span><strong>{money(data.portfolio.totalValue)}</strong><small>{changeAmount >= 0 ? "增加" : "减少"} {money(Math.abs(changeAmount))} / 初始 {money(data.portfolio.startValue, 0)}</small></div>
      <div><span>累计收益</span><strong data-tone={Number(data.portfolio.cumulativeReturn) >= 0 ? "positive" : "negative"}>{percent(data.portfolio.cumulativeReturn)}</strong><small>始于 {data.portfolio.startDate}</small></div>
      <div><span>年化收益</span><strong data-tone={Number(data.portfolio.annualizedReturn) >= 0 ? "positive" : "negative"}>{percent(data.portfolio.annualizedReturn)}</strong><small>365 个自然日口径</small></div>
      <div><span>可用资金</span><strong>{money(data.portfolio.cash)}</strong><small>占总资产 {percent(data.portfolio.cashRate)}</small></div>
      <div><span>仓位占比</span><strong>{percent(data.portfolio.positionRate)}</strong><small>持仓市值 {money(data.portfolio.positionValue)}</small></div>
      <div><span>夏普比率</span><strong>{number(data.portfolio.sharpeRatio)}</strong><small>{data.portfolio.sharpeRatio === null ? "数据不足" : "日收益 / 250 日年化"}</small></div>
    </section>

    <section className={styles.positionSection}>
      <header><div><h2>当前持仓</h2><p>最近一次成功运行的记账结果，不随页面访问时行情改写。</p></div><span>{data.position ? "持仓中" : "当前空仓"}</span></header>
      {data.position ? <div className={styles.positionTicket}>
        <div className={styles.positionIdentity}><span>{data.position.symbol}</span><h3>{nameFor(data.position.symbol) ?? data.position.symbol}</h3><p>等效份额 {number(data.position.quantity, 4)}</p></div>
        <dl className={styles.positionDetails}>
          <div><dt>买入时间</dt><dd>{beijingTime(data.position.entryAt)}</dd></div><div><dt>买入价</dt><dd>{money(data.position.entryPrice, 4)}</dd></div>
          <div><dt>初始投入</dt><dd>{money(data.position.entryAmount)}</dd></div><div><dt>最近估值价</dt><dd>{money(data.position.lastPrice, 4)}</dd></div>
          <div><dt>估值时间</dt><dd>{beijingTime(data.position.lastValuedAt)}</dd></div><div><dt>仓位占比</dt><dd>{percent(data.position.positionRate)}</dd></div>
        </dl>
        <div className={styles.positionValue}><span>当前市值</span><strong>{money(data.position.marketValue)}</strong><p data-tone={Number(data.position.unrealizedPnl) >= 0 ? "positive" : "negative"}>{Number(data.position.unrealizedPnl) >= 0 ? "浮盈" : "浮亏"} {money(Math.abs(Number(data.position.unrealizedPnl)))} · {percent(data.position.unrealizedReturn)}</p></div>
      </div> : <div className={styles.emptyPosition}><h3>当前暂无持仓</h3><p>系统将在下一个有效交易日 14:45，按策略买入动量排名第 1 的 ETF。</p></div>}
    </section>

    <section className={styles.section}>
      <header className={styles.sectionHeader}><div><h2>组合表现</h2><p>从 {data.portfolio.startDate} 起，只使用有效资产快照。</p></div><span>基准线 0%</span></header>
      <Curve snapshots={data.snapshots} />
    </section>

    <section className={styles.section}>
      <header className={styles.sectionHeader}><div><h2>近 10 笔历史交易</h2><p>HOLD 不进入交易记录；相同任务号表示同一次轮动。</p></div><span>{data.trades.length} 笔</span></header>
      {data.trades.length ? <div className={styles.recordTable}><table><thead><tr><th>时间</th><th>动作</th><th>ETF</th><th>成交价</th><th>等效份额</th><th>成交金额</th><th>实现盈亏</th><th>成交后资金</th></tr></thead><tbody>{data.trades.map((trade) => <tr key={trade.id}>
        <td data-label="时间">{beijingTime(trade.executedAt)}<small className={styles.runMark}>任务 {trade.runId.slice(0, 8)} · 同号为同次轮动</small></td><td data-label="动作"><span className={styles.side} data-side={trade.side}>{trade.side === "BUY" ? "+ 买入" : "− 卖出"}</span></td>
        <td data-label="ETF"><strong>{nameFor(trade.symbol) ?? trade.symbol}</strong><small>{trade.symbol}</small></td><td data-label="成交价">{money(trade.price, 4)}</td>
        <td data-label="等效份额">{number(trade.quantity, 4)}</td><td data-label="成交金额">{money(trade.amount)}</td>
        <td data-label="实现盈亏">{trade.realizedPnl === null ? "—" : <span data-tone={Number(trade.realizedPnl) >= 0 ? "positive" : "negative"}>{money(trade.realizedPnl)}</span>}</td><td data-label="成交后资金">{money(trade.cashAfter)}</td>
      </tr>)}</tbody></table></div> : <div className={styles.emptyRecord}>尚无交易记录。初始化不是交易，第一次有效策略买入后会在这里留下记录。</div>}
    </section>

    <section className={styles.section}>
      <header className={styles.sectionHeader}><div><h2>ETF 池</h2><p>固定 9 只；名称与即时行情均来自行情源，不使用硬编码名称。</p></div><span>{data.poolLoading ? "行情计算中" : data.poolError ? "即时行情不可用" : `行情 ${beijingTime(data.pool[0]?.marketDataAt ?? null)}`}</span></header>
      {data.poolLoading ? <p className={styles.poolLoading} role="status">账本已就绪，正在独立获取 9 只 ETF 的同批次行情与动量排名。</p> : null}
      {data.poolError ? <p className={styles.poolWarning} role="status">{data.poolError}</p> : null}
      <div className={styles.poolList} role="list">{data.pool.map((item) => {
        const held = data.position?.symbol === item.symbol;
        const target = data.latestRun?.targetSymbol === item.symbol;
        return <article className={styles.poolRow} data-held={held} key={item.symbol} role="listitem">
          <span className={styles.poolRank}>{item.rank ?? "—"}</span><div className={styles.poolName}><strong>{item.name ?? item.symbol}</strong><span>{item.symbol}</span></div>
          <div><span>最新价</span><strong>{item.currentPrice ? money(item.currentPrice, 4) : "—"}</strong></div><div><span>动量得分</span><strong>{item.score === null ? "—" : number(item.score, 6)}</strong></div>
          <div className={styles.poolState}>{held ? "■ 当前持仓" : target ? "◆ 本次目标" : "□ ETF 池成员"}</div>
        </article>;
      })}</div>
      <p className={styles.disclaimer}>固定规则模拟组合 · 不连接券商 · 不构成投资建议 · 金额与收益不包含手续费、滑点、税费和分红再投资。</p>
    </section>
  </main>;
}
