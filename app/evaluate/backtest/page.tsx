import BacktestWorkspace from "@/components/BacktestWorkspace";
import { normalizeSymbol } from "@/lib/evaluation";

export const metadata = { title: "近两年回测 · Glacier Signal", description: "趋势回调转强 0.4 个股回测。" };

export default async function BacktestPage({ searchParams }: { searchParams: Promise<{ symbol?: string | string[]; endDate?: string | string[] }> }) {
  const query = await searchParams;
  const symbol = normalizeSymbol(query.symbol);
  const endDate = Array.isArray(query.endDate) ? query.endDate[0] : query.endDate ?? "";
  if (!symbol.valid) return <main className="mx-auto max-w-4xl px-4 py-16"><h1 className="text-2xl font-semibold">请输入有效的六位 A 股代码。</h1><a className="mt-4 inline-flex underline" href="/evaluate">返回个股评分</a></main>;
  return <BacktestWorkspace symbol={symbol.normalized} endDate={endDate} />;
}
