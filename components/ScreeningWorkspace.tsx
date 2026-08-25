"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import styles from "@/app/operational.module.css";
import type { ScreeningCandidate, ScreeningJob } from "@/lib/screening";
import { currentStrategy } from "@/lib/strategies";

function money(value: number) { return value >= 100_000_000 ? `${(value / 100_000_000).toFixed(1)}亿` : `${(value / 10_000).toFixed(0)}万`; }
function encodeCandidates(items: ScreeningCandidate[]) { return items.map((i) => [i.code, encodeURIComponent(i.name), i.rank, i.score, i.entryPrice, i.initialStopPrice].join("~")).join(","); }
function recordTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

export default function ScreeningWorkspace() {
  const router = useRouter();
  const [job, setJob] = useState<ScreeningJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState<"candidate" | "watch" | "excluded">("candidate");
  const [detail, setDetail] = useState<ScreeningCandidate | null>(null);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/screenings/${job.jobId}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message ?? `任务状态接口返回 ${response.status}`);
        setJob(payload.data);
      } catch (caught) {
        const message = caught instanceof Error ? `扫描状态读取失败：${caught.message}` : "扫描状态读取失败，请检查本地服务连接。";
        setError(message);
        setJob((current) => current ? { ...current, status: "failed", stage: "失败", error: message } : current);
        window.clearInterval(timer);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job?.jobId, job?.status]);

  async function start() {
    setError(null); setSelected([]); setDetail(null);
    try {
      const response = await fetch("/api/screenings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ strategyId: currentStrategy.strategyId, strategyVersion: currentStrategy.strategyVersion }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? `扫描接口返回 ${response.status}`);
      setJob(payload.data);
    } catch (caught) { setError(caught instanceof Error ? `无法启动扫描：${caught.message}` : "无法启动扫描，请检查本地服务连接。"); }
  }
  async function cancel() {
    if (!job) return;
    try { const response = await fetch(`/api/screenings/${job.jobId}`, { method: "DELETE" }); if (!response.ok) throw new Error(`取消接口返回 ${response.status}`); }
    catch (caught) { setError(caught instanceof Error ? `取消扫描失败：${caught.message}` : "取消扫描失败，请稍后重试。"); }
  }

  const selectedCandidates = useMemo(() => job?.candidates.filter((item) => selected.includes(item.symbol)) ?? [], [job, selected]);
  const list = tab === "candidate" ? job?.candidates ?? [] : tab === "watch" ? job?.watch ?? [] : [];
  const generatedTime = recordTime(job?.generatedAt ?? null);

  return <main className={styles.page}><div className={styles.shell}>
    <header className={styles.hero}>
      <div className={styles.heroMain}><p className={styles.eyebrow}>全市场策略签发中心</p><h1 className={styles.heroTitle}><span>筛选今日市场，</span><em>签发 TOP 10</em></h1><p className={styles.heroCopy}>按固定策略扫描沪深 A 股：先过滤基础风险，再逐股评分并稳定排序。TOP 10 展示成功评分标的的相对排名；策略门槛只标注状态，不影响榜单输出。</p></div>
      <div className={styles.heroSide}>
        <div className={styles.strategyIdentity}><div><span>当前扫描策略</span><strong>{currentStrategy.displayName}</strong></div><b>V0.4</b></div>
        <StrategyIllustration/>
        <div className={styles.recordTime}><span>最近记录时间</span>{generatedTime?<time dateTime={job?.generatedAt??undefined}>{generatedTime}</time>:<p>扫描完成后显示，记录保留 3 天</p>}</div>
      </div>
    </header>
    <div className={styles.carrier}><div className={styles.split}>
      <section className={styles.coupon} aria-labelledby="strategy-title"><div className={styles.couponHeader}><div><h2 id="strategy-title">扫描签发单</h2><p>注册策略与输入宇宙</p></div><span className={styles.badge}>当前 / VALID</span></div><h3 className={styles.strategyName}>{currentStrategy.displayName}</h3><dl className={styles.dataGrid}><div><dt>数据日期</dt><dd>最新完整交易日</dd></div><div><dt>市场</dt><dd>沪深 A 股</dd></div><div><dt>基础流动性</dt><dd>20日均额作为评分状态</dd></div><div><dt>排名 / 输出</dt><dd>全体已评分 · TOP 10</dd></div></dl><button className={styles.primaryButton} disabled={job?.status === "running"} onClick={start}>{job?.status === "running" ? `${job.stage} · ${job.processed}/${job.afterBasicFilter || "—"}` : job?.status === "completed" ? "再次读取策略结果" : "使用此策略扫描全市场"}</button>{job?.status === "running" ? <button className={styles.secondaryButton} onClick={cancel}>取消扫描</button> : null}<p className={styles.note}>策略门槛仍用于解释状态，但不再过滤 TOP 10 结果。</p>{error || job?.error ? <p className={styles.error}>{error ?? job?.error}</p> : null}</section>
      <aside className={`${styles.coupon} ${styles.carbon} ${styles.perforated}`}><div className={styles.couponHeader}><div><h2>签发流程回执</h2><p>当前扫描阶段将持续写入此联</p></div></div><div className={styles.processList}>{[["01","获取证券池","读取沪深 A 股与交易状态"],["02","逐股评分","为基础过滤后的标的读取完整日线"],["03","稳定排名","只签发实际达到门槛的候选"]].map(([no,title,copy])=><div className={styles.processRow} key={no}><span className={styles.processNo}>{no}</span><div><strong>{title}</strong><p>{copy}</p></div></div>)}</div></aside>
    </div></div>
    <section className={styles.section} aria-labelledby="today-candidates"><header className={styles.sectionHeader}><h2 id="today-candidates">全市场 TOP 10 联票</h2><p>不论是否达到交易门槛，均按总分、转强分、止损距离、流动性和股票代码稳定排序。</p></header>
      {!job ? <div className={styles.emptyStrip}>{[["1. 获取证券池","读取沪深 A 股与交易状态。"],["2. 逐股评分","至少 250 日前复权数据。"],["3. 稳定排名","只返回实际达标候选。"]].map(([title,copy])=><div className={styles.emptyStep} key={title}><strong>{title}</strong><p>{copy}</p></div>)}</div> : null}
      {job ? <div><div className={styles.summaryStrip}><div className={styles.summaryValues}><span>全市场 <b>{job.universeTotal || "—"}</b></span><span>基础过滤后 <b>{job.afterBasicFilter || "—"}</b></span><span>完成评分 <b>{job.scored}</b></span><span>返回排名 <b>{job.candidates.length}</b></span><span>数据失败 <b>{job.failedCount}</b></span><span>耗时 <b>{(job.elapsedMs/1000).toFixed(1)}秒</b></span><span>记录 <b>{job.cacheHit ? "已有记录" : "本次生成"}</b></span></div>{job.incomplete ? <p className={styles.warning}>数据失败超过 5%，仍返回已成功评分股票的 TOP 10，但本次全市场排名可能不完整。</p> : null}</div><div className={styles.tabs}>{([['candidate','TOP 10'],['watch','等待转强'],['excluded','未达标原因']] as const).map(([value,label])=><button className={`${styles.tabButton} ${tab===value?styles.tabActive:""}`} key={value} onClick={()=>setTab(value)}>{label}</button>)}{selected.length ? <button className={`${styles.tabButton} ${styles.planAction}`} onClick={()=>router.push(`/positions?items=${encodeCandidates(selectedCandidates)}`)}>为已选 {selected.length} 只规划仓位</button>:null}</div>{tab === "excluded" ? <div className={styles.exclusionGrid}>{job.exclusions.map((item)=><div className={styles.exclusion} key={item.reason}><span>{item.reason}</span><b>{item.count}</b></div>)}</div>:<CandidateList candidates={list} detail={setDetail} selected={selected} setSelected={setSelected}/>}<p className={styles.footerNote}>数据截止 {job.dataDate ?? "读取中"} · {job.adjustment} · {job.provider} · 策略 {job.strategyVersion} / 参数 {job.parameterVersion}。TOP 10 仅代表相对排名，不代表达到交易门槛、胜率或投资建议。</p></div>:null}
    </section>
    {detail ? <CandidateDrawer candidate={detail} close={()=>setDetail(null)} add={()=>setSelected((items)=>items.includes(detail.symbol)?items:[...items,detail.symbol])}/>:null}
  </div></main>;
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
            onClick={()=>setSelected(isSelected?selected.filter((value)=>value!==item.symbol):[...selected,item.symbol])}
            type="button"
          ><span aria-hidden="true" className={styles.selectIndicator}/><span>{isSelected?"已选":"选择"}</span></button>
        </div>
      </div>;
    })}
  </div>;
}

function CandidateDrawer({candidate,close,add}:{candidate:ScreeningCandidate;close:()=>void;add:()=>void}){
  return <div className={styles.drawerOverlay} onMouseDown={close}><aside aria-label="候选详情" className={styles.drawer} onMouseDown={(e)=>e.stopPropagation()}><button aria-label="关闭候选详情" className={styles.drawerClose} onClick={close}>×</button><p className={styles.eyebrow}>候选 #{candidate.rank}</p><h2>{candidate.name} <small>{candidate.code}</small></h2><div className={styles.drawerGrid}>{[["总分",`${candidate.score}/100`],["技术分",`${candidate.technicalScore}/90`],["转强分",`${candidate.strengthScore}/35`],["20日均额",money(candidate.averageAmount20)]].map(([k,v])=><div key={k}><p>{k}</p><b>{v}</b></div>)}</div><div className={styles.drawerCopy}><h3>进入排名的原因</h3><p>{candidate.rankingReason}；{candidate.firstReason}。</p><h3>执行计划</h3><p>计划入场 ¥{candidate.entryPrice.toFixed(2)} · 初始止损 ¥{candidate.initialStopPrice.toFixed(2)} · 止损距离 {(candidate.stopDistanceRate*100).toFixed(2)}%。</p><h3>T+1 取消条件</h3><p>高开超过2%、止损距离失效、事件风险、组合额度不足或无法正常成交。</p></div><div className={styles.drawerActions}><Link className={styles.linkButton} href={`/evaluate?symbol=${candidate.code}&signalDate=${candidate.signalDate}`}>完整个股评分</Link><button className={styles.linkButton} onClick={add}>加入仓位方案</button></div></aside></div>;
}
