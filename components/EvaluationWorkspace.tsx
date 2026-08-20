"use client";

import { useMemo, useState } from "react";

import {
  formatMoney,
  getScorePositionRule,
  minimumStrengthScore,
  minimumTechnicalScore,
  modelVersion,
  riskBufferRate,
  type EvaluationStatus,
  type MarketDataSnapshot,
  type ScoreModule,
} from "@/lib/evaluation";

type Answers = {
  event: "none" | "exists" | "uncertain" | "";
  emotion: "calm" | "chasing" | "uncertain" | "";
};

const initialAnswers: Answers = {
  event: "",
  emotion: "",
};

const initialAccountEquity = 100000;

const cancellationConditions = [
  "高开超过2%",
  "实际入场后止损距离超过8%",
  "出现新的事件风险",
  "组合风险额度不足",
  "无法正常成交",
];

function StatusBadge({ status, children }: { status: EvaluationStatus; children: React.ReactNode }) {
  const styles = {
    pass: "border-[#A8DCCF] bg-[#ECF8F4] text-[#237A65]",
    fail: "border-[#E8B5BD] bg-[#FFF1F3] text-[#B44D5C]",
    pending: "border-[#CBD8DE] bg-[#F2F6F8] text-[#647985]",
  }[status];

  return (
    <span className={`inline-flex min-h-6 items-center gap-1 rounded-full border px-2 text-[12px] font-medium ${styles}`}>
      <span aria-hidden="true">{status === "pass" ? "✓" : status === "fail" ? "×" : "?"}</span>
      {children}
    </span>
  );
}

function SectionHeading({ index, title, description }: { index: string; title: string; description?: string }) {
  return (
    <div className="flex items-start gap-4 border-b border-[#E3EFF4] pb-4">
      <span className="pt-1 font-mono text-[11px] text-[#718C98]">{index}</span>
      <div>
        <h2 className="text-[20px] font-semibold leading-7 tracking-[-0.01em] text-[#102C3A]">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-[22px] text-[#476775]">{description}</p> : null}
      </div>
    </div>
  );
}

function Question({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string; consequence: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="border-0 p-0">
      <legend className="text-sm font-semibold leading-[22px] text-[#102C3A]">{legend}</legend>
      <div className="mt-3 divide-y divide-[#E3EFF4] border-y border-[#E3EFF4]">
        {options.map((option) => (
          <label
            className="flex min-h-14 cursor-pointer items-center gap-3 px-1 py-3 outline-none transition-colors hover:bg-[#F1F7FA]"
            key={option.value}
          >
            <input
              checked={value === option.value}
              className="size-4 accent-[#3B91AE]"
              name={name}
              onChange={() => onChange(option.value)}
              type="radio"
              value={option.value}
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-[#102C3A]">{option.label}</span>
              <span className="mt-0.5 block text-[12px] leading-[18px] text-[#718C98]">{option.consequence}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function NumberField({
  label,
  value,
  unit,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[13px] font-[550] leading-[18px] text-[#102C3A]">{label}</span>
      <span className="mt-2 flex h-12 overflow-hidden rounded-[6px] border border-[#C9DEE8] bg-white focus-within:border-[#3B91AE] focus-within:ring-2 focus-within:ring-[#69D2E7]/25">
        <input
          className="min-w-0 flex-1 bg-transparent px-3 text-sm font-medium text-[#102C3A] outline-none disabled:bg-[#F1F7FA] disabled:text-[#647985] tabular-nums"
          disabled={disabled}
          min="0"
          onChange={(event) => onChange(Number(event.target.value))}
          step="0.01"
          type="number"
          value={value}
        />
        <span className="grid min-w-11 place-items-center border-l border-[#E3EFF4] bg-[#F8FBFD] px-3 text-[12px] text-[#718C98]">
          {unit}
        </span>
      </span>
    </label>
  );
}

export default function EvaluationWorkspace({ snapshot }: { snapshot: MarketDataSnapshot }) {
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [accountEquity, setAccountEquity] = useState(initialAccountEquity);
  const [currentOpenRisk, setCurrentOpenRisk] = useState(0);
  const [currentStockValue, setCurrentStockValue] = useState(0);
  const [currentIndustryValue, setCurrentIndustryValue] = useState(0);
  const [threeConsecutiveStops, setThreeConsecutiveStops] = useState(false);

  const result = useMemo(() => {
    const modules: ScoreModule[] = snapshot.automaticModules;

    const earned = modules.reduce((sum, module) => sum + module.earned, 0);
    const determined = modules.reduce((sum, module) => sum + module.determined, 0);
    const pending = 100 - determined;
    const technicalScore = modules
      .filter((module) => ["trend", "pullback", "strength"].includes(module.id))
      .reduce((sum, module) => sum + module.earned, 0);
    const strengthScore = modules.find((module) => module.id === "strength")?.earned ?? 0;
    const technicalGatePassed = technicalScore >= minimumTechnicalScore;
    const strengthGatePassed = strengthScore >= minimumStrengthScore;
    const triggerGatePassed = snapshot.entryTriggerPassed;
    const eventFail = answers.event === "exists";
    const emotionFail = answers.emotion === "chasing";
    const automaticFail = snapshot.automaticFilters.some((filter) => filter.status === "fail");
    const automaticPending = snapshot.automaticFilters.some((filter) => filter.status === "pending");
    const userPending = !answers.event || answers.event === "uncertain" || !answers.emotion || answers.emotion === "uncertain";
    const hardStatus: EvaluationStatus = eventFail || emotionFail || automaticFail
      ? "fail"
      : userPending || automaticPending
        ? "pending"
        : "pass";
    const positionRule = getScorePositionRule(earned);
    const signalGatePassed = technicalGatePassed && strengthGatePassed && triggerGatePassed;
    const candidateAvailable = !eventFail && !emotionFail && !automaticFail && !userPending && Boolean(positionRule) && signalGatePassed;
    const perShareRisk = snapshot.plannedEntryPrice - snapshot.initialStopPrice;
    const scoreRiskBudget = candidateAvailable && positionRule
      ? accountEquity * positionRule.riskBudgetRate * (threeConsecutiveStops ? 0.5 : 1)
      : 0;
    const availablePortfolioRisk = Math.max(0, accountEquity * 0.02 - currentOpenRisk);
    const allowedRisk = Math.min(scoreRiskBudget, availablePortfolioRisk) * (1 - riskBufferRate);
    const riskLimitedShares = perShareRisk > 0 ? Math.floor(allowedRisk / perShareRisk / 100) * 100 : 0;
    const singleStockCapacity = Math.max(0, accountEquity * 0.15 - currentStockValue);
    const industryCapacity = Math.max(0, accountEquity * 0.3 - currentIndustryValue);
    const valueLimitedShares = snapshot.plannedEntryPrice > 0
      ? Math.floor(Math.min(singleStockCapacity, industryCapacity) / snapshot.plannedEntryPrice / 100) * 100
      : 0;
    const shares = Math.max(0, Math.min(riskLimitedShares, valueLimitedShares));
    const allocationRate = accountEquity > 0 ? shares * snapshot.plannedEntryPrice / accountEquity : 0;
    const plannedLoss = shares * perShareRisk;
    const capacityPassed = shares >= 100;
    const outputsAvailable = candidateAvailable && capacityPassed;

    const conclusion = hardStatus === "fail"
      ? "不入场"
      : userPending
        ? "待补充"
        : earned < 70
          ? "不交易"
          : !technicalGatePassed
            ? "候选观察"
            : !strengthGatePassed || !triggerGatePassed
              ? "等待转强"
              : !capacityPassed
                ? "风险额度不足"
                : automaticPending
                  ? "候选"
                  : earned < 80
                    ? "允许试仓"
                    : earned < 90
                      ? "标准交易"
                      : "高匹配";

    return {
      modules,
      earned,
      determined,
      pending,
      hardStatus,
      conclusion,
      positionRule,
      allocationRate,
      stopPrice: outputsAvailable ? snapshot.initialStopPrice : null,
      outputsAvailable,
      technicalScore,
      strengthScore,
      technicalGatePassed,
      strengthGatePassed,
      triggerGatePassed,
      allowedRisk,
      availablePortfolioRisk,
      shares,
      plannedLoss,
      perShareRisk,
    };
  }, [answers, accountEquity, currentIndustryValue, currentOpenRisk, currentStockValue, snapshot, threeConsecutiveStops]);

  function updateAnswer<Key extends keyof Answers>(key: Key, value: Answers[Key]) {
    setAnswers((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="mt-10">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-8">
          <div className="border-y border-[#C9DEE8] bg-[#F1F7FA] px-4 py-3 text-[13px] leading-5 text-[#476775] sm:px-5">
            行情来源：{snapshot.provider} · 拉取时间 {new Date(snapshot.fetchedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} · {snapshot.adjustment}日线。数据仅用于模型评估，请与交易所或券商行情复核。
          </div>

          <section className="mt-8 border-b border-[#C9DEE8] pb-8" aria-labelledby="stock-summary-title">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="text-[12px] leading-[18px] text-[#718C98]">{snapshot.instrumentType}摘要 · {snapshot.stage}</p>
            <h2 className="mt-2 text-[28px] font-semibold leading-9 tracking-[-0.02em] text-[#102C3A]" id="stock-summary-title">
              {snapshot.name}
              <span className="ml-3 align-middle font-mono text-sm font-medium tracking-normal text-[#476775]">{snapshot.symbol}</span>
            </h2>
            <p className="mt-3 text-sm leading-[22px] text-[#476775]">
              {snapshot.instrumentType} · {snapshot.market} · 数据日 {snapshot.dataDate} · {snapshot.adjustment} · {snapshot.records}日
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-6 md:text-right">
            <div>
              <dt className="text-[12px] text-[#718C98]">开盘</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">¥{formatMoney(snapshot.open)}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-[#718C98]">收盘</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">¥{formatMoney(snapshot.close)}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-[#718C98]">完整度</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{snapshot.completeness}%</dd>
            </div>
          </dl>
        </div>
          </section>

          <div className="mt-12 space-y-14">
          <section id="hard-filters" aria-labelledby="hard-filters-title">
            <SectionHeading index="01" title="硬性过滤" description="任何明确失败都不能被评分覆盖。" />
            <div className="mt-6 grid gap-8 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-[#102C3A]">自动检查</h3>
                <div className="mt-3 divide-y divide-[#E3EFF4] border-y border-[#E3EFF4]">
                  {snapshot.automaticFilters.map((filter) => (
                    <div className="flex min-h-14 items-center justify-between gap-4 py-3" key={filter.label}>
                      <div>
                        <p className="text-sm font-medium text-[#102C3A]">{filter.label}</p>
                        <p className="mt-0.5 text-[12px] text-[#718C98]">{filter.detail}</p>
                      </div>
                      <StatusBadge status={filter.status}>
                        {filter.status === "pass" ? "通过" : filter.status === "fail" ? "失败" : "待数据"}
                      </StatusBadge>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-10">
                <Question
                  legend="未来5个交易日是否有财报、解禁或重大事件？"
                  name="event"
                  onChange={(value) => updateAnswer("event", value as Answers["event"])}
                  options={[
                    { value: "none", label: "没有", consequence: "继续候选评估" },
                    { value: "exists", label: "存在风险事件", consequence: "本次不入场" },
                    { value: "uncertain", label: "不确定", consequence: "保持待补充，不生成可执行结论" },
                  ]}
                  value={answers.event}
                />
                <Question
                  legend="当前交易动机最接近哪一种？"
                  name="emotion"
                  onChange={(value) => updateAnswer("emotion", value as Answers["emotion"])}
                  options={[
                    { value: "calm", label: "按计划执行", consequence: "硬性条件通过" },
                    { value: "chasing", label: "担心错过或急于回本", consequence: "本次不入场" },
                    { value: "uncertain", label: "不确定", consequence: "保持待补充，不生成可执行结论" },
                  ]}
                  value={answers.emotion}
                />
              </div>
            </div>
          </section>

          <section id="score-details" aria-labelledby="score-details-title">
            <SectionHeading index="02" title="评分明细" description="技术指标占90分，市场环境由中证全指自动计算10分。" />
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className={`border px-4 py-3 ${result.technicalGatePassed ? "border-[#A8DCCF] bg-[#ECF8F4]" : "border-[#E7D29B] bg-[#FFF8E8]"}`}>
                <p className="text-[12px] text-[#718C98]">技术面门槛</p>
                <p className="mt-1 text-sm font-semibold tabular-nums">{result.technicalScore} / 90 · 至少 {minimumTechnicalScore}</p>
              </div>
              <div className={`border px-4 py-3 ${result.strengthGatePassed ? "border-[#A8DCCF] bg-[#ECF8F4]" : "border-[#E7D29B] bg-[#FFF8E8]"}`}>
                <p className="text-[12px] text-[#718C98]">重新转强门槛</p>
                <p className="mt-1 text-sm font-semibold tabular-nums">{result.strengthScore} / 35 · 至少 {minimumStrengthScore}</p>
              </div>
              <div className={`border px-4 py-3 ${result.triggerGatePassed ? "border-[#A8DCCF] bg-[#ECF8F4]" : "border-[#E7D29B] bg-[#FFF8E8]"}`}>
                <p className="text-[12px] text-[#718C98]">关键触发器</p>
                <p className="mt-1 text-sm font-semibold">{result.triggerGatePassed ? "已触发" : "尚未触发"}</p>
              </div>
            </div>
            <div className="mt-6 divide-y divide-[#C9DEE8] border-y border-[#C9DEE8]">
              {result.modules.map((module) => (
                <details className="group py-5" key={module.id}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 outline-none">
                    <div>
                      <h3 className="text-sm font-semibold text-[#102C3A]">{module.label}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-[18px]">
                        <span className="font-medium text-[#237A65] tabular-nums">✓ 通过 {module.passed}</span>
                        <span className="font-medium text-[#B44D5C] tabular-nums">× 不通过 {module.failed}</span>
                        <span className="text-[#647985] tabular-nums">? 未知 {module.pending}</span>
                        <span className="text-[#718C98]">· {module.source}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-lg font-semibold tabular-nums">{module.earned} / {module.total}</span>
                      <span aria-hidden="true" className="text-[#718C98] transition-transform group-open:rotate-45">＋</span>
                    </div>
                  </summary>
                  <div className="mt-4 grid gap-3 border-l-2 border-[#E3EFF4] pl-4 text-[13px] leading-5 text-[#476775] sm:grid-cols-2">
                    {module.details?.length ? (
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {module.details.map((detail) => (
                          <span className="whitespace-nowrap" key={detail.label}>
                            <span className="text-[#476775]">{detail.label} </span>
                            <strong
                              className={`font-semibold tabular-nums ${detail.status === "pass" ? "text-[#237A65]" : detail.status === "fail" ? "text-[#B44D5C]" : "text-[#647985]"}`}
                            >
                              {detail.value}
                            </strong>
                          </span>
                        ))}
                      </div>
                    ) : <p>{module.reason}</p>}
                    <p>数据日期：{snapshot.dataDate} · 已判定 {module.determined} / {module.total} 分</p>
                  </div>
                </details>
              ))}
            </div>
          </section>

          </div>
        </div>

        <aside className="lg:col-span-4 lg:-mt-32 lg:self-start" aria-label="当前评估结果">
          <div className={`border-t-2 bg-white p-5 shadow-[0_8px_24px_rgba(16,44,58,0.08)] lg:sticky lg:top-6 ${result.hardStatus === "fail" ? "border-t-[#B44D5C]" : result.hardStatus === "pass" ? "border-t-[#237A65]" : "border-t-[#647985]"}`}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[12px] leading-[18px] text-[#718C98]">当前结论</p>
                <h2 className="mt-2 text-[24px] font-semibold leading-8 tracking-[-0.015em] text-[#102C3A]">{result.conclusion}</h2>
              </div>
              <StatusBadge status={result.hardStatus}>
                {result.hardStatus === "pass" ? "硬性通过" : result.hardStatus === "fail" ? "硬性失败" : "待确认"}
              </StatusBadge>
            </div>

            <div className="mt-6 flex items-end justify-between gap-4 border-b border-[#E3EFF4] pb-5">
              <div>
                <p className="text-[12px] text-[#718C98]">候选评分</p>
                <p className="mt-2 text-[38px] font-[650] leading-10 tracking-[-0.02em] tabular-nums">
                  {result.earned}<span className="ml-2 text-sm font-medium tracking-normal text-[#718C98]">/ {result.determined}</span>
                </p>
              </div>
              <p className="pb-1 text-right text-[12px] leading-[18px] text-[#665FB5]">+{result.pending}<br />待确认</p>
            </div>

            <div className="border-b border-[#E3EFF4] py-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <NumberField label="账户净值" onChange={setAccountEquity} unit="元" value={accountEquity} />
                <NumberField label="当前未平仓初始风险" onChange={setCurrentOpenRisk} unit="元" value={currentOpenRisk} />
                <NumberField label="当前该股持仓市值" onChange={setCurrentStockValue} unit="元" value={currentStockValue} />
                <NumberField label="当前该行业持仓市值" onChange={setCurrentIndustryValue} unit="元" value={currentIndustryValue} />
              </div>
              <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 border-y border-[#E3EFF4] py-2 text-[13px] font-medium text-[#102C3A]">
                <input
                  checked={threeConsecutiveStops}
                  className="size-4 accent-[#3B91AE]"
                  onChange={(event) => setThreeConsecutiveStops(event.target.checked)}
                  type="checkbox"
                />
                最近连续3笔完整止损（单笔风险减半）
              </label>
              <p className="mt-2 text-[11px] leading-[17px] text-[#718C98]">账户数据只参与当前浏览器内的即时计算，不会上传或保存。</p>
            </div>

            <dl className="grid grid-cols-2 gap-5 py-4">
              <div>
                <dt className="text-[12px] text-[#718C98]">计划买入股数</dt>
                <dd className="mt-2 text-[28px] font-semibold tabular-nums">
                  {result.outputsAvailable ? `${result.shares}股` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-[#718C98]">计划最大亏损</dt>
                <dd className="mt-2 text-[28px] font-semibold tabular-nums">
                  {result.outputsAvailable ? `¥${formatMoney(result.plannedLoss)}` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-[#718C98]">结构止损价格</dt>
                <dd className="mt-2 text-lg font-semibold tabular-nums">
                  {result.stopPrice === null ? "—" : `¥${formatMoney(result.stopPrice)}`}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-[#718C98]">仓位占账户</dt>
                <dd className="mt-2 text-lg font-semibold tabular-nums">
                  {result.outputsAvailable ? `${(result.allocationRate * 100).toFixed(2)}%` : "—"}
                </dd>
              </div>
            </dl>

            <p className="mb-5 text-[11px] leading-[17px] text-[#718C98]">
              70–79分风险0.25%；80–89分风险0.50%；90分以上风险0.75%。已预留10%风险缓冲，单股市值封顶15%。
            </p>

            <div className="mb-5 border-y border-[#E3EFF4] py-3 text-[12px] leading-[18px] text-[#476775]">
              <p>计划入场 ¥{formatMoney(snapshot.plannedEntryPrice)} · 每股风险 ¥{formatMoney(result.perShareRisk)}</p>
              <p className="mt-1">风险预算 ¥{formatMoney(result.allowedRisk)} · 基准 {snapshot.benchmark}</p>
            </div>

            <details className="group border-b border-[#E7D29B] bg-[#FFF8E8] px-3 py-3">
              <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] font-semibold text-[#9A6B18]">
                次日取消条件
                <span aria-hidden="true" className="transition-transform group-open:rotate-45">＋</span>
              </summary>
              <ul className="mt-2 space-y-1.5 text-[12px] leading-[18px] text-[#76591F]">
                {cancellationConditions.map((condition) => <li key={condition}>— {condition}</li>)}
              </ul>
            </details>

            <p className="mt-5 text-[11px] leading-[17px] text-[#718C98]">评分表示与模型的匹配程度，不代表上涨概率或投资建议。</p>
            <p className="mt-2 text-[11px] leading-[17px] text-[#718C98]">模型版本 {modelVersion}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
