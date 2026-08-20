type EvaluationSearchProps = {
  defaultValue?: string;
  error?: string;
  compact?: boolean;
};

export default function EvaluationSearch({
  defaultValue = "",
  error,
  compact = false,
}: EvaluationSearchProps) {
  return (
    <form action="/evaluate" className={compact ? "w-full max-w-[680px]" : "w-full max-w-[760px]"} method="get">
      <label className="block text-[13px] font-[550] leading-[18px] text-[#102C3A]" htmlFor="evaluation-symbol">
        A股 / 场内基金代码
      </label>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_104px] gap-2 sm:flex sm:flex-row">
        <input
          aria-describedby={error ? "evaluation-symbol-error" : "evaluation-symbol-help"}
          aria-invalid={Boolean(error)}
          autoComplete="off"
          className="h-12 min-w-0 flex-1 rounded-[6px] border border-[#C9DEE8] bg-white px-3 text-base font-medium text-[#102C3A] outline-none placeholder:font-normal placeholder:text-[#718C98] focus:border-[#3B91AE] focus:ring-2 focus:ring-[#69D2E7]/25 aria-[invalid=true]:border-[#B44D5C] tabular-nums sm:px-4"
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
          className="inline-flex h-12 min-w-0 items-center justify-center rounded-[6px] bg-[#3B91AE] px-3 text-sm font-semibold text-white outline-none transition-colors hover:bg-[#25748F] focus-visible:ring-2 focus-visible:ring-[#69D2E7] focus-visible:ring-offset-2 sm:min-w-[120px] sm:px-6"
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
