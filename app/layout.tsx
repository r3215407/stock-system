import type { Metadata } from "next";
import type { ReactNode } from "react";

import AppHeader from "@/components/AppHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Glacier Signal",
  description: "趋势回调转强日线交易模型评估工具",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html data-scroll-behavior="smooth" lang="zh-CN">
      <body>
        <span
          data-design-contract="df363d33"
          hidden
        >
          THESIS: 把个股判断变成一张可追溯的结论签发票，拒绝通用数据卡片仪表盘。 OWN-WORLD: 深海军蓝票夹、纸白主券、复写紫风险回执、红绿验讫章、裁角与虚线齿孔。 STORY: 用户先读结论与阻断，再完成确认，最后得到止损和仓位。 FIRST VIEWPORT: 桌面左检查联、中主结论券、右风险回执；移动端依次为结论、检查、回执，回测按钮位于紫色回执底部。 FORM: 交易票证夹，候选方向第 1 位，seed df363d33。 FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
        </span>
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
