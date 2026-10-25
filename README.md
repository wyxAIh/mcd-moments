# 麦时刻 / MCD MOMENTS

把用户的时间、情绪、预算和同行人数，变成一个“此刻值得去麦”的具体理由。不是另一个套餐推荐器：同一份真实菜单会被「预算席 / 尝鲜席 / 此刻席」三种立场重新解读，由用户投票裁决，并复制分享卡。

## 目标用户

赶时间的上班族、约朋友吃饭的人、一个人临时找餐的人，以及想快速发现新品/优惠的麦当劳顾客。

## 主要体验

1. 选择当前状态、预算、时间、同行人数与偏好。
2. 服务端只读调用麦当劳 MCP：活动日历、营养信息、杭州到店门店、门店菜单、价格计算。
3. 基于 MCP 返回的真实菜单商品，给出三种不同理由；报价来自 `calculate-price`，不是模型猜价。
4. 用户选择自己认同的一席，复制成可分享的麦时刻卡。
5. 不创建订单、不访问会员账户、不支付；用户仍可自行决定下一步。

## 安装与启动

需要 Node.js 18+，无第三方依赖。

```bash
# Bash / macOS / Linux
export MCD_MCP_TOKEN='从麦当劳 MCP 控制台复制的 Token'
node server.js
```

```powershell
# Windows PowerShell
$env:MCD_MCP_TOKEN = '从麦当劳 MCP 控制台复制的 Token'
node server.js
```

打开 `http://localhost:3000`。必须配置有效的 `MCD_MCP_TOKEN` 才会生成实时门店、菜单与价格；缺少 Token 或任一实时工具失败时，页面会明确显示错误并要求重试，不再把固定样例伪装成实时结果。真实 Token 只从服务端环境变量读取，不应提交到 GitHub、截图、浏览器代码或日志。

## 使用示例

选择当前状态、预算区间、时间窗口、同行人数与偏好，再点击「生成我的麦时刻」。这些输入会影响方案标题与理由、商品筛选/排序、套餐数量和人均预算；时间按用户给定的时间窗口调整方案偏好，不代表 MCP 提供了实际制作或等餐时长。分享偏好会优先考虑菜单名称/分类中标注的多人餐、分享装或拼盘。服务端查询门店、实时菜单和活动，再对三席候选分别调用 `calculate-price`；价格以 MCP 返回的整数分为准，转换成人民币展示，并核对计价商品明细及所选人均预算上限。任一实时必要项不可用、核价商品不匹配或核价超预算时，不返回候选，而显示明确错误。

## 麦当劳 MCP

- MCP Server：`https://mcp.mcd.cn`（Streamable HTTP）
- 工具调用流程、API 与隐私说明：见 [MCP_INTEGRATION.md](./MCP_INTEGRATION.md)
- 配置样例：见 [mcp-config.example.json](./mcp-config.example.json)

## 视觉与适配

- 桌面端采用清晰的显示字体与等宽 MCP 状态字体，正文、标题、数据和按钮均有独立层级。
- 页面覆盖 1440px 桌面、平板和 480px 手机断点；移动端会将导航收敛、表单单列化、推荐卡改为触控友好的纵向布局。
- 输入面板、推荐卡、Demo 台、链路节点、票根和对话框统一使用圆角矩形；按钮与筛选项保持足够的触控高度，同时保留票根视觉的轻量边界。
- 页面不加载外部字体、图片或 CDN；字体使用系统回退栈，离线打开也保持可用。

## 运行检查

```bash
node --check server.js
node --check app.js
node server.js
```

确认 `GET /api/health` 返回服务状态；提交表单后 `POST /api/challenge` 返回 `isDemo: false` 且三组方案含 `priceSource: "calculate-price"`，即为 MCP 实时方案。

## 项目文件

- `index.html`、`styles.css`、`app.js`：响应式页面与投票分享交互
- `server.js`：MCP 代理、只读工具编排、API 与静态服务
- `MCP_INTEGRATION.md`：MCP 工具、参数、调用流程和边界
- `CONTEST_DECLARATION.md`：参赛原创与合规声明
- `workbuddy.md`：WorkBuddy 开发过程记录
