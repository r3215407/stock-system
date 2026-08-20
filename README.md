# Glacier Signal

Glacier Signal 是一个面向 A 股与场内基金的趋势回调转强评估工具。系统读取真实前复权日线，执行硬性过滤与评分，并根据账户风险约束计算计划仓位和结构止损。

## 本地开发

要求：Node.js 20 或更高版本。

```bash
npm ci
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 验证

```bash
npm run lint
npm run build
```

## 项目结构

- `app/`：Next.js 页面与行情 API
- `components/`：Hero、评估工作台及通用界面组件
- `lib/`：评分规则、行情读取与指标计算
- `public/assets/`：正式 Hero 视觉资产
- `design.md`：Glacier 全站设计规范
- `landing-hero-design.md`：Hero 设计规范
- `趋势中的回调转强交易模型.md`：交易模型规则来源
- `趋势回调转强评分页面-PRD.md`：评分产品需求文档

## 数据与边界

行情来自公开市场数据接口，页面会显示实际数据来源和复权口径。评分表示当前条件与模型的匹配程度，不代表上涨概率，也不构成投资建议。产品不连接券商，不自动下单。
