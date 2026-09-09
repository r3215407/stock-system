export type TencentPriceAdjustment = "qfq" | "none";

export function buildTencentDailyKlineParam(securityId: string, limit: number, adjustment: TencentPriceAdjustment) {
  return `${securityId},day,,,${limit},${adjustment === "qfq" ? "qfq" : ""}`;
}
