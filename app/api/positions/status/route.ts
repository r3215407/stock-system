import { normalizeSymbol } from "@/lib/evaluation";
import { getHoldingStatus } from "@/lib/position-status";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const symbol = normalizeSymbol(typeof body.symbol === "string" ? body.symbol : "");
    const purchaseDate = typeof body.purchaseDate === "string" ? body.purchaseDate : "";
    const averageCost = Number(body.averageCost);
    const actualShares = Number(body.actualShares);
    const initialStopPrice = Number(body.initialStopPrice);
    if (!symbol.valid || !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate) || !(averageCost > 0) || !Number.isInteger(actualShares) || actualShares <= 0 || !(initialStopPrice > 0) || initialStopPrice >= averageCost) {
      return Response.json({ message: "持仓状态参数无效" }, { status: 400 });
    }
    const status = await getHoldingStatus({ symbol: symbol.normalized, purchaseDate, averageCost, actualShares, initialStopPrice });
    if (purchaseDate > status.quoteDate) return Response.json({ message: `买入日期不能晚于最新行情日 ${status.quoteDate}` }, { status: 400 });
    return Response.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "行情状态计算失败" }, { status: 502 });
  }
}
