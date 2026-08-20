"use client";

import { useEffect, useState } from "react";

type SavedEvaluation = {
  id: string;
  savedAt: string;
  modelVersion: string;
  stock: {
    name: string;
    symbol: string;
    dataDate: string;
  };
  result: {
    conclusion: string;
    earned: number;
    determined: number;
    allocationRate?: number;
    stopPrice?: number | null;
  };
};

function readRecords() {
  const records: SavedEvaluation[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith("glacier-evaluation-")) continue;
    const value = localStorage.getItem(key);
    if (!value) continue;
    try {
      records.push(JSON.parse(value) as SavedEvaluation);
    } catch {
      // Ignore malformed local records instead of blocking the page.
    }
  }
  return records.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export default function RecentEvaluations() {
  const [records, setRecords] = useState<SavedEvaluation[]>([]);

  useEffect(() => {
    const refresh = () => setRecords(readRecords());
    refresh();
    window.addEventListener("glacier-evaluation-saved", refresh);
    return () => window.removeEventListener("glacier-evaluation-saved", refresh);
  }, []);

  if (records.length === 0) {
    return <span className="text-[12px] text-[#647985]">尚无已保存记录</span>;
  }

  return (
    <div className="mt-5 divide-y divide-[#E3EFF4] border-y border-[#E3EFF4]">
      {records.slice(0, 5).map((record) => (
        <div className="grid gap-3 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-8" key={record.id}>
          <div>
            <p className="text-sm font-semibold text-[#102C3A]">{record.stock.name} <span className="font-mono text-[12px] font-normal text-[#718C98]">{record.stock.symbol}</span></p>
            <p className="mt-1 text-[12px] text-[#718C98]">信号日 {record.stock.dataDate} · 保存于 {new Date(record.savedAt).toLocaleString("zh-CN")}</p>
          </div>
          <p className="text-[13px] text-[#476775]">{record.result.conclusion} · {record.result.earned}/{record.result.determined}</p>
          <p className="text-[13px] font-semibold tabular-nums text-[#102C3A]">
            {typeof record.result.allocationRate === "number"
              ? `${(record.result.allocationRate * 100).toFixed(2)}% · ${typeof record.result.stopPrice === "number" ? `¥${record.result.stopPrice.toFixed(2)}` : "—"}`
              : "旧版记录"}
          </p>
        </div>
      ))}
    </div>
  );
}
