"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "@/app/operational.module.css";
import type { PositionPlanItemRecord, PositionPlanRecord, PositionTradeRecord } from "@/lib/position-plan";
import { calculatePortfolioReturnSummary, calculatePositionPerformance } from "@/lib/position-performance";
import type { HoldingStatus } from "@/lib/position-status";
import { calculatePositionPlan } from "@/lib/positions";

type HeldDraft = { averageCost: number; actualShares: number; purchaseDate: string; initialStopPrice: number };
type SellDraft = { exitPrice: number; exitDate: string; exitReason: string; reviewNote: string; saving: boolean };
type ApiError = { code?: string; message?: string; latest?: PositionPlanRecord };

function currency(value: number) { return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(value); }
function percent(value: number | null) { return value === null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`; }
function ratio(value: number | null) { return value === null || !Number.isFinite(value) ? "—" : value.toFixed(2); }

export default function PositionPlanner({ encodedItems: _encodedItems }: { encodedItems: string }) {
  const [record, setRecord] = useState<PositionPlanRecord | null>(null);
  const recordRef = useRef<PositionPlanRecord | null>(null);
  const dirtyRef = useRef(false);
  const [statuses, setStatuses] = useState<Record<string, HoldingStatus>>({});
  const [statusErrors, setStatusErrors] = useState<Record<string, string>>({});
  const [heldDrafts, setHeldDrafts] = useState<Record<string, HeldDraft>>({});
  const [sellDrafts, setSellDrafts] = useState<Record<string, SellDraft>>({});
  const [message, setMessage] = useState("正在读取共享模拟盘…");
  const [remotePlan, setRemotePlan] = useState<PositionPlanRecord | null>(null);

  function acceptPlan(next: PositionPlanRecord) { recordRef.current = next; setRecord(next); dirtyRef.current = false; }
  async function readPlan() {
    const response = await fetch("/api/position-plan", { cache: "no-store" });
    const payload = await response.json() as PositionPlanRecord & ApiError;
    if (!response.ok) throw new Error(payload.message ?? "模拟盘读取失败");
    return payload;
  }
  async function write(url: string, method: "PATCH" | "POST" | "DELETE", body: Record<string, unknown>) {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json() as PositionPlanRecord & ApiError;
    if (response.status === 409 && payload.latest) {
      setRemotePlan(payload.latest); setMessage("模拟盘已在其他页面更新，请载入最新版本后继续编辑。"); throw new Error("版本冲突");
    }
    if (!response.ok) throw new Error(payload.message ?? "保存失败");
    acceptPlan(payload); setMessage(`已保存 · 版本 ${payload.revision}`); return payload;
  }

  useEffect(() => {
    let active = true;
    readPlan().then((plan) => { if (active) { acceptPlan(plan); setMessage(`共享模拟盘 · 版本 ${plan.revision}`); } }).catch((error) => active && setMessage(error instanceof Error ? error.message : "模拟盘读取失败"));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      readPlan().then((latest) => {
        const current = recordRef.current;
        if (!current || latest.revision === current.revision) return;
        if (dirtyRef.current) { setRemotePlan(latest); setMessage("模拟盘已在其他页面更新，请载入最新版本。"); }
        else { acceptPlan(latest); setMessage(`已自动载入其他页面的更新 · 版本 ${latest.revision}`); }
      }).catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const heldStatusKey = record?.items.filter((item) => item.positionState === "held").map((item) => `${item.id}:${item.averageCost}:${item.actualShares}:${item.purchaseDate}:${item.initialStopPrice}`).join("|") ?? "";
  useEffect(() => {
    if (!record) return;
    let active = true;
    const held = record.items.filter((item) => item.positionState === "held" && item.averageCost && item.actualShares && item.purchaseDate);
    Promise.all(held.map(async (item) => {
      const response = await fetch("/api/positions/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: item.symbol, purchaseDate: item.purchaseDate, averageCost: item.averageCost, actualShares: item.actualShares, initialStopPrice: item.initialStopPrice }) });
      const payload = await response.json() as HoldingStatus & { message?: string };
      if (!response.ok) throw { id: item.id, message: payload.message ?? "行情状态计算失败" };
      return { id: item.id, status: payload };
    })).then((results) => { if (active) { setStatuses(Object.fromEntries(results.map((result) => [result.id, result.status]))); setStatusErrors({}); } }).catch((error: { id?: string; message?: string }) => { if (active && error.id) setStatusErrors((current) => ({ ...current, [error.id!]: error.message ?? "行情状态计算失败" })); });
    return () => { active = false; };
  }, [heldStatusKey]);

  const heldItems = record?.items.filter((item) => item.positionState === "held") ?? [];
  const heldValue = heldItems.reduce((sum, item) => sum + (statuses[item.id]?.currentPrice ?? item.averageCost ?? 0) * (item.actualShares ?? 0), 0);
  const heldRisk = heldItems.reduce((sum, item) => sum + (statuses[item.id]?.protectedRisk ?? Math.max(0, ((item.averageCost ?? 0) - item.initialStopPrice) * (item.actualShares ?? 0))), 0);
  const industryHeld = useMemo(() => {
    const values = new Map<string, number>();
    for (const item of heldItems) values.set(item.industry, (values.get(item.industry) ?? 0) + (statuses[item.id]?.currentPrice ?? item.averageCost ?? 0) * (item.actualShares ?? 0));
    return values;
  }, [heldItems, statuses]);
  const plannedItems = record?.items.filter((item) => item.positionState === "planned") ?? [];
  const plan = useMemo(() => calculatePositionPlan({ accountEquity: record?.accountEquity ?? 0, currentOpenRisk: (record?.currentOpenRisk ?? 0) + heldRisk, threeConsecutiveStops: record?.threeConsecutiveStops ?? false, candidates: plannedItems.map((item) => ({ symbol: item.symbol, name: item.name, industry: item.industry, rank: item.priority, score: item.score, entryPrice: item.plannedEntryPrice, initialStopPrice: item.initialStopPrice, existingStockValue: item.existingStockValue, existingIndustryValue: item.existingIndustryValue + (industryHeld.get(item.industry) ?? 0) })) }), [record, heldRisk, plannedItems, industryHeld]);
  const performance = useMemo(() => calculatePositionPerformance(record?.history ?? []), [record?.history]);
  const returnSummary = useMemo(() => calculatePortfolioReturnSummary(
    record?.accountEquity ?? 0,
    record?.history ?? [],
    heldItems.map((item) => ({
      purchaseDate: item.purchaseDate,
      valuationDate: statuses[item.id]?.quoteDate ?? null,
      averageCost: item.averageCost,
      currentPrice: statuses[item.id]?.currentPrice ?? item.averageCost,
      actualShares: item.actualShares,
    })),
  ), [record?.accountEquity, record?.history, heldStatusKey, statuses]);

  function localItem(id: string, changes: Partial<PositionPlanItemRecord>) { dirtyRef.current = true; setRecord((current) => current ? { ...current, items: current.items.map((item) => item.id === id ? { ...item, ...changes } : item) } : current); }
  async function saveItem(id: string, changes: Record<string, unknown>) {
    const current = recordRef.current; if (!current) return null;
    try { return await write(`/api/position-plan/items/${id}`, "PATCH", { revision: current.revision, changes }); }
    catch (error) { if ((error as Error).message !== "版本冲突") setMessage((error as Error).message); return null; }
  }
  async function saveAccount(changes: Record<string, unknown>) {
    const current = recordRef.current; if (!current) return;
    try { await write("/api/position-plan", "PATCH", { revision: current.revision, ...changes }); } catch (error) { if ((error as Error).message !== "版本冲突") setMessage((error as Error).message); }
  }
  async function switchToHeld(item: PositionPlanItemRecord, plannedShares: number) {
    if (plannedShares < 1) { setHeldDrafts((current) => ({ ...current, [item.id]: { averageCost: item.plannedEntryPrice, actualShares: 0, purchaseDate: "", initialStopPrice: item.initialStopPrice } })); setMessage("计划股数为 0，请先填写真实成交数据。"); return; }
    await saveItem(item.id, { positionState: "held", averageCost: item.plannedEntryPrice, actualShares: plannedShares, purchaseDate: item.signalDate, initialStopPrice: item.initialStopPrice });
  }
  async function saveHeldDraft(item: PositionPlanItemRecord) {
    const draft = heldDrafts[item.id];
    if (!draft || !(draft.averageCost > 0) || !Number.isInteger(draft.actualShares) || draft.actualShares <= 0 || !draft.purchaseDate || !(draft.initialStopPrice > 0) || draft.initialStopPrice >= draft.averageCost) { setMessage("请填写有效成本、正整数股数、买入日期，并确保初始止损低于成本。"); return; }
    if (await saveItem(item.id, { ...draft, positionState: "held" })) setHeldDrafts((current) => { const next = { ...current }; delete next[item.id]; return next; });
  }
  async function move(item: PositionPlanItemRecord, direction: -1 | 1) {
    const current = recordRef.current; if (!current) return;
    const index = current.items.findIndex((candidate) => candidate.id === item.id); const target = current.items[index + direction]; if (!target) return;
    if (await saveItem(item.id, { priority: target.priority })) await saveItem(target.id, { priority: item.priority });
  }
  async function removeItem(id: string) { const current = recordRef.current; if (!current || !window.confirm("从共享仓位方案中删除这只股票？")) return; try { await write(`/api/position-plan/items/${id}`, "DELETE", { revision: current.revision }); } catch (error) { setMessage((error as Error).message); } }
  function openSell(item: PositionPlanItemRecord, status?: HoldingStatus) {
    setSellDrafts((current) => ({ ...current, [item.id]: {
      exitPrice: status?.currentPrice ?? item.averageCost ?? 0,
      exitDate: status?.quoteDate ?? item.purchaseDate ?? "",
      exitReason: status?.exitEvent?.reason ?? status?.pendingExitReason ?? "主动卖出",
      reviewNote: "",
      saving: false,
    } }));
  }
  async function closePosition(item: PositionPlanItemRecord) {
    const current = recordRef.current; const draft = sellDrafts[item.id];
    if (!current || !draft || !(draft.exitPrice > 0) || !draft.exitDate || !draft.exitReason.trim()) { setMessage("请填写有效的卖出价格、日期和退出原因。"); return; }
    setSellDrafts((values) => ({ ...values, [item.id]: { ...draft, saving: true } }));
    try {
      await write(`/api/position-plan/items/${item.id}`, "POST", { revision: current.revision, ...draft, saving: undefined });
      setSellDrafts((values) => { const next = { ...values }; delete next[item.id]; return next; });
      setMessage(`${item.name} 已卖出并归档，收益与沪深300同期表现已记录。`);
    } catch (error) {
      setSellDrafts((values) => ({ ...values, [item.id]: { ...draft, saving: false } }));
      if ((error as Error).message !== "版本冲突") setMessage((error as Error).message);
    }
  }
  async function removeHistory(id: string) {
    const current = recordRef.current;
    if (!current || !window.confirm("删除这条成交历史？仅用于纠正录入错误，删除后无法恢复。")) return;
    try { await write(`/api/position-plan/history/${id}`, "DELETE", { revision: current.revision }); }
    catch (error) { if ((error as Error).message !== "版本冲突") setMessage((error as Error).message); }
  }
  async function clearAll() { const current = recordRef.current; if (!current || !window.confirm("清空默认模拟盘的全部仓位、账户输入和成交历史？此操作无法撤销。")) return; try { await write("/api/position-plan/items", "DELETE", { revision: current.revision, confirm: "CLEAR_DEFAULT_SIMULATION" }); } catch (error) { setMessage((error as Error).message); } }

  if (!record) return <main className={styles.page}><div className={styles.shell}><div className={styles.positionEmpty}><h1>仓位方案</h1><p>{message}</p></div></div></main>;
  return <main className={styles.page}><div className={styles.shell}>
    <header className={styles.hero}><div className={styles.heroMain}><p className={styles.eyebrow}>共享模拟盘 · 自动持久化</p><h1 className={styles.heroTitle}>计划买入，<br/><em>追踪完整交易路径</em></h1><p className={styles.heroCopy}>计划项按优先级占用组合风险；持仓沿完整日线管理退出，卖出后保留收益、复盘与沪深300同期对照。</p></div><div className={styles.heroSide}><strong>策略提示，不自动交易</strong><p>{message}</p>{remotePlan ? <button className={styles.secondaryButton} onClick={() => { acceptPlan(remotePlan); setRemotePlan(null); setMessage(`已载入版本 ${remotePlan.revision}`); }}>载入最新版本</button> : null}<button className={styles.dangerButton} onClick={clearAll}>清空全部</button></div></header>
    <section className={styles.section}><header className={styles.sectionHeader}><h2>账户与组合风险</h2><p>提交后立即写入 PostgreSQL，所有浏览器读取同一份数据。</p></header><div className={styles.formStrip}><NumberInput label="账户净值" value={record.accountEquity} onChange={(value) => { dirtyRef.current=true; setRecord({...record,accountEquity:value}); }} onBlur={() => saveAccount({ accountEquity: record.accountEquity })}/><NumberInput label="外部未平仓风险" value={record.currentOpenRisk} onChange={(value) => { dirtyRef.current=true; setRecord({...record,currentOpenRisk:value}); }} onBlur={() => saveAccount({ currentOpenRisk: record.currentOpenRisk })}/><label className={`${styles.formCell} ${styles.checkCell}`}><input checked={record.threeConsecutiveStops} onChange={(event) => { setRecord({...record,threeConsecutiveStops:event.target.checked}); saveAccount({ threeConsecutiveStops:event.target.checked }); }} type="checkbox"/><span>连续3笔完整止损<br/><small>单笔风险减半</small></span></label><div className={`${styles.formCell} ${styles.ruleCell}`}>单股 15% · 行业 30%<br/>组合风险 2% · 缓冲 10%</div></div></section>
    <dl className={styles.metricGrid}>{[["计划市值",currency(plan.plannedValue)],["新增计划风险",currency(plan.addedRisk)],["已持有市值",currency(heldValue)],["当前保护风险",currency(heldRisk)]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <dl className={styles.returnGrid}>
      <div><dt>当前持仓收益</dt><dd data-sign={returnSummary.heldProfit >= 0 ? "positive" : "negative"}>{currency(returnSummary.heldProfit)}</dd><small>{percent(returnSummary.heldReturn)} · 未实现</small></div>
      <div><dt>累计收益</dt><dd data-sign={returnSummary.cumulativeProfit >= 0 ? "positive" : "negative"}>{currency(returnSummary.cumulativeProfit)}</dd><small>{percent(returnSummary.cumulativeReturn)} · 已实现与未实现合计</small></div>
      <div><dt>年化收益</dt><dd data-sign={(returnSummary.annualizedReturn ?? 0) >= 0 ? "positive" : "negative"}>{percent(returnSummary.annualizedReturn)}</dd><small>{returnSummary.elapsedDays === null ? "等待有效成交日期" : `按 ${returnSummary.elapsedDays} 个自然日折算`}</small></div>
    </dl>
    <section className={styles.section}><header className={styles.priorityHeader}><div><h2>仓位项目</h2><p>计划与已持有分别计算，已持有市值和保护风险会占用后续计划容量。</p></div><strong>{record.items.length} 只</strong></header>
      {!record.items.length ? <div className={styles.positionEmpty}><h3>尚未加入标的</h3><p>从“今日选股”或“个股评分”加入后会出现在这里。</p><a className={styles.linkButton} href="/evaluate">前往个股评分</a></div> : <div className={styles.positionList}>{record.items.map((item,index) => {
        const planned = plan.items.find((candidate) => candidate.symbol === item.symbol); const status = statuses[item.id]; const draft = heldDrafts[item.id];
        return <article className={`${styles.positionRow} ${item.positionState === "held" ? styles.heldPosition : ""}`} key={item.id}>
          <div className={styles.positionTopline}><div className={styles.positionIdentity}><div className={styles.moveButtons}><button aria-label="上移" disabled={index===0} onClick={()=>move(item,-1)}>↑</button><button aria-label="下移" disabled={index===record.items.length-1} onClick={()=>move(item,1)}>↓</button></div><div><p>优先级 {index+1} · 信号日 {item.signalDate}</p><h3>{item.name} <small>{item.symbol}</small></h3><p>评分 {item.score} · 策略 {item.strategyVersion} · {item.confirmationState === "pending-t1-open" ? "待开盘确认" : "已确认"}</p></div></div><div className={styles.stateActions}><div className={styles.segmented}><button className={item.positionState === "planned" ? styles.segmentActive : ""} onClick={() => saveItem(item.id,{positionState:"planned"})}>计划买入</button><button className={item.positionState === "held" ? styles.segmentActive : ""} onClick={() => switchToHeld(item,planned?.shares ?? 0)}>已持有</button></div><button aria-label="删除" className={styles.iconDelete} onClick={()=>removeItem(item.id)}>×</button></div></div>
          {item.positionState === "planned" ? <><div className={styles.positionFields}><SmallInput label="计划入场价" value={item.plannedEntryPrice} onChange={(value)=>localItem(item.id,{plannedEntryPrice:value})} onBlur={()=>saveItem(item.id,{plannedEntryPrice:item.plannedEntryPrice})}/><SmallInput label="已有该股市值" value={item.existingStockValue} onChange={(value)=>localItem(item.id,{existingStockValue:value})} onBlur={()=>saveItem(item.id,{existingStockValue:item.existingStockValue})}/><SmallInput label="已有行业市值" value={item.existingIndustryValue} onChange={(value)=>localItem(item.id,{existingIndustryValue:value})} onBlur={()=>saveItem(item.id,{existingIndustryValue:item.existingIndustryValue})}/></div><dl className={styles.positionOutputs}><div><dt>股数 / 仓位</dt><dd>{planned?.shares ?? 0}股<br/>{((planned?.allocationRate ?? 0)*100).toFixed(2)}%</dd></div><div><dt>计划亏损</dt><dd>{currency(planned?.plannedLoss ?? 0)}</dd></div><div><dt>首要限制</dt><dd>{planned?.limitingReason ?? "—"}</dd></div></dl>{draft ? <HeldDraftForm draft={draft} setDraft={(next)=>setHeldDrafts((current)=>({...current,[item.id]:next}))} save={()=>saveHeldDraft(item)} /> : null}</> : <><HeldPosition item={item} status={status} error={statusErrors[item.id]} update={(changes)=>localItem(item.id,changes as Partial<PositionPlanItemRecord>)} save={(changes)=>saveItem(item.id,changes)} openSell={()=>openSell(item,status)} />{sellDrafts[item.id] ? <SellForm draft={sellDrafts[item.id]} setDraft={(next)=>setSellDrafts((current)=>({...current,[item.id]:next}))} cancel={()=>setSellDrafts((current)=>{const next={...current};delete next[item.id];return next;})} save={()=>closePosition(item)} /> : null}</>}
        </article>;
      })}</div>}
    </section>
    <HistoryLedger trades={record.history} performance={performance} remove={removeHistory} />
    <p className={styles.footerNote}>持仓状态使用完整交易日日线并尽量补充盘中价。历史净收益按佣金 0.03%（最低 5 元）与卖出印花税 0.05%计算；沪深300比较采用买卖日期对应或此前最近收盘。</p>
  </div></main>;
}

function HeldDraftForm({draft,setDraft,save}:{draft:HeldDraft;setDraft:(value:HeldDraft)=>void;save:()=>void}) { return <div className={styles.heldDraft}><p>计划股数为 0，请填写真实成交数据后切换。</p><div className={styles.heldFields}><SmallInput label="平均买入成本" value={draft.averageCost} step="0.001" onChange={(value)=>setDraft({...draft,averageCost:value})}/><SmallInput label="实际股数" value={draft.actualShares} step="1" onChange={(value)=>setDraft({...draft,actualShares:value})}/><DateInput label="买入日期" value={draft.purchaseDate} onChange={(value)=>setDraft({...draft,purchaseDate:value})}/><SmallInput label="初始止损" value={draft.initialStopPrice} onChange={(value)=>setDraft({...draft,initialStopPrice:value})}/></div><button className={styles.primaryButton} onClick={save}>保存为已持有</button></div>; }
function HeldPosition({item,status,error,update,save,openSell}:{item:PositionPlanItemRecord;status?:HoldingStatus;error?:string;update:(changes:Record<string,unknown>)=>void;save:(changes:Record<string,unknown>)=>void;openSell:()=>void}) {
  const heldChanges = () => ({ averageCost:item.averageCost, actualShares:item.actualShares, purchaseDate:item.purchaseDate, initialStopPrice:item.initialStopPrice });
  return <div className={styles.heldBody}><div className={styles.heldFields}><SmallInput label="平均买入成本" value={item.averageCost ?? 0} step="0.001" onChange={(value)=>update({averageCost:value})} onBlur={()=>save(heldChanges())}/><SmallInput label="实际持有股数" value={item.actualShares ?? 0} step="1" onChange={(value)=>update({actualShares:value})} onBlur={()=>save(heldChanges())}/><DateInput label="买入日期" value={item.purchaseDate ?? ""} onChange={(value)=>{update({purchaseDate:value});save({...heldChanges(),purchaseDate:value});}}/><SmallInput label="初始止损价" value={item.initialStopPrice} onChange={(value)=>update({initialStopPrice:value})} onBlur={()=>save(heldChanges())}/></div>{item.actualShares && item.actualShares % 100 !== 0 ? <p className={styles.nonBlockingNote}>股数不是 100 的整数倍，已按实际持仓保存。</p> : null}{error ? <p className={styles.statusError}>{error}。输入已保留，动态卖出结论暂停。</p> : !status ? <p className={styles.statusLoading}>正在回放买入日起的日线状态并获取盘中价格…</p> : <><dl className={styles.holdingMetrics}><div><dt>{status.priceSource === "live" ? "盘中价" : "最新完整收盘"}</dt><dd>¥{status.currentPrice.toFixed(2)}<small>{status.quoteDate}{status.quoteTime ? ` ${status.quoteTime}` : ""} · {status.quoteProvider}</small></dd></div><div><dt>浮动盈亏</dt><dd className={status.profit >= 0 ? styles.profitPositive : styles.profitNegative}>{currency(status.profit)}<small>{(status.returnRate*100).toFixed(2)}% · 未计费用</small></dd></div><div><dt>当前 R 倍数</dt><dd>{status.rMultiple.toFixed(2)}R<small>1R ¥{status.oneRPrice.toFixed(2)} · 2R ¥{status.twoRPrice.toFixed(2)}</small></dd></div><div><dt>策略基准收盘</dt><dd>¥{status.strategyClose.toFixed(2)}<small>{status.strategyDate} · 持有 {status.holdingDays} 日</small></dd></div></dl><div className={`${styles.exitPanel} ${status.exitEvent || status.pendingExitReason ? styles.exitTriggered : ""}`}><div><span>当前阶段</span><strong>{status.stage}</strong></div><div><span>当前有效止损</span><strong>¥{status.activeStop.toFixed(2)}</strong><small>{status.lockedProfit > 0 ? `已锁定 ${currency(status.lockedProfit)}` : `剩余保护空间 ${currency(status.protectedRisk)}`}</small></div><div><span>当前移动止盈价</span><strong>{status.trailingTakeProfitPrice === null ? "尚未启用" : `¥${status.trailingTakeProfitPrice.toFixed(2)}`}</strong><small>{status.trailingTakeProfitPrice === null ? `收盘达到 2R（¥${status.twoRPrice.toFixed(2)}）后启用` : `距盘中价 ${Math.max(0, (status.currentPrice-status.trailingTakeProfitPrice)/status.currentPrice*100).toFixed(2)}% · ${status.trailingStopUpdatedAt ?? status.strategyDate} 更新`}</small></div><div className={styles.exitMessage}><span>{status.exitEvent || status.pendingExitReason ? "退出状态" : "下一观察项"}</span><strong>{status.exitEvent ? `${status.exitEvent.reason}：${status.exitEvent.date === status.quoteDate ? status.exitEvent.timing === "next-open" ? "今日开盘执行提示" : "今日已触发" : `${status.exitEvent.date} 已触发`}` : status.nextObservation}</strong>{status.hitTwoR && status.dayLow !== null ? <small>今日最低 ¥{status.dayLow.toFixed(2)} / 止盈价 ¥{status.activeStop.toFixed(2)}</small> : null}</div></div>{!status.available ? <p className={styles.statusError}>{status.reason}</p> : null}</>}<button className={styles.sellButton} onClick={openSell}>记录卖出</button></div>;
}

function SellForm({draft,setDraft,cancel,save}:{draft:SellDraft;setDraft:(value:SellDraft)=>void;cancel:()=>void;save:()=>void}) {
  return <div className={styles.sellForm}><div className={styles.sellFields}><SmallInput label="实际卖出价" value={draft.exitPrice} step="0.001" onChange={(value)=>setDraft({...draft,exitPrice:value})}/><DateInput label="卖出日期" value={draft.exitDate} onChange={(value)=>setDraft({...draft,exitDate:value})}/><label className={styles.smallField}><span>退出原因</span><input maxLength={80} onChange={(event)=>setDraft({...draft,exitReason:event.target.value})} type="text" value={draft.exitReason}/></label></div><label className={styles.reviewField}><span>复盘记录</span><textarea maxLength={1000} onChange={(event)=>setDraft({...draft,reviewNote:event.target.value})} placeholder="记录执行偏差、市场环境和下次要坚持或改进的事项" rows={3} value={draft.reviewNote}/></label><div className={styles.sellActions}><button className={styles.secondaryButton} disabled={draft.saving} onClick={cancel}>取消</button><button className={styles.primaryButton} disabled={draft.saving} onClick={save}>{draft.saving ? "正在计算基准…" : "确认卖出并归档"}</button></div></div>;
}

function HistoryLedger({trades,performance,remove}:{trades:PositionTradeRecord[];performance:ReturnType<typeof calculatePositionPerformance>;remove:(id:string)=>void}) {
  const metrics = [
    ["累计净收益", currency(performance.totalNetProfit), percent(performance.cumulativeReturn)],
    ["沪深300同期", percent(performance.benchmarkCumulativeReturn), `超额 ${percent(performance.cumulativeExcessReturn)}`],
    ["盈利胜率", percent(performance.winRate), `${performance.tradeCount} 笔已完成`],
    ["跑赢基准", percent(performance.pathSuccessRate), "单笔路径成功率"],
    ["平均持有", performance.averageHoldingDays === null ? "—" : `${performance.averageHoldingDays.toFixed(1)} 日`, `平均 ${ratio(performance.averageR)}R`],
    ["超额 Sharpe", ratio(performance.excessSharpe), `策略 ${ratio(performance.sharpe)}`],
    ["盈亏比", ratio(performance.profitLossRatio), `盈利因子 ${ratio(performance.profitFactor)}`],
    ["最大回撤", percent(performance.maxDrawdown), "按已归档交易顺序"],
  ];
  return <section className={styles.historySection}><header className={styles.priorityHeader}><div><h2>卖出历史与路径复盘</h2><p>每笔交易保留原始信号、实际成交、费用、R 倍数和沪深300同期路径。</p></div><strong>{trades.length} 笔</strong></header>{!trades.length ? <div className={styles.historyEmpty}><h3>还没有已完成交易</h3><p>在已持有仓位中记录卖出后，这里会生成可查询、可复盘的历史账本。</p></div> : <><dl className={styles.performanceGrid}>{metrics.map(([label,value,note])=><div key={label}><dt>{label}</dt><dd>{value}</dd><small>{note}</small></div>)}</dl>{trades.length < 5 ? <p className={styles.sampleNote}>当前仅 {trades.length} 笔样本。胜率、Sharpe、盈亏比与回撤只用于核对执行路径，至少积累 20 笔后再判断稳定性。</p> : null}<div className={styles.historyList}>{trades.map((trade)=><article className={styles.historyRow} key={trade.id}><div className={styles.historyIdentity}><p>{trade.purchaseDate} → {trade.exitDate} · {trade.holdingDays} 个交易日</p><h3>{trade.name} <small>{trade.symbol}</small></h3><span>{trade.exitReason} · 信号分 {trade.score}</span></div><dl className={styles.historyOutcome}><div><dt>净收益</dt><dd className={trade.netProfit >= 0 ? styles.profitPositive : styles.profitNegative}>{currency(trade.netProfit)}<small>{percent(trade.returnRate)} · {trade.rMultiple.toFixed(2)}R</small></dd></div><div><dt>沪深300</dt><dd>{percent(trade.benchmarkReturn)}<small>超额 {percent(trade.excessReturn)}</small></dd></div><div><dt>成交路径</dt><dd>¥{trade.averageCost.toFixed(3)} → ¥{trade.exitPrice.toFixed(3)}<small>{trade.actualShares} 股 · 已计费用</small></dd></div></dl><div className={styles.reviewCopy}><strong>复盘</strong><p>{trade.reviewNote || "未填写复盘记录"}</p></div><button aria-label={`删除 ${trade.name} 的历史记录`} className={styles.historyDelete} onClick={()=>remove(trade.id)}>删除</button></article>)}</div></> }</section>;
}
function NumberInput({label,value,onChange,onBlur}:{label:string;value:number;onChange:(value:number)=>void;onBlur:()=>void}) { return <label className={styles.formCell}><span className={styles.fieldLabel}>{label}</span><span className={styles.numberLine}>¥<input min="0" onBlur={onBlur} onChange={(event)=>onChange(Number(event.target.value))} type="number" value={value}/></span></label>; }
function SmallInput({label,value,onChange,onBlur,step="0.01"}:{label:string;value:number;onChange:(value:number)=>void;onBlur?:()=>void;step?:string}) { return <label className={styles.smallField}><span>{label}</span><input min="0" onBlur={onBlur} onChange={(event)=>onChange(Number(event.target.value))} step={step} type="number" value={value}/></label>; }
function DateInput({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) { return <label className={styles.smallField}><span>{label}</span><input onChange={(event)=>onChange(event.target.value)} type="date" value={value}/></label>; }
