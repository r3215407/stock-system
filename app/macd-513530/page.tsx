import type { Metadata } from "next";

import MacdOutlookWorkspace from "@/components/MacdOutlookWorkspace";

export const metadata: Metadata = {
  title: "513530 明日交易计划 · Glacier Signal",
  description: "根据正式收盘 MACD 与均线信号，生成 513530 下一交易日的分级仓位计划。",
};

export default function Macd513530Page() {
  return <MacdOutlookWorkspace />;
}
