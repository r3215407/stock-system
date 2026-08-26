import type { Metadata } from "next";

import EtfRotationWorkspace from "@/components/EtfRotationWorkspace";

export const metadata: Metadata = {
  title: "ETF 动量轮动 · Glacier Signal",
  description: "每天 14:45 自动运行的固定 ETF 池模拟动量轮动账本。",
};

export default function EtfRotationPage() {
  return <EtfRotationWorkspace />;
}
