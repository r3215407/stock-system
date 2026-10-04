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
        <span data-surface-contract="etf-rotation-v1" hidden>
          THESIS: 把自动 ETF 轮动呈现为可追溯的已签发账本，拒绝同权重指标卡仪表盘。 OWN-WORLD: 深海军蓝票夹承载运行状态，纸白记录保存账本与交易，复写紫只用于资产和仓位输出，裁角与虚线连接整套凭证。 STORY: 用户先确认今日任务，再核对资产与持仓，随后追溯曲线、交易和固定 ETF 池。 FIRST VIEWPORT: 标题和版本之后依次是运行状态、六项资产指标与当前持仓；只读且没有执行按钮。 FORM: PRD 锁定的操作型轮动账本，沿用既有 Glacier Signal Ticket System，surface seed etf-rotation-v1。 FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
        </span>
        <span data-surface-contract="macd-513530-v1" hidden>
          THESIS: 把 513530 次日仓位判断签发为一张先给结论、再核对执行条件的交易票。 OWN-WORLD: 深海军蓝票夹、纸白结论券与复写紫执行检查联，沿用 Glacier Signal 票证系统。 STORY: 用户先看到明日是否新增买入，再核对尾盘执行条件，最后追溯 MACD 与均线依据。 FIRST VIEWPORT: 结论券与执行条件并列，移动端先结论后检查；不把策略信号包装成收益预测。 FORM: 单标的操作型次日计划，surface seed macd-513530-v1。 FINISH: verified with tests, build, and responsive screenshots.
        </span>
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
