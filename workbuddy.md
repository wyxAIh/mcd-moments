# WorkBuddy 开发过程记录

## 项目目标

为 WaytoAGI 1024 用餐赛道与麦当劳程序员创意开发大赛制作一个真实调用麦当劳 MCP 的可演示网页。核心创新不是把自然语言换成点餐按钮，而是让同一份实时菜单接受三种“立场”解读：预算席、尝鲜席、此刻席，用户用投票裁决选择，并生成可分享的用餐理由。

## 关键决策

1. **只读优先**：为了现场稳定与用户安全，只调用活动日历、营养、门店、菜单和价格计算能力，不创建订单、不支付、不访问个人账户。
2. **实时校验优先**：有 Token 且 MCP 成功时，门店、菜单、商品价格来自官方 MCP；缺少 Token、接口异常、商品核价不匹配或核价超预算时，明确报错，不伪装固定样例为实时结果。
3. **服务端保管 Token**：Token 仅通过 `MCD_MCP_TOKEN` 环境变量进入 Node.js 代理，浏览器只访问本地 `/api/challenge`，前端不持有凭证。
4. **现场叙事**：Demo 以“赶稿冲刺、20 分钟、1 人”为默认场景，先演示 MCP 工具调用，再让评委点击三席方案，最后复制分享卡；3 分钟内可讲清问题、差异化、真实链路和下一步。

## 最新修复与验证记录

- 修复实时链路：`POST /api/challenge` 现在只有在有效 Token、可用门店、实时菜单和三个候选的 `calculate-price` 都成功时才返回方案；缺少任一条件会明确返回错误，不再把固定样例冒充实时数据。
- 修复个性化联动：状态、预算、时间、同行人数和偏好会进入后端请求，并影响候选商品、数量、人均价格、标题、理由与分享卡；时间只作为用户可用时长偏好，不代表门店实际制作时长。
- 基于官方工具 schema 核实金额：`query-meals.currentPrice` 为元值；`calculate-price.price`、`originalPrice`、`discount` 为整数分，服务端固定除以 100。价格工具返回的 `productList` 必须与提交的商品编码和数量一致。
- 所有三席均先按人均预算筛选候选，再用 `calculate-price` 做最终核价；超过预算的结果整体 fail-closed，不向用户展示。
- 线上部署前必须在服务器环境安全配置 `MCD_MCP_TOKEN`；本地和公开仓库均不保存真实 Token。

## 已实现内容

- 响应式票根/杂志风页面：`index.html`、`styles.css`
- 输入状态、预算、时间、同行人数、偏好
- 三席方案卡、方案详情、选择/投票状态、分享卡复制
- MCP 调用台、工具日志、链路对话框、loading/error 状态；默认 READY，不预填历史 Demo 或虚构调用指标
- Node.js 原生 HTTP MCP 代理：`server.js`
- MCP 接入说明：`MCP_INTEGRATION.md`
- 参赛材料：`README.md`、`CONTEST_DECLARATION.md`、`mcp-config.example.json`

## 视觉迭代记录

2026-10-25 11:28 进行第二轮视觉优化：将标题、正文、等宽状态信息拆分为可读的系统字体栈；补齐桌面、平板与手机断点；把输入面板、方案卡、Demo 台、链路节点、对话框与主要按钮统一为圆角矩形；提升触控高度、焦点可见性和小屏单列布局。优化仅修改 CSS 和说明文档，不改 MCP 调用和安全边界。

## 实际验证

2026-10-25 已用官方 MCP Token 在本地验证：

- `GET /api/health` 返回 `mcpConfigured: true`、`isDemo: false`
- `POST /api/challenge` 成功返回三组真实门店菜单方案
- 示例门店为杭州东站出发东站内餐厅，商品价格通过 `calculate-price` 返回
- 未触发订单创建、支付、账户读取等动作

## 提交前检查

- 不要把真实 Token 写入 `.env`、GitHub、截图、录屏或对话记录文件
- 在 GitHub 保持仓库公开，提交 `README.md`、`CONTEST_DECLARATION.md`、`MCP_INTEGRATION.md`、源代码、`mcp-config.example.json`、`workbuddy.md`
- WaytoAGI 用餐赛道需在 2026-10-25 16:00 前提交可用作品与说明/录屏
- 麦当劳大赛需在 2026-10-25 23:59 前提交 GitHub Issue，项目排名数据截止 2026-10-26 00:00
