import PositionPlanner from "@/components/PositionPlanner";

export const metadata = { title: "仓位方案 · Glacier Signal", description: "多候选风险预算、持仓管理与成交路径复盘。" };

export default async function PositionsPage({ searchParams }: { searchParams: Promise<{ items?: string | string[] }> }) {
  const query = await searchParams;
  const value = Array.isArray(query.items) ? query.items[0] : query.items ?? "";
  return <PositionPlanner encodedItems={value} />;
}
