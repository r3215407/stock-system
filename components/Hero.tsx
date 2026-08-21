import Image from "next/image";

import BrandLogo from "@/components/BrandLogo";

export type HeroProps = {
  /** Destination that receives the six-digit stock code as `symbol`. */
  formAction?: string;
  rulesHref?: string;
  aboutHref?: string;
  className?: string;
};

const scoreRows = [
  ["趋势质量", "24 / 30"],
  ["回调质量", "19 / 25"],
  ["重新转强", "29 / 35"],
] as const;

function ArrowRightIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 20 20"
    >
      <path
        d="M4.5 10h11m-4-4 4 4-4 4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" className="size-3.5" fill="none" viewBox="0 0 16 16">
      <path
        d="m4 8.2 2.45 2.4L12 5.4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ResultPreview() {
  return (
    <div
      aria-label="示例评分结果"
      className="absolute inset-x-4 bottom-0 overflow-hidden rounded-[20px] border border-[#102C3A]/15 bg-white/95 shadow-[0_24px_60px_-28px_rgba(20,30,80,0.32)] backdrop-blur-sm sm:inset-x-8 sm:bottom-7 lg:-left-12 lg:right-24 lg:bottom-10 lg:rotate-[1deg] xl:right-36"
      role="img"
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[12px] font-medium leading-[18px] text-[#718C98]">
              趋势回调转强评估
            </p>
            <div className="mt-2 flex items-baseline gap-2 tabular-nums">
              <span className="text-[32px] font-[650] leading-9 tracking-[-0.02em] text-[#102C3A] sm:text-[40px] sm:leading-11">
                82
              </span>
              <span className="text-sm font-medium text-[#718C98]">/ 100</span>
            </div>
          </div>

          <div className="text-right">
            <span className="inline-flex rounded-full border border-[#C9C4EF] bg-[#F3F1FF] px-2.5 py-1 text-[12px] font-medium leading-4 text-[#665FB5]">
              示例结果
            </span>
            <p className="mt-2 text-[12px] font-medium leading-[18px] text-[#665FB5]">
              执行待确认
            </p>
          </div>
        </div>

        <div className="mt-4 flex h-1 overflow-hidden bg-[#E3EFF4]" aria-hidden="true">
          <span className="w-[82%] bg-[#5661D9]" />
        </div>

        <div className="mt-4 flex items-center justify-between border-b border-[#E3EFF4] pb-4">
          <span className="text-[13px] font-[550] leading-[18px] text-[#476775]">
            硬性过滤
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#A8DCCF] bg-[#ECF8F4] px-2.5 py-1 text-[12px] font-medium leading-4 text-[#237A65]">
            <CheckIcon />
            通过
          </span>
        </div>

        <dl className="mt-4 hidden grid-cols-3 gap-4 sm:grid">
          {scoreRows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[12px] leading-[18px] text-[#718C98]">{label}</dt>
              <dd className="mt-1 text-sm font-semibold leading-5 text-[#102C3A] tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <dl className="mt-5 grid grid-cols-2 gap-6 border-t border-[#E3EFF4] pt-4">
          <div>
            <dt className="text-[11px] leading-4 text-[#718C98] sm:text-[12px] sm:leading-[18px]">
              计划最大风险
            </dt>
            <dd className="mt-1 whitespace-nowrap text-[13px] font-semibold leading-5 text-[#102C3A] tabular-nums sm:text-sm">
              ¥450
            </dd>
          </div>
          <div>
            <dt className="text-[11px] leading-4 text-[#718C98] sm:text-[12px] sm:leading-[18px]">
              计划仓位
            </dt>
            <dd className="mt-1 whitespace-nowrap text-[13px] font-semibold leading-5 text-[#102C3A] tabular-nums sm:text-sm">
              500股
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

export default function Hero({
  formAction = "/evaluate",
  rulesHref = "#rules",
  aboutHref = "#about",
  className,
}: HeroProps) {
  return (
    <section
      className={[
        "relative isolate min-h-screen overflow-hidden font-sans text-[#102C3A]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-5 lg:px-8">
        <header className="fixed inset-x-4 top-4 z-50 mx-auto flex h-14 max-w-[720px] items-center justify-between rounded-full border border-[#102C3A]/15 bg-[#F7F8F6]/80 px-4 shadow-[0_8px_30px_-12px_rgba(20,30,80,0.18)] backdrop-blur-xl sm:px-5">
          <BrandLogo />

          <nav aria-label="Hero 导航" className="flex items-center gap-1 sm:gap-3">
            <a
              className="inline-flex min-h-10 items-center rounded-full px-3 text-[13px] font-[550] text-[#476775] outline-none transition-colors hover:bg-white/70 hover:text-[#102C3A] focus-visible:ring-2 focus-visible:ring-[#5661D9]"
              href={rulesHref}
            >
              规则说明
            </a>
            <a
              className="hidden min-h-10 items-center rounded-full bg-[#102C3A] px-4 text-[13px] font-[550] text-white outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[#5661D9] focus-visible:ring-offset-2 sm:inline-flex"
              href={aboutHref}
            >
              了解模型
            </a>
          </nav>
        </header>

        <div className="grid min-h-screen items-start gap-16 pb-20 pt-36 md:pb-24 md:pt-44 lg:grid-cols-12 lg:gap-0 lg:pb-28 lg:pt-44 xl:pt-48">
          <div className="max-w-[680px] lg:col-span-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#102C3A]/15 bg-white/65 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[#476775]">
              <span className="size-1.5 rounded-full bg-[#237A65]" />
              Model 0.4 · Daily signal
            </div>
            <h1 className="mt-8 max-w-[680px] text-[44px] font-[600] leading-[0.98] tracking-[-0.045em] text-[#102C3A] min-[390px]:text-[46px] md:text-[64px] lg:text-[68px] xl:text-[76px]">
              <span className="block">在买入之前，</span>
              <span className="mt-2 block">
                <span className="block md:inline">先把<em className="text-[#5661D9]">信号</em></span>
                <span className="block md:inline"><em className="text-[#5661D9]">和风险</em><span className="block md:inline">算清楚。</span></span>
              </span>
            </h1>

            <p className="mt-7 max-w-[570px] text-base leading-[27px] text-[#476775] md:text-[18px] md:leading-[29px]">
              输入一只A股或场内基金代码，自动检查趋势、回调与转强信号，再结合硬性过滤和结构止损，给出评分与风险仓位。
            </p>

            <form action={formAction} className="mt-11 max-w-[590px]" method="get">
              <label
                className="block text-[13px] font-[550] leading-[18px] text-[#102C3A]"
                htmlFor="hero-stock-code"
              >
                A股 / 场内基金代码
              </label>

              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_112px] gap-2 rounded-[22px] border border-[#102C3A]/15 bg-white/85 p-1.5 shadow-[0_12px_32px_-18px_rgba(20,30,80,0.28)] backdrop-blur-sm sm:flex sm:flex-row">
                <input
                  aria-describedby="hero-stock-code-help hero-stock-code-disclaimer"
                  autoComplete="off"
                  className="h-12 min-w-0 flex-1 rounded-2xl border-0 bg-transparent px-3 text-base font-medium leading-6 text-[#102C3A] outline-none placeholder:font-normal placeholder:text-[#718C98] focus:bg-white/70 invalid:not-placeholder-shown:text-[#B44D5C] tabular-nums sm:px-4"
                  id="hero-stock-code"
                  inputMode="numeric"
                  maxLength={6}
                  minLength={6}
                  name="symbol"
                  pattern="[0-9]{6}"
                  placeholder="例如 600519"
                  required
                  title="请输入六位A股或场内基金代码，例如 600519、159915"
                  type="text"
                />
                <button
                  className="inline-flex h-12 min-w-0 items-center justify-center gap-1.5 rounded-full bg-[#102C3A] px-3 text-[14px] font-semibold leading-[22px] text-white outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[#5661D9] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#9FB3BC] sm:min-w-[126px] sm:gap-2 sm:px-6 sm:text-[15px]"
                  type="submit"
                >
                  开始评估
                  <ArrowRightIcon className="hidden size-4 sm:block" />
                </button>
              </div>

              <p id="hero-stock-code-help" className="mt-2.5 text-[12px] leading-[18px] text-[#718C98]">
                使用最新完整日线数据；盘中执行价格将单独确认。
              </p>
            </form>

            <a
              className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-sm font-[550] leading-[22px] text-[#1E5A70] outline-none transition-colors hover:text-[#5661D9] focus-visible:rounded-full focus-visible:ring-2 focus-visible:ring-[#5661D9] focus-visible:ring-offset-2"
              href={rulesHref}
            >
              查看评分规则
              <ArrowRightIcon className="size-4" />
            </a>

            <p
              id="hero-stock-code-disclaimer"
              className="mt-12 max-w-[480px] text-[12px] leading-[18px] text-[#718C98]"
            >
              评分表示与模型的匹配程度，不代表上涨概率或投资建议。
            </p>
          </div>

          <div className="relative mx-auto w-full max-w-[560px] lg:col-span-6 lg:ml-10 lg:w-[calc(100%+4rem)] lg:max-w-none xl:ml-14 xl:w-[calc(100%+6rem)]">
            <div className="relative hidden aspect-square overflow-visible md:block">
              <Image
                alt=""
                className="object-cover"
                fill
                priority
                sizes="(min-width: 1280px) 520px, (min-width: 1024px) 42vw, (min-width: 768px) 560px, 100vw"
                src="/assets/glacier-signal-desktop.png"
              />
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-b from-white/5 via-transparent to-[#F7F8F6]/15"
              />
              <ResultPreview />
            </div>

            <div className="relative mx-auto h-[430px] w-full max-w-[360px] overflow-hidden md:hidden">
              <Image
                alt=""
                className="object-cover object-center"
                fill
                priority
                sizes="(max-width: 767px) min(100vw - 32px, 360px)"
                src="/assets/glacier-signal-mobile.png"
              />
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-b from-white/5 via-transparent to-[#F7F8F6]/15"
              />
              <ResultPreview />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
