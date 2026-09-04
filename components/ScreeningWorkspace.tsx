"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import styles from "@/app/operational.module.css";
import { fetchBrowserMarketBars } from "@/lib/browser-market-data";
import { ScreeningHistoryError, evaluateScreeningSecurity } from "@/lib/screening-evaluator";
import {
  accumulateScreeningFailures,
  accumulateScreeningWorkerFailures,
  describeScreeningFailure,
  type BrowserScreeningBatch,
  type BrowserScreeningWork,
  type ScreeningCandidate,
  type ScreeningFailure,
  type ScreeningJob,
} from "@/lib/screening";
import { currentStrategy, getStrategy } from "@/lib/strategies";
import type { PositionPlanRecord } from "@/lib/position-plan";

const BROWSER_MARKET_WORKERS = 3;

function money(value: number) { return value >= 100_000_000 ? `${(value / 100_000_000).toFixed(1)}亿` : `${(value / 10_000).toFixed(0)}万`; }
function recordTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

async function processBrowserBatch(
  batch: BrowserScreeningBatch,
  signal: AbortSignal,
  onProgress: (processed: number, total: number) => void,
  startingFailureCount: number,
) {
  const strategy = getStrategy(batch.strategyId, batch.strategyVersion);
  if (!strategy || strategy.status === "disabled") throw new Error("当前浏览器找不到该扫描策略，请刷新页面后重试。");
  const results: ScreeningCandidate[] = [];
  const failures: Array<{ symbol: string; errorCode: string; errorMessage: string }> = [];
  const shortHistorySymbols: string[] = [];
  let dataDate: string | null = null;
  let cursor = 0;
  let processed = 0;
  let pauseFailureCount = startingFailureCount;
  let paused = false;
  const covered = new Set<string>();
  const batchController = new AbortController();
  const abortFromParent = () => batchController.abort(signal.reason);
  signal.addEventListener("abort", abortFromParent, { once: true });
  const workers = Array.from({ length: Math.min(BROWSER_MARKET_WORKERS, batch.securities.length) }, async () => {
    while (!batchController.signal.aborted && cursor < batch.securities.length) {
      const security = batch.securities[cursor++];
      try {
        const bars = await fetchBrowserMarketBars(security.symbol, batchController.signal);
        const result = evaluateScreeningSecurity(
          security,
          bars,
          strategy,
          batch.requestedDate,
          batch.environmentScore,
        );
        results.push(result);
        covered.add(security.symbol);
        dataDate ??= result.signalDate;
      } catch (caught) {
        if (signal.aborted) throw caught;
        if (paused) continue;
        if (caught instanceof ScreeningHistoryError) {
          shortHistorySymbols.push(security.symbol);
          covered.add(security.symbol);
        } else {
          failures.push({ symbol: security.symbol, ...describeScreeningFailure(caught) });
          covered.add(security.symbol);
          const next = accumulateScreeningFailures(pauseFailureCount);
          pauseFailureCount = next.count;
          if (next.shouldPause) {
            paused = true;
            batchController.abort(new DOMException("行情失败暂停阈值已达到", "AbortError"));
          }
        }
      } finally {
        if (!signal.aborted && covered.has(security.symbol)) {
          processed += 1;
          onProgress(processed, batch.securities.length);
        }
      }
    }
  });
  try { await Promise.all(workers); }
  finally { signal.removeEventListener("abort", abortFromParent); }
  if (signal.aborted) throw signal.reason ?? new DOMException("扫描已取消", "AbortError");
  const unprocessedSymbols = batch.securities.filter((security) => !covered.has(security.symbol)).map((security) => security.symbol);
  return { results, failures, shortHistorySymbols, unprocessedSymbols, dataDate, paused, pauseFailureCount };
}

export default function ScreeningWorkspace() {
  const router = useRouter();
  const [job, setJob] = useState<ScreeningJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState<"score" | "candidate" | "excluded">("score");
  const [detail, setDetail] = useState<ScreeningCandidate | null>(null);
  const [browserProgress, setBrowserProgress] = useState<{ processed: number; total: number } | null>(null);
  const [retryDrivingJobId, setRetryDrivingJobId] = useState<string | null>(null);
  const [savingPlan, setSavingPlan] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    async function refresh() {
      try {
        const response = await fetch("/api/screenings", { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error?.message ?? `任务恢复接口返回 ${response.status}`);
        setJob(payload.data ?? null);
        setError(null);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? `扫描进度读取失败：${caught.message}` : "扫描进度读取失败。");
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(refresh, 5_000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!job || job.status !== "running" || retryDrivingJobId !== job.jobId) return;
    const jobId = job.jobId;
    let stopped = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    let failures = 0;
    let pauseFailureCount = job.pauseFailureCount ?? 0;
    let pendingCompletion: Record<string, unknown> | null = null;
    async function driveNextWork() {
      let permanentFailure = false;
      let finished = false;
      let delay = 500;
      try {
        controller = new AbortController();
        const submittingPending = pendingCompletion !== null;
        const response = await fetch(`/api/screenings/${jobId}/work`, {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(pendingCompletion ?? { action: "claim" }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 410) permanentFailure = true;
          if (response.status === 409) {
            pendingCompletion = null;
            setBrowserProgress(null);
          }
          throw new Error(payload.error?.message ?? `扫描 Worker 返回 ${response.status}`);
        }
        pendingCompletion = null;
        if (submittingPending) setBrowserProgress(null);
        let nextJob = payload.data as ScreeningJob;
        const work = payload.work as BrowserScreeningWork | undefined;
        if (work?.kind === "BATCH") {
          setBrowserProgress({ processed: 0, total: work.securities.length });
          const completed = await processBrowserBatch(work, controller.signal, (processed, total) => {
            setBrowserProgress({ processed, total });
          }, pauseFailureCount);
          pauseFailureCount = completed.pauseFailureCount;
          pendingCompletion = {
            action: completed.paused ? "pause" : "complete",
            batchId: work.batchId,
            leaseToken: work.leaseToken,
            ...completed,
          };
          const completeResponse = await fetch(`/api/screenings/${jobId}/work`, {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(pendingCompletion),
            signal: controller.signal,
          });
          const completePayload = await completeResponse.json().catch(() => ({}));
          if (!completeResponse.ok) {
            if (completeResponse.status === 409) pendingCompletion = null;
            throw new Error(completePayload.error?.message ?? `扫描结果保存接口返回 ${completeResponse.status}`);
          }
          pendingCompletion = null;
          nextJob = completePayload.data as ScreeningJob;
          pauseFailureCount = nextJob.pauseFailureCount ?? pauseFailureCount;
          setBrowserProgress(null);
        }
        if (work?.kind === "IDLE" && nextJob.status === "running") delay = 5_000;
        failures = 0;
        setError(null);
        finished = nextJob.status !== "running";
        if (finished) setRetryDrivingJobId(null);
        setJob(nextJob);
      } catch (caught) {
        if (controller?.signal.aborted) return;
        const message = caught instanceof Error ? `扫描处理暂时中断：${caught.message}` : "扫描处理暂时中断，请检查网络连接。";
        if (permanentFailure) {
          setRetryDrivingJobId(null);
          setError(message);
          setJob((current) => current ? { ...current, status: "failed", stage: "失败", error: message } : current);
          return;
        }
        const nextFailure = accumulateScreeningWorkerFailures(failures);
        failures = nextFailure.count;
        if (nextFailure.shouldPause) {
          finished = true;
          setRetryDrivingJobId(null);
          pendingCompletion = null;
          setBrowserProgress(null);
          const pauseMessage = `${message}，已连续失败 3 次，扫描已暂停并保留当前结果。点击继续后再恢复扫描。`;
          try {
            const pauseResponse = await fetch(`/api/screenings/${jobId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "pause_after_failures" }),
            });
            const pausePayload = await pauseResponse.json().catch(() => ({}));
            if (!pauseResponse.ok) throw new Error(pausePayload.error?.message ?? `暂停接口返回 ${pauseResponse.status}`);
            setJob(pausePayload.data);
            setError(null);
          } catch {
            setJob((current) => current ? { ...current, status: "paused", stage: "已暂停", error: pauseMessage } : current);
            setError(null);
          }
          return;
        }
        delay = Math.min(15_000, 2_000 * 2 ** Math.min(failures, 3));
        setError(`${message}，保持页面打开，${Math.ceil(delay / 1000)} 秒后自动重试（第 ${failures} 次）。`);
      } finally {
        if (!stopped && !finished && !permanentFailure) {
          timer = window.setTimeout(driveNextWork, delay);
        }
      }
    }
    timer = window.setTimeout(driveNextWork, 250);
    return () => {
      stopped = true;
      controller?.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [job?.jobId, job?.status, retryDrivingJobId]);

  async function retry() {
    if (!job || starting || (job.status !== "paused" && !(job.status === "completed" && job.failedCount > 0))) return;
    setStarting(true); setError(null); setSelected([]); setDetail(null);
    try {
      const response = await fetch(`/api/screenings/${job.jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: job.status === "paused" ? "continue" : "retry_failures" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message ?? `重试接口返回 ${response.status}`);
      setJob(payload.data);
      setRetryDrivingJobId(payload.data.jobId);
    } catch (caught) {
      setError(caught instanceof Error ? `重试失败：${caught.message}` : "重试失败，请稍后再试。");
    } finally { setStarting(false); }
  }

  async function addCandidatesToPlan(candidates: ScreeningCandidate[]) {
    const executableCandidates = candidates.filter((candidate) => candidate.bucket === "candidate");
    if (!job || savingPlan || !executableCandidates.length) return;
    setSavingPlan(true);
    setError(null);
    try {
      const currentResponse = await fetch("/api/position-plan", { cache: "no-store" });
      if (!currentResponse.ok) throw new Error("无法读取共享模拟盘");
      let plan = await currentResponse.json() as PositionPlanRecord;
      for (const candidate of executableCandidates) {
        const item = {
          symbol: candidate.symbol,
          name: candidate.name,
          industry: candidate.industry || "未分类",
          score: candidate.score,
          technicalScore: candidate.technicalScore,
          strengthScore: candidate.strengthScore,
          signalDate: candidate.signalDate,
          plannedEntryPrice: candidate.entryPrice,
          initialStopPrice: candidate.initialStopPrice,
          strategyId: job.strategyId,
          strategyVersion: job.strategyVersion,
          parameterVersion: job.parameterVersion,
          source: "market-screening",
          confirmationState: "pending-t1-open",
        };
        let response = await fetch("/api/position-plan/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: plan.revision, item }) });
        let payload = await response.json() as PositionPlanRecord & { code?: string; message?: string };
        if (response.status === 409 && payload.code === "SIGNAL_REPLACE_REQUIRED") {
          if (!window.confirm(`${candidate.name} 已有不同信号，使用 ${candidate.signalDate} 的扫描结果更新原项？`)) continue;
          response = await fetch("/api/position-plan/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: plan.revision, item, replaceSignal: true }) });
          payload = await response.json() as PositionPlanRecord & { code?: string; message?: string };
        }
        if (!response.ok) throw new Error(payload.message ?? `${candidate.name} 加入失败`);
        plan = payload;
      }
      setSelected([]);
      setDetail(null);
      router.push("/positions");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "写入共享模拟盘失败");
    } finally {
      setSavingPlan(false);
    }
  }

  const scoreTop10 = useMemo(() => (job?.candidates ?? []).slice(0, 10).map((item, index) => ({ ...item, rank: index + 1 })), [job]);
  const candidateTop10 = useMemo(() => (job?.candidateTop10 ?? []).slice(0, 10).map((item, index) => ({ ...item, rank: index + 1 })), [job]);
  const selectedCandidates = useMemo(() => candidateTop10.filter((item) => selected.includes(item.symbol)), [candidateTop10, selected]);
  const list = tab === "score" ? scoreTop10 : tab === "candidate" ? candidateTop10 : [];
  const generatedTime = recordTime(job?.generatedAt ?? null);
  const canRetry = job?.status === "paused" || (job?.status === "completed" && job.failedCount > 0);
  const scanLabel = starting
    ? "正在重新排队失败数据…"
    : job?.status === "paused"
      ? `重试未完成数据 · ${job.failedCount} 只`
      : `重试失败数据 · ${job?.failedCount ?? 0} 只`;
  const scanStatus = starting
    ? "正在复用原扫描任务并重新排队失败数据。"
    : job?.status === "running"
      ? browserProgress
        ? `正在重试当前分片：${browserProgress.processed}/${browserProgress.total}。重试期间请保持页面打开。`
        : `服务端正在执行 ${job.stage}：${job.processed}/${job.afterBasicFilter || "—"}。页面会自动刷新进度，可以安全关闭。`
      : job?.status === "paused"
        ? job.pauseFailureCount >= 3
          ? `行情读取累计失败 ${job.pauseFailureCount} 次，已保留当前双榜。可重试失败及未查询股票。`
          : "扫描已暂停并保留当前结果，可重试未完成数据。"
      : job?.status === "completed" && job.failedCount > 0
        ? `本次有 ${job.failedCount} 只未完成评分；重试只处理失败股票，已成功结果会保留。`
        : job?.status === "completed"
          ? "扫描已完成。评分榜用于比较，候选榜用于规划买入。"
          : "等待每日服务端扫描任务，页面不会创建新的全市场任务。";

  return <main className={styles.page}><div className={styles.shell}>
    <header className={`${styles.hero} ${styles.scanHero}`}>
      <section className={styles.heroMain} aria-labelledby="market-scan-title">
        <h1 className={styles.heroTitle} id="market-scan-title"><span>全市场双榜扫描</span><em>评分 TOP 10 · 候选 TOP 10</em></h1>
        <p className={styles.heroCopy}>读取沪深主板最新完整日线，输出相对评分榜与通过全部门槛、已经重新转强的候选榜。</p>
        <dl className={styles.heroMeta}>
          <div><dt>数据</dt><dd>最新完整交易日</dd></div>
          <div><dt>范围</dt><dd>沪深主板 · 暂不含创业板</dd></div>
          <div><dt>输出</dt><dd>双榜各 10 只</dd></div>
        </dl>
        {canRetry ? <div className={styles.scanActions}>
          <button aria-busy={starting} className={styles.primaryButton} disabled={starting} onClick={retry}>{scanLabel}</button>
        </div> : null}
        <p aria-live="polite" className={styles.scanStatus}>{scanStatus}</p>
        {job?.status === "paused" ? <p className={styles.pauseNotice}>{job.error}</p> : error || job?.error ? <p className={styles.scanError}>{error ?? job?.error}</p> : null}
      </section>
      <aside className={styles.heroSide} aria-label="当前策略图示与记录时间">
        <div className={styles.strategyIdentity}><div><span>当前扫描策略</span><strong>{currentStrategy.displayName}</strong></div><b>V0.4</b></div>
        <StrategyIllustration/>
        <div className={styles.recordTime}><span>最近记录时间</span>{generatedTime?<time dateTime={job?.generatedAt??undefined}>{generatedTime}</time>:<p>扫描完成后显示，记录保留 3 天</p>}</div>
      </aside>
    </header>
    <section className={styles.section} aria-labelledby="today-candidates"><header className={styles.sectionHeader}><h2 id="today-candidates">评分与候选双榜</h2><p>评分榜比较全市场相对强弱；候选榜只保留全部门槛和转强触发均通过的股票。</p></header>
      {job?.status === "paused" ? <div className={styles.pauseSnapshot}><strong>当前 TOP 快照</strong><p>已完成 {job.scored} 只股票。以下排名基于暂停前成功返回的数据，继续扫描后会自动更新。</p></div> : null}
      {!job ? <div className={styles.emptyResult}>尚无扫描结果。完成扫描后，这里显示评分 TOP 10 与候选 TOP 10。</div> : null}
      {job ? <div><div className={styles.summaryStrip}><div className={styles.summaryValues}><span>全市场 <b>{job.universeTotal || "—"}</b></span><span>基础过滤后 <b>{job.afterBasicFilter || "—"}</b></span><span>完成评分 <b>{job.scored}</b></span><span>评分榜 <b>{scoreTop10.length}</b></span><span>候选榜 <b>{candidateTop10.length}</b></span><span>数据失败 <b>{job.failedCount}</b></span><span>耗时 <b>{(job.elapsedMs/1000).toFixed(1)}秒</b></span><span>记录 <b>{job.cacheHit ? "已有记录" : "本次生成"}</b></span></div>{job.incomplete ? <p className={styles.warning}>数据失败超过 5%，仍返回已成功评分的双榜，但本次排名可能不完整。</p> : null}</div>{job.failedCount > 0 ? <FailureDetails failures={job.failures ?? []} reportedCount={job.failedCount} total={job.failureDetailsTotal ?? job.failures?.length ?? 0}/> : null}<div className={styles.tabs}>{([['score','评分 TOP 10'],['candidate','候选 TOP 10'],['excluded','未达标原因']] as const).map(([value,label])=><button className={`${styles.tabButton} ${tab===value?styles.tabActive:""}`} key={value} onClick={()=>{setTab(value);setSelected([]);}}>{label}</button>)}{selected.length ? <button className={`${styles.tabButton} ${styles.planAction}`} disabled={savingPlan} onClick={()=>addCandidatesToPlan(selectedCandidates)}>{savingPlan ? "正在写入…" : `为已选 ${selected.length} 只规划仓位`}</button>:null}</div>{tab === "excluded" ? <div className={styles.exclusionGrid}>{job.exclusions.map((item)=><div className={styles.exclusion} key={item.reason}><span>{item.reason}</span><b>{item.count}</b></div>)}</div>:<CandidateList candidates={list} detail={setDetail} selected={selected} setSelected={setSelected}/>}<p className={styles.footerNote}>数据截止 {job.dataDate ?? "读取中"} · {job.adjustment} · {job.provider} · 策略 {job.strategyVersion} / 参数 {job.parameterVersion}。评分 TOP 10 只表示相对排名；只有候选状态可以加入仓位方案。</p></div>:null}
    </section>
    {detail ? <CandidateDrawer candidate={detail} close={()=>setDetail(null)} add={()=>addCandidatesToPlan([detail])}/>:null}
  </div></main>;
}

function failureCodeLabel(code: string) {
  if (code === "TIMEOUT") return "请求超时";
  if (code === "RATE_LIMITED") return "行情限流";
  if (code === "HTTP_501") return "HTTP 501";
  if (code === "NOT_FOUND") return "行情无数据";
  if (code === "INVALID_DATA") return "行情格式异常";
  if (code === "INSUFFICIENT_DATA") return "历史日线不足";
  if (code === "LEGACY_UNCLASSIFIED") return "旧记录待核验";
  return "行情源异常";
}

function FailureDetails({ failures, reportedCount, total }: { failures: ScreeningFailure[]; reportedCount: number; total: number }) {
  const legacyCount = failures.filter((item) => !item.errorCode || item.errorCode === "LEGACY_UNCLASSIFIED").length;
  return <details className={styles.failureDetails}>
    <summary className={styles.failureSummary}>
      <span>查看失败明细</span>
      <b>{legacyCount ? `${total} 只待重新核验` : `${reportedCount} 只`}</b>
    </summary>
    {legacyCount ? <p className={styles.failureLegacy}>旧版本只保存了失败数量，没有逐股错误。系统已从原始批次重建 {legacyCount} 只未评分标的；再次点击扫描后会重新读取行情，并重新区分“历史不足”和“行情源异常”。</p> : null}
    {failures.length ? <ul className={styles.failureList}>
      {failures.map((failure) => <li className={styles.failureRow} key={failure.symbol}>
        <div><strong>{failure.name}</strong><span>{failure.symbol}</span></div>
        <b>{failureCodeLabel(failure.errorCode)}</b>
        <p>{failure.errorMessage || "旧版本未保存错误摘要；重试时会重新读取行情。"}</p>
      </li>)}
    </ul> : <p className={styles.failureEmpty}>该任务来自旧版本，未保存逐股失败信息；再次点击扫描会重建并重试未评分股票。</p>}
    {total > failures.length ? <p className={styles.failureLimit}>为保持页面响应速度，仅展示前 {failures.length} 条；重试仍会处理全部 {total} 条。</p> : null}
  </details>;
}

function StrategyIllustration(){
  return <svg aria-labelledby="strategy-illustration-title" className={styles.strategyIllustration} role="img" viewBox="0 0 420 190">
    <title id="strategy-illustration-title">趋势回调转强策略买卖点：重新站上MA5或突破前三日高后买入，触发止损或趋势退出时卖出</title>
    <g className={styles.tradeGrid}><path d="M20 42H400M20 86H400M20 130H400"/></g>
    <path className={styles.ma20Line} d="M20 126C72 121 108 112 150 115S228 103 272 91S346 89 400 101"/>
    <text className={styles.tradeAxisLabel} x="356" y="92">MA20</text>
    <path className={styles.priceLine} d="M20 119C52 110 75 68 108 73C139 78 147 124 181 115C220 104 229 63 266 69C298 74 314 43 342 55C368 66 367 103 400 114"/>
    <path className={styles.stopLine} d="M142 144H270"/>
    <text className={styles.stopLabel} x="125" y="174">初始止损：回调低点 − 0.3 ATR</text>
    <g className={styles.buyPoint}><path d="M181 104l-9 17h18z"/><path d="M181 104V62H108"/><text x="24" y="21">买点 · T+1 开盘</text><text x="24" y="45">重上 MA5 / 突破前三日高</text></g>
    <g className={styles.sellPoint}><path d="M376 108l-9-17h18z"/><path d="M376 108v25h-96"/><text x="274" y="126">卖点 · 止损或趋势退出</text></g>
  </svg>;
}

function CandidateList({candidates,selected,setSelected,detail}:{candidates:ScreeningCandidate[];selected:string[];setSelected:(value:string[])=>void;detail:(item:ScreeningCandidate)=>void}){
  if(!candidates.length)return <div className={styles.emptyResult}>当前状态没有可展示的股票。</div>;
  return <div className={styles.table}>
    <div className={styles.tableHead}><span>排名</span><span>股票</span><span>结论</span><span>总分</span><span>转强分</span><span>止损风险</span><span>20日均额</span><span>操作</span></div>
    {candidates.map((item)=>{
      const isSelected=selected.includes(item.symbol);
      const selectable=item.bucket==="candidate";
      return <div className={styles.candidate} key={item.symbol}>
        <span className={styles.rank}>#{item.rank??"—"}</span>
        <div><button className={styles.stockButton} onClick={()=>detail(item)}>{item.name}</button><p className={styles.code}>{item.code} · {item.market}</p></div>
        <span className={styles.pass}>{item.conclusion}</span>
        <span className={styles.score}>{item.score}<small>/100</small></span>
        <span>{item.strengthScore}/35</span>
        <span>{(item.stopDistanceRate*100).toFixed(2)}%<br/><b>{item.riskLabel}</b></span>
        <span>{money(item.averageAmount20)}</span>
        <div className={styles.rowActions}>
          <Link className={styles.detailLink} href={`/evaluate?symbol=${item.code}&signalDate=${item.signalDate}`}>评估详情</Link>
          <button
            aria-label={`${isSelected?"取消选择":"选择"}${item.name}`}
            aria-pressed={isSelected}
            className={styles.selectButton}
            disabled={!selectable}
            onClick={()=>setSelected(isSelected?selected.filter((value)=>value!==item.symbol):[...selected,item.symbol])}
            type="button"
          ><span aria-hidden="true" className={styles.selectIndicator}/><span>{selectable?(isSelected?"已选":"选择"):"仅查看"}</span></button>
        </div>
      </div>;
    })}
  </div>;
}

function CandidateDrawer({candidate,close,add}:{candidate:ScreeningCandidate;close:()=>void;add:()=>void|Promise<void>}){
  const actionable=candidate.bucket==="candidate";
  return <div className={styles.drawerOverlay} onMouseDown={close}><aside aria-label="候选详情" className={styles.drawer} onMouseDown={(e)=>e.stopPropagation()}><button aria-label="关闭候选详情" className={styles.drawerClose} onClick={close}>×</button><p className={styles.eyebrow}>{candidate.conclusion} #{candidate.rank}</p><h2>{candidate.name} <small>{candidate.code}</small></h2><div className={styles.drawerGrid}>{[["总分",`${candidate.score}/100`],["技术分",`${candidate.technicalScore}/90`],["转强分",`${candidate.strengthScore}/35`],["20日均额",money(candidate.averageAmount20)]].map(([k,v])=><div key={k}><p>{k}</p><b>{v}</b></div>)}</div><div className={styles.drawerCopy}><h3>进入排名的原因</h3><p>{candidate.rankingReason}；{candidate.firstReason}。</p><h3>执行计划</h3><p>{actionable?`计划入场 ¥${candidate.entryPrice.toFixed(2)} · 初始止损 ¥${candidate.initialStopPrice.toFixed(2)} · 止损距离 ${(candidate.stopDistanceRate*100).toFixed(2)}%。`:"当前未进入候选榜，只能查看评分，不能规划买入。"}</p><h3>T+1 取消条件</h3><p>高开超过2%、止损距离失效、事件风险、组合额度不足或无法正常成交。</p></div><div className={styles.drawerActions}><Link className={styles.linkButton} href={`/evaluate?symbol=${candidate.code}&signalDate=${candidate.signalDate}`}>完整个股评分</Link><button className={styles.linkButton} disabled={!actionable} onClick={add}>{actionable?"加入仓位方案":"仅候选可加入"}</button></div></aside></div>;
}
