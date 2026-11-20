# 百炼额度 · Bailian quota

阿里云百炼 **Token Plan（个人版）** 的额度与用量仪表：**输入框工具行**里一枚「套餐 1.24%」胶囊，点开是 Token 用量 + 套餐额度卡片；**Settings → 百炼额度** 里是可切换统计窗口的完整面板（今日 / 近 7 天 / 近 30 天 / 本月 / 上月 / 自定义），含按天堆叠的 token 图表。

## 为什么需要它

Token Plan 的专属 API Key（`sk-sp-` 开头）只能调用模型，查不了配额；配额只在百炼控制台的数据网关里。本插件使用**官方 CLI** 读取：

```bash
bl usage token-plan --output json
```

它复用你已经完成的 `bl auth login` 会话，**不读取、不保存、不传输任何 API Key**。插件本身不接触 `~/.bailian/config.json`。

## 安装与前置

1. 安装并登录官方 CLI：

   ```bash
   npm i -g bailian-cli
   bl auth login
   ```

   登录后确认能取到数据：

   ```bash
   bl usage token-plan --output json
   ```

   正常输出形如：

   ```json
   { "per1MonthPercentage": 0.00258, "per1MonthResetTime": 1797782400000, "hasQuotaData": true }
   ```

2. 在 **Plugins → 添加插件** 选择本目录安装，或让 DSH 安装该本地目录。

## 界面

- **工具行胶囊**：状态点 + `套餐` + 已用百分比（两位小数）。**套餐不在有效期内、未登录或读不到控制台数据时整枚胶囊不渲染**，工具行不会留下空位。
- **设置页**：统计窗口可切换（含自定义日期区间），柱状图按「命中缓存 / 未命中缓存 / 输出」三段堆叠，悬停显示当日明细；套餐额度卡片给出进度条与五行事实。
- **点击胶囊弹出卡片**：套餐/已用/剩余/重置，外加**本机用量**（近 7 天总 token、调用次数、模型数）。卡片 `Esc` 或点击外部关闭，右上角 ↻ 刷新。设置页 `百炼额度` 里是同一组信息加趋势图。
- **设置页**：同样的事实，外加按小时采样的消耗趋势图；读取失败时在这里显示 CLI 的原始错误与排查提示。

`per1MonthPercentage` 是**已用比例**（0–1），插件据此换算已用与剩余；`per1MonthResetTime` 是订阅月的重置时刻（毫秒时间戳），面板把它显示为日期并给出「还有多久」。

## 数据流

```
浏览器 ──GET /api/bailian-quota/state──▶ 宿主插件（缓存 60 s）
       ──POST /api/bailian-quota/refresh─▶   └─ spawn: bl usage token-plan --output json
```

- 两个路由都只接受 loopback 请求：配额属于账号数据。
- 趋势点保存在 `$DSH_HOME/storages/bailian-quota/history.json`，最多保留 720 个点。
- 宿主进程的 `PATH` 常常没有登录 shell 的版本管理器 shim，所以插件会依次尝试 `DSH_BAILIAN_BL`、`~/.local/bin/bl`、`/usr/local/bin/bl`、`/usr/bin/bl`、fnm 各版本的 `installation/bin/bl`，最后才退回 `PATH` 里的 `bl`。

## 已知限制

- 只显示**月度**配额：Token Plan 个人版按订阅月重置，控制台返回的就是这一档；没有 5 小时 / 每周窗口可显示。
- **两种口径，分别标注**：
  - 额度百分比来自 `bl usage token-plan`（控制台只返回比例与重置时刻，没有 token 数）；
  - **token 数是本机 DSH 统计**：在打开卡片时重放 `$DSH_HOME/sessions/**/session.v4.jsonl.zstd` 里 `request/header` 与 `assistant/message` 事件，只累计 `qwen-token-plan*` 路由，按文件 mtime 做增量缓存（缓存文件 `$DSH_HOME/storages/bailian-quota/local-replay.json`）。所以它统计的是「这台机器经 DSH 发出的 Token Plan 调用」，不是控制台的账单口径，也不包含其它客户端。
- 控制台「用量详情」页的总 token / 缓存命中率属于 Token Plan 产品口径，`bl` 目前没有对应命令；`bl usage stats` 查的是按量计费工作空间（与 Token Plan 不是同一批调用），所以两者都没有混进卡片。
- 控制台不返回总额度数值（Credits 上限），所以面板只呈现比例与重置时刻，不编造具体 Credits。
- `bl` 的会话过期后，额度条会显示「读取失败」并把 CLI 的原始错误放在提示里；重新执行 `bl auth login` 即恢复。
- 挂载点是 `conversation.input.right`（session 作用域的 list 槽位），因此跟随当前皮肤排布；`dsh-claude-style` 会接管侧栏底部并把外来子元素设为 `display:none`，所以没有放在侧栏页脚。
- 宿主会缓存已激活插件的客户端模块，**改完客户端代码需要重启 `dsh web` 才生效**（浏览器刷新不够）。