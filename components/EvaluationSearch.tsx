import ticketStyles from "@/app/evaluate/evaluate.module.css";

type EvaluationSearchProps = {
  defaultValue?: string;
  error?: string;
  compact?: boolean;
  variant?: "default" | "ticket";
};

export default function EvaluationSearch({
  defaultValue = "",
  error,
  compact = false,
  variant = "default",
}: EvaluationSearchProps) {
  if (variant === "ticket") {
    return (
      <form action="/evaluate" className={ticketStyles.searchTicket} method="get">
        <div className={ticketStyles.searchField}>
          <label className={ticketStyles.searchLabel} htmlFor="evaluation-symbol">
            A股 / 场内基金代码
          </label>
          <div className={ticketStyles.searchInputRow}>
            <input
              aria-describedby={error ? "evaluation-symbol-error" : "evaluation-symbol-help"}
              aria-invalid={Boolean(error)}
              autoComplete="off"
              className={ticketStyles.searchInput}
              defaultValue={defaultValue}
              id="evaluation-symbol"
              inputMode="numeric"
              maxLength={6}
              minLength={6}
              name="symbol"
              pattern="[0-9]{6}"
              placeholder="例如 600519"
              required
              type="text"
            />
          </div>
        </div>
        <button className={ticketStyles.searchButton} type="submit">
          签发评估票
        </button>
        {error ? (
          <p className={ticketStyles.searchError} id="evaluation-symbol-error">
            {error}
          </p>
        ) : (
          <p className={ticketStyles.searchHelp} id="evaluation-symbol-help">
            支持六位A股及场内ETF、LOF代码，例如 600519、159915、510300。
          </p>
        )}
      </form>
    );
  }

  return (
    <form action="/evaluate" className={compact ? "w-full max-w-[680px]" : "w-full max-w-[760px]"} method="get">
      <label className="block text-[13px] font-[550] leading-[18px] text-[#102C3A]" htmlFor="evaluation-symbol">
        A股 / 场内基金代码
      </label>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_108px] gap-2 rounded-[20px] border border-[#102C3A]/15 bg-white/85 p-1.5 shadow-[0_12px_32px_-18px_rgba(20,30,80,0.22)] sm:flex sm:flex-row">
        <input
          aria-describedby={error ? "evaluation-symbol-error" : "evaluation-symbol-help"}
          aria-invalid={Boolean(error)}
          autoComplete="off"
          className="h-12 min-w-0 flex-1 rounded-2xl border-0 bg-transparent px-3 text-base font-medium text-[#102C3A] outline-none placeholder:font-normal placeholder:text-[#718C98] focus:bg-[#F7F8F6] aria-[invalid=true]:text-[#B44D5C] tabular-nums sm:px-4"
          defaultValue={defaultValue}
          id="evaluation-symbol"
          name="symbol"
          inputMode="numeric"
          maxLength={6}
          minLength={6}
          pattern="[0-9]{6}"
          placeholder="例如 600519"
          required
          type="text"
        />
        <button
          className="inline-flex h-12 min-w-0 items-center justify-center rounded-full bg-[#102C3A] px-3 text-sm font-semibold text-white outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[#5661D9] focus-visible:ring-offset-2 sm:min-w-[124px] sm:px-6"
          type="submit"
        >
          开始评估
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-[12px] leading-[18px] text-[#B44D5C]" id="evaluation-symbol-error">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-[12px] leading-[18px] text-[#718C98]" id="evaluation-symbol-help">
          支持六位A股及场内ETF、LOF代码，例如 600519、159915、510300。
        </p>
      )}
    </form>
  );
}
