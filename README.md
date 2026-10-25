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

打开 `http://localhost:3000`。若不设置 token，页面仍可使用，但显示演示数据。真实 Token 只从服务端环境变量读取，不应提交到 GitHub、截图、浏览器代码或日志。

## 使用示例

在页面中选“赶稿冲刺”、预算 ¥25—40、20 分钟、1 人，点击「生成我的麦时刻」。杭州默认门店会通过 `query-nearby-stores` 查询；实际门店菜单和价格随后调用 MCP 获取。也可切换到“见朋友”并增加同行人数，比较三席方案，然后选择任一方案、复制分享卡。

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
