# dsh-bailian-quota

阿里云百炼 **Token Plan** 的额度与用量插件（DeepSeek Harness / DSH）。

在输入框工具行显示 `套餐 1.24%`，点开是一张卡片；设置里有完整面板与按天堆叠的 token 图表。

> English summary at the bottom.

## 它解决什么

Token Plan 的专属 API Key（`sk-sp-` 开头）只能调用模型，**查不了额度**；控制台也没有公开的额度接口。本插件走**官方 CLI**：

```bash
bl usage token-plan --output json
```

它复用你已经完成的 `bl auth login` 会话，**不读取、不保存、不传输任何 API Key**，也不会碰 `~/.bailian/config.json`。

## 功能

- **工具行胶囊**：`套餐 1.24%`，两位小数，颜色随用量变化（<70% 绿、≥70% 琥珀、≥90% 橙、≥100% 红）。套餐失效 / 未登录 / 读不到数据时**整枚不渲染**，不占位。
- **点击弹出卡片**：Token 用量（本机统计）+ 套餐额度（已用 / 剩余 / 重置 / 倒计时）。
- **设置 → 百炼额度**：
  - 统计窗口可选：今天 / 近 7 天 / 近 30 天 / 本月 / 上月 / 自定义日期；
  - 三段堆叠柱状图（命中缓存 / 未命中缓存 / 输出），悬停出小卡片显示当日明细；
  - 套餐额度卡片：进度条 + 五行明细。
- 弹层里的「统计窗口」跟随设置页，但**只读**。

## 安装

### 方式一：从 GitHub 安装（推荐）

在 DSH 的 **插件 → 添加插件** 里填：

```
github:KNtnx/dsh-bailian-quota
```

或者命令行：

```bash
dsh plugin --profile web add github:KNtnx/dsh-bailian-quota
```

> 把 `web` 换成你实际的 profile（Desktop 版通常是 `desktop`）。安装后重启 `dsh web`。

### 方式二：从本地目录安装

```bash
git clone https://github.com/KNtnx/dsh-bailian-quota.git
dsh plugin --profile web add link:./dsh-bailian-quota
```

### 前置：登录百炼 CLI

```bash
npm i -g bailian-cli
bl auth login          # 浏览器登录，或 bl auth login --open-api 用 AK/SK
bl usage token-plan --output json
```

正常输出：

```json
{ "per1MonthPercentage": 0.0124, "per1MonthResetTime": 1797782400000, "hasQuotaData": true }
```

## 两种数据来源（重要）

| 数字 | 来源 | 说明 |
|---|---|---|
| 已用 / 剩余 / 重置 | `bl usage token-plan` | 控制台只返回**比例**与重置时刻，没有 token 数 |
| 总 token / 调用次数 / 模型数 / 每日图表 | **本机 DSH 统计** | 重放 `$DSH_HOME/sessions/**/session.v4.jsonl.zstd` 里 `request/header` 与 `assistant/message` 事件，只累计 `qwen-token-plan*` 路由 |

所以 token 数是"这台机器经 DSH 发出的 Token Plan 调用"，不是控制台账单口径，也不含其它客户端；页面上标注为 `DSH 统计`。

控制台「用量详情」页的总 token / 缓存命中率属于 Token Plan 产品口径，**`bl` 目前没有对应命令**；`bl usage stats` 查的是按量计费工作空间，与 Token Plan 不是同一批调用，因此两者都没有混进来。

## 数据与隐私

- 只执行两条命令：`bl usage token-plan --output json`、以及（本机统计用的）会话日志读取；
- 会话日志只读，按文件 mtime 做增量缓存，缓存写在 `$DSH_HOME/storages/bailian-quota/`；
- 插件不向任何第三方上报数据，HTTP 路由只接受 loopback 请求；
- 不读 `~/.bailian/config.json`，不接触 API Key。

## 性能

- 额度百分比：宿主缓存 60 秒，点 ↻ 强制刷新；
- token 统计：首次重放约数秒（按天取整），之后按文件 mtime 增量、内存缓存 60 秒，二次打开 < 20ms；
- 插件激活时会预热一次，所以第一次点开不用等。

## 已知限制

- 只支持 **个人版月度配额** 这一档（控制台返回什么就显示什么）；
- 只统计 `qwen-token-plan*` 路由；换到其它 provider 时数字不会增长；
- 本机统计依赖 DSH 的会话日志格式（`session.v4`），大版本升级后如格式变化需要适配；
- 图表窗口很大（如自定义一年）时柱子会变得很密，建议 90 天以内。

## 开发

```bash
node --check index.js
node --check client.js
dsh plugin --profile web add link:$(pwd)
```

目录结构：

```
package.json        插件清单（dsh.bundle.patch + dsh.client）
cordis.patch.yml    宿主行插入
index.js            宿主：bl CLI 读取、会话重放、两条 HTTP 路由
client.js           浏览器：胶囊、弹层、设置页、图表
locale/             插件市场展示用的标题/描述
docs/DETAIL.md      插件详情页
```

## License

MIT

---

## English

A DSH plugin that shows your **Aliyun Bailian Token Plan** allowance and this machine's token usage.

It shells out to the official `bl` CLI (`bl usage token-plan --output json`) — no API key is read, stored, or sent anywhere — and folds the harness's own session logs to count tokens that went through `qwen-token-plan*` routes.

Install with `github:KNtnx/dsh-bailian-quota` from **Plugins → Add plugin**, or `dsh plugin --profile web add github:KNtnx/dsh-bailian-quota`.