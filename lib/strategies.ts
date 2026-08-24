export type StrategyStatus = "current" | "research" | "disabled";

export type StrategyDefinition = {
  strategyId: string;
  strategyVersion: string;
  parameterVersion: string;
  displayName: string;
  shortName: string;
  status: StrategyStatus;
  instrumentProfile: "普通股票";
  allowsPositionPlan: boolean;
  universeConfig: {
    markets: readonly ["上海", "深圳"];
    minimumListingDays: number;
    minimumAverageAmount20: number;
    excludes: readonly string[];
  };
  signalConfig: {
    minimumScore: number;
    minimumTechnicalScore: number;
    minimumStrengthScore: number;
  };
  rankingConfig: readonly string[];
  outputConfig: { topN: number };
};

export const strategies = Object.freeze([
  {
    strategyId: "pullback-strength-stock",
    strategyVersion: "0.4",
    parameterVersion: "0.4-current",
    displayName: "趋势回调转强 · 股票 0.4",
    shortName: "回调转强 0.4",
    status: "current",
    instrumentProfile: "普通股票",
    allowsPositionPlan: true,
    universeConfig: {
      markets: ["上海", "深圳"] as const,
      minimumListingDays: 250,
      minimumAverageAmount20: 50_000_000,
      excludes: ["ST / *ST / 退市整理", "停牌", "上市不足250个交易日", "20日平均成交额不足5000万元"],
    },
    signalConfig: { minimumScore: 70, minimumTechnicalScore: 65, minimumStrengthScore: 21 },
    rankingConfig: ["总分降序", "转强分降序", "止损距离升序", "20日平均成交额降序", "股票代码升序"],
    outputConfig: { topN: 10 },
  },
] satisfies readonly StrategyDefinition[]);

export function getStrategy(strategyId: string, strategyVersion: string): StrategyDefinition | undefined {
  return strategies.find((item) => item.strategyId === strategyId && item.strategyVersion === strategyVersion);
}

export const currentStrategy = strategies.find((item) => item.status === "current")!;
