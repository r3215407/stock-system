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

## Vercel 定时任务

生产环境需要配置 transaction pool 模式的 `POSTGRES_URL`（有直连或 session 模式地址时可同时配置 `POSTGRES_URL_NON_POOLING`，仅用于运维）和至少 16 位随机值的 `CRON_SECRET`。应用运行时优先使用 pooled URL，单实例最多保持 2 条连接。全市场扫描任务、分片进度与最终结果全部保存在 PostgreSQL，不依赖 Redis。

- ETF 轮动：北京时间周一至周五 14:45，成功、失败或工作日休市时按现有规则发送邮件；周末不查询、不发邮件。
- 全市场扫描：交易日由 GitHub Actions 启动并驱动服务端分片，不发送邮件。
- 扫描页面：只读取最新任务并每 5 秒刷新进度，不创建或取消全市场任务；只有已有任务存在失败数据时才显示重试。

Vercel 只保留 ETF 轮动这一个每日 Cron。全市场扫描由 GitHub Actions 在交易日北京时间 15:40 启动，并持续调用 Vercel 上的小分片 worker；页面仅显示当前进度和最新结果。Free/Hobby 的 Cron 是小时级精度，因此 ETF 任务也不能保证严格在配置分钟触发。中国交易所休市日会在接口内再次拦截。

GitHub 仓库需要配置两个 Actions secrets：

- `VERCEL_APP_URL`：生产环境根地址，例如 `https://example.vercel.app`。
- `CRON_SECRET`：与 Vercel 生产环境中的同名变量使用相同值。

Actions 页面的 `Daily stock screening` 也可手动运行。它先创建带当日幂等键的扫描任务，再逐个驱动该任务的 PostgreSQL 分片，直到生成双榜或达到安全上限。正常分片之间等待 10 秒；worker 请求失败时最多重试 5 次，每次至少等待 15 秒，避免行情源或 Vercel 短暂异常时连续施压。

GitHub Actions 通过 `/api/cron/stock-screening` 创建 PostgreSQL 任务，证券池、基准行情和股票分片均由服务端 worker 处理。初始化任务与股票分片都有租约和最多三次重试。

页面轮询 `GET /api/screenings` 读取最新任务。点击“重试失败数据”只会把原任务已有分片中的失败证券重新排队，不会创建新的扫描任务或重新请求已成功评分的股票。重试期间由当前页面驱动这些失败分片。

每个分片会单独保存本轮失败的证券子集。扫描完成后如果仍有“数据失败”，再次点击按钮只会重新排队失败证券；已经成功评分的结果和正常排除项不会重新请求，重试结果完成后与原结果合并。

服务端分片默认使用 3 个工作线程，可通过 `SCREENING_SECURITY_WORKERS` 调整。浏览器驱动的全市场扫描固定使用 3 个工作线程，并将腾讯行情请求起始间隔限制为至少 900 毫秒；公开行情源出现限流时不要为了缩短等待时间提高频率。

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
