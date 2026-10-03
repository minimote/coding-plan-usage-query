# 更新日志

## v2.10.0-2026.10.03

### 新增

- **`long` 档进度条**（`utils-query-usage.mjs` 新增 `bar`）：`--display long` 时在每个窗口的百分比前增加 6 格进度条（精度 1/48，约 2%），与百分比数字同色，背景为新增的 `COLORS.DARK_GRAY` 轨道；端点保护与 `formatPct` 对齐，只有真正 0% 全空、100% 全满，其余钳在 1–47 档。`short` 档不带条，`auto` 档把条计入测宽，放不下时回退 `short`
- 单元测试：`bar` 的分格填充 / 端点保护 / 脏数据 / 与数字同色，`renderWindows` 的 long 带条、short 不带条、null 窗口不画条

### 变更

- **四档配色调整**（`COLORS`）：绿 `#3FB950` → `#6FBF5B`、黄 `#E3B341` → `#E0B33A`、红 `#EF4444` → `#CD3131`
- **预览脚本**（`src/tools/preview.mjs`）：每个样本改为 `short` / `long` 两行，样本间空一行

## v2.9.0-2026.10.02

### 新增

- **查询壳**（`utils-query-usage.mjs` 新增 `runQueryUsage` / `runQueryCli`）：ark / commandcode / ollama / opencode-go / qwen 五脚本逐字相同的壳流程（读配置 → 定位账号 → 解析标签 → 校验凭据 → 缓存 → 渲染 → 负缓存）统一收敛，各脚本只保留差异钩子
    - ark 缓存键与标签依赖套餐 type（定位到账号后才能定），故保留 `resolveType` / `labels` / `cacheKey` 钩子
    - 配套共享工具：`fetchWithTimeout`、`readJsonResponse`（吞 JSON 解析错但透传超时）、`httpStatusError`、`toResetSec`（缺失 / 0 / 非法归 null 而非当成 1970）、`ensureAnyWindow`（三窗口全空且无 note 报结构异常）、`isTransientError`、`BROWSER_UA`、`INVALID_API_KEY`
- `renderWindows` 支持 `usage.note`：供应商在关键数据缺一角但不值得整行失败时附中文说明，渲染为行尾独立的 `⚠ <说明>` 段（AUTO 档宽度估算已计入，窄终端不溢出）

### 变更

- **OpenCode Go 改用内部 API**（`query-usage-opencode-go.mjs`）：由抓 `/workspace/<id>/go` 页面 HTML 解析（cookie + workspaceID）改为请求 `/zen/go/v1/usage`（`apiKey` Bearer 鉴权）
    - 错误判别改基于响应体 `error.type`：`EntitlementError` → 无 Go 订阅，`AuthError` / 401 / 3xx 跳登录页 → apiKey 无效，避免 403 限流 / WAF 被误判成无活跃套餐遭 `hideOnNoActivePlan` 静默吞掉
    - `redirect: manual` 不跟随重定向，以便区分鉴权失败
    - 删除 `login-opencode.mjs` / `login-opencode.cmd` / `login:opencode` script；配置 `opencode` 去掉 `authCookie` / `workspaceID`、`apiKey` 改必填，README / config.schema / config.example 同步
- **负缓存改造**（`utils-query-usage.mjs`）：
    - 缓存键由渲染好的整行 `output` 改存错误消息 `error`，命中时用本次 display 与账号标签重新渲染（原方案在 30s 窗口内改显示档位 / 标签名不生效）
    - 只对瞬时故障（`isTransientError`：超时 / 5xx 等可能自愈的错误）写负缓存；无活跃套餐 / apiKey 无效 / cookie 失效需用户改配置或重新登录才解，不写，避免修好后仍被旧错误挡满 TTL
    - `readCache` 扣倒计时只对窗口对象扣，非窗口键（note）原样保留
- **Command Code**（`query-usage-commandcode.mjs`）：
    - `planId` 未收录（上游新增 / 改名套餐）时不再整行失败，降级只显示月窗口并在行尾附「月剩余 + 当前套餐名」说明（5h / 周照常渲染）
    - 月剩余大于套餐上限（`monthlyCredits` 含 `purchasedCredits`）时按数据不可信显示 `月:--`，不再算出负百分比
    - 401 / 403 改判「apiKey 无效」（实测套餐过期是 200 + 字段全空，403 多为 key 权限 / 限流），避免被 `hideOnNoActivePlan` 静默吞掉整行
    - `planId` 撞 `Object.prototype` 键名（`toString` 等）时不再取到函数，正确识别为未收录；`subscriptions.data` 为 null 判无活跃套餐而非结构异常
- **单元测试扩充**：新增公共 `test/fetch-stub.mjs`（`makeResp` / `makeJsonResp` / `withFetch` / `withFetchByUrl` / `withFetchCapture`）替换各测试内联 stub
    - ark / commandcode / ollama / opencode-go 新增 `queryUsage` 请求层集成测试，stub `globalThis.fetch` 覆盖正常响应、401 / 403 → key 无效、500 → HTTP 错误、三窗口全空 → 结构异常、EntitlementError / AuthError 优先级、3xx 跳登录、UA 携带、负缓存按本次参数重渲染等分支
    - `utils-query-usage` 新增 `isTransientError` / `toResetSec` / `ensureAnyWindow` / `renderWindows(note)` 用例；`query-usage-qwen` 重置时间为 0 归 null 用例修正

## v2.8.0-2026.09.01

### 新增

- Command Code 用量查询（`src/query/query-usage-commandcode.mjs`）：读取 `config.json` 的 `commandcode` 凭据，并行请求 `/alpha/billing/credits`（五小时 / 周窗口用量来自 `windowLimits`、月剩余额度来自 `monthlyCredits`）与 `/alpha/billing/subscriptions`（`planId` 与月度周期），拼接出三窗口用量。月上限不在响应中，按 `planId` 维护 `PLAN_MONTHLY_CREDITS` 查表换算月用量 = `(planLimit - monthlyCredits) / planLimit`；查不到表或缺 subscriptions 时月窗口置 null（渲染显示 `月:--`）。鉴权失败（401 / 403，API Key 无效或被吊销）归一为 `NO_ACTIVE_PLAN` 无活跃套餐；三窗口全部解析失败时报「响应结构异常」，避免静默渲染 0% 误导；`apiKey` 为空给出明确提示。复用统一 `REQUEST_TIMEOUT_MS` 超时
- 接入查询体系：`utils-query-usage.mjs` 新增 `KEYS.COMMANDCODE` 与 `DEFAULT_LABELS.commandcode`（默认 `CommandCode`）；`query-usage-all.mjs` 的 `QUERY_FNS` 接入，输出与匹配顺序为 ark → commandcode → ollama → opencode → qwen
- 配置文件：`config.example.json` / `config.schema.json` 新增 `commandcode` 账号数组（`apiKey` / `longLabel` / `shortLabel`）
- `package.json`：新增 `query:commandcode` script
- 单元测试（`test/query-usage-commandcode.test.mjs`）：覆盖三窗口解析、`monthlyCredits` 表示月剩余而非月上限、非 GOAT 套餐查表换算月上限、`monthlyCredits` / `window.used` 为 null / "" / false 等脏数据不误显 100% / 0%、`planId` 不在表中或缺 subscriptions 时月窗口为 null；通过 stub `globalThis.fetch` 覆盖 401 / 403 → 无活跃套餐、500 → HTTP 错误、结构异常等请求层分支，不依赖真实网络

## v2.7.1-2026.08.25

### 修复

- 千问套餐过期 / 未订阅时误报「响应结构异常」：此时接口外层返回 SUCCESS 但 `data.DataV2.data` 内层只有元信息、数据体缺失，原实现直接判定为结构异常报错；现识别为无活跃套餐并抛 `NO_ACTIVE_PLAN`，`all` / `smart` 脚本能正确隐藏该行。数据体存在但用量字段（`per5HourPercentage` / `per1WeekPercentage`）全部缺失时仍报「响应结构异常」，不受此判定影响——接口字段改名 / 更新仍会被捕获，不会被误当无活跃套餐静默掩盖

### 变更

- 单元测试扩充（`test/query-usage-qwen.test.mjs`）：新增 queryUsage 请求层错误分支用例，通过 stub `globalThis.fetch` 返回固定响应（不依赖真实网络）覆盖「套餐过期 → 显示无活跃套餐」与「数据体存在但用量字段全缺失 → 仍报结构异常」两个分支

## v2.7.0-2026.08.06

### 新增

- 实际供应商名称工具 `src/tools/get-actual-provider-name.mjs`：作为 ccstatusline / ccstatusline-zh 自定义命令，输出当前实际使用的 CC-Switch 供应商名。获取不到套餐账号（如免费模型）或供应商名以 `free-` 开头时输出（已剥 `free-` 前缀）；匹配到套餐账号且名字无前缀时不输出（用量行前缀已含供应商信息）。`matchProviderAccount` 与 `getActualProviderName` 并发执行，前者失败（如 config 缺失）视为获取不到套餐，整体异常静默不输出
- cc-launcher 集成：`utils-cc-switch.mjs` 识别 cc-launcher 启动时注入的 `CC_SWITCH_PROVIDER_ID` 环境变量，直接反查数据库精确锁定实际启动的供应商，可区分 base_url 与 token 均相同的同 key 供应商；该 id 在数据库中查无此行或 db 读失败（短暂锁 / 损坏）时降级到全局激活供应商 `currentProviderClaude`，与「查无此行」一致——抛错也降级，避免 launcherId 侧瞬态故障直接失败。`getAPIKey` 与 `getActualProviderName` 共用新增的 `getCurrentProviderRow`，保证两条链路供应商判定一致
- `matchProviderAccount`（`utils-query-usage.mjs`）：拿 CC-Switch 当前供应商的 API Key 在 config 中匹配账号，未传 config 时内部 `loadConfig`；apiKey 有效但匹配不到账号返回 null；config 读取或 `getAPIKey` 异常（CC-Switch 配置损坏 / db 不可读 / 供应商未配 key 等真实配置故障）直接抛出由调用方诊断——这些不是「匹配不到」，不应静默降级
- `escapeRegExp`（`utils-query-usage.mjs`）：转义正则特殊字符的工具函数，把任意字符串作为字面量拼进 RegExp，opencode-go 与 get-actual-model-name 共用
- `friendlyError`（`utils-query-usage.mjs`）：把常见异常转为中文友好提示，只认客户端 `AbortSignal.timeout` 触发的超时（`DOMException` name=`TimeoutError`），不靠消息文本匹配，避免把上游错误消息中含 "timeout" 字样的业务错误误判为请求超时；其余原样透传不掩盖真实错误
- `LIGHT_GRAY` 颜色常量（#B0B0B0，白与灰的平均）：倒计时着色专用
- 单元测试：新增 `get-actual-model-name.test.mjs`（直连 / 路由 / 解析失败 / 输入为空）、`get-actual-model-name-routed.test.mjs`（路由 tier 匹配、多词下划线归一、正则特殊字符转义、`[xxx]` 后缀提取）、`get-actual-provider-name.test.mjs`（`resolveProviderDisplay` 的 free- 前缀 / 匹配与否组合）、`query-usage-cookie-expired.test.mjs`（各平台 cookie 过期错误提示）、`utils-cc-switch-getactualprovider.test.mjs`（`getActualProviderName` 的 launcherId 优先 / 降级 / db 失败）、`utils-cc-switch-getapikey-provider.test.mjs`（`getAPIKey` 走 `getCurrentProviderRow` 链路）；`cache` / `query-usage-negative-cache` / `query-usage-ollama` / `query-usage-smart` / `utils-query-usage` 等既有测试随改动扩充

### 变更

- `get-actual-model.mjs` 拆分重命名为 `get-actual-model-name.mjs`（导出 `getActualModelName`），并新增配套的 `get-actual-provider-name.mjs`；README / README_EN 项目结构同步更新
- 路由模式判定与 tier 匹配收紧（`get-actual-model-name.mjs`）：本地地址正则由 `127.0.0.1|localhost` 扩展为 `127.0.0.1|localhost|0.0.0.0|[::1]` 并支持可选端口与路径；tier 名（env 键段用下划线连接，如 `SONNET_4`）与 display_name（用连字符 / 空格 / 下划线分隔，如 `claude-sonnet-4`）匹配时，把下划线归一为任意分隔符再匹配，否则多词 tier 永远匹配不到、静默回退到更短的通配 tier；tier 名经 `escapeRegExp` 转义，避免 `\.` 通配任意字符误匹配、不平衡括号抛`SyntaxError` 使 smart 整体崩溃；`[xxx]` 后缀提取改为只取末尾单个括号组，避免贪心吞掉靠前括号
- `query-usage-smart.mjs` 重构：免费模型判断抽出纯函数 `isFreeModelName(raw)` 供单测；`matchAccountByApiKey` 从 smart 迁移到 `utils-query-usage.mjs`（按 `KEYS` 顺序遍历）并由 `matchProviderAccount` 包装（内部调 `getAPIKey`）；config 只读一次全程复用——`queryAllFallback` 与命中账号的子查询均通过 `_config` 透传已读的 cfg，避免每个账号重复 `loadConfig`
- 倒计时渲染统一处理缺失 / 负数：`renderWindows` 中 null / NaN / Infinity / 负数 / 非数字秒数一律显示 `↻ --`，负数表示「重置时间已过或不可用」不再被钳成 0 分钟误导；`toCountdown` 增加脏数据防御，非有限数字归零；`readCache` 倒计时扣除时 null 保持 null、不再钳 0；ark / qwen / ollama / opencode-go 各查询脚本 `sec` 缺失改 null、负数原样透传，统一交给渲染层显示
- 倒计时颜色由白（#E0E0E0）改为浅灰（#B0B0B0），与窗口标签区分又不至于抢过数据焦点
- `writeCache`：缓存文件若被写成了数组（`typeof === "object"` 会漏过 null / 非对象校验，给数组设命名属性后 `JSON.stringify` 丢弃，条目静默不落地），一并重置为 `{}`，避免条目丢失
- 缓存 / settings 路径支持环境变量重定向：`CC_USAGE_CACHE_PATH`（缓存文件）、`CC_SWITCH_SETTINGS_PATH`（CC-Switch settings.json）、`CC_CLAUDE_SETTINGS_PATH`（Claude settings.json），便于测试注入临时文件，不触碰真实 `~/.cc-switch` 与 `~/.claude`
- `query-usage-ark.mjs` `uriEncode` 改按 UTF-8 字节序列逐字节百分号编码（原按 UTF-16 码元把整个非 ASCII 字符当数字编码，不符合 RFC 3986，中文等字符为非法编码）
- `query-usage-ark.mjs` 账号 type 经 `normalizeType` 归一：配置写 `Agent` / `Coding` 等大小写形式不再被静默回退到 coding；type 同时用于错误标签选择与负缓存键（原 `effType` 仅用于负缓存键），声明提到 try 外，catch 写负缓存时按当前已解析的 type 落键
- `query-usage-ollama.mjs` `parseUsageWindows` 重写：从窗口标题位置向后切片取该窗口第一个 `local-time` 的 `data-time` 与 `Resets in` 文本，不依赖块容器配平（真实页面标题在 `<span>` 内、外层块容器嵌套深，按 `<div>` 配平会取到内层布局 div 而漏掉 local-time），也不依赖全局出现顺序（避免窗口顺序变化干扰）；每窗口只定位标题一次、切片一次，对同一段连跑三个正则，避免重复全量扫描；移除 `htmlToText`。移除 cookie 过期登录关键词检测（HTTP 200 + 页面出现 login / sign in 等字样即判过期）——改由后续鉴权 / 解析逻辑判定，避免正常页面文本误判
- `query-usage-opencode-go.mjs`：`getWindowObject` / `getFieldValue` 改用 `escapeRegExp`；「未找到用量数据」错误提示同时排查 workspace_id 与 cookie 过期（增加运行 `login-opencode.cmd` 重新登录引导）
- 各查询脚本错误渲染统一经 `friendlyError` 转换（ark / ollama / opencode-go / qwen），超时统一显示「请求超时（超过 10s），请稍后重试」
- `parseArgs`：`--hide-on-monthly-exhausted` / `--hide-on-no-active-plan` 取值比较改 `toLowerCase()` 容错（原 `=== "true"` 对 `True` 等大小写变体判 false）
- `utils-login.mjs`：`resolvePosition` 增加 `>= 0` 下界校验（原仅校验上界，传负数被错误接受）；浏览器初始加载阶段（`newPage` / `goto`）被关闭时归一化为「浏览器被关闭」异常供 `runLogin` 重试判断（原 Playwright 英文错误匹配不上中文正则，直接英文报错且不重试）；`isBrowserClosedError` 提取为复用判定
- `login-qwen.mjs` / `login-opencode.mjs` JSDoc 补充用户取消登录时返回 `undefined` / `null` 的契约说明

### 修复

- `query-usage-ark.mjs` `uriEncode` 对非 ASCII 字符（如中文）产生非法百分号编码：原把整个 UTF-16 码元当数字编码，现按 UTF-8 字节序列逐字节编码，符合 RFC 3986
- 路由模式下多词 tier（如 `SONNET_4`）匹配不到 display_name（如 `claude-sonnet-4`）而静默回退到更短通配 tier，导致真实模型名反推错误；tier 名含 `.` `(` `)` 等正则特殊字符时误匹配或抛 `SyntaxError` 使 smart 整体崩溃
- 倒计时为负（重置时间已过）或缺失时显示「0 分钟后重置」误导用户，现统一显示 `↻ --`
- `writeCache` 在缓存文件被外部写成数组时新条目静默丢失（`typeof [] === "object"` 漏过校验，`JSON.stringify` 丢弃数组上的命名属性）
- `utils-login.mjs` `resolvePosition` 传入负数 position 被错误接受，现增加 `>= 0` 下界

## v2.6.0-2026.08.05

### 新增

- 百分比端点保护 `formatPct`（`utils-query-usage.mjs`）：用量百分比归一为展示整数，两端各留一档——真正 `>=100` 才返回 100、`(99,100)` 一律压到 99；真正 `<=0` 才返回 0、`(0,1)` 一律抬到 1，避免 99.7% 显示成 100%（误以为额度耗尽）、0.3% 显示成 0%（误以为未开始用）；NaN 等非数字脏数据回退 0，±Infinity 越界钳制，函数幂等可重复调用
- `query-usage-all` 输出分组 `groupOutputs`：有效行（成功查到用量）在前、无效行（含错误标记）在后，两组都非空时中间插一个空行分隔；过滤空串与（可选）无活跃套餐行，抽为纯函数便于单测。配套 `msgPart` 只匹配 " | " 之后的数据段，错误标记 / 无活跃套餐判定不再扫整行
- `query-usage-smart` 抽出 `matchAccountByApiKey` 纯函数：按 apiKey 在 config 各账号数组中查找（按 QUERY_FNS 顺序取首个命中），供单测覆盖
- 单元测试：新增 `test/query-usage-all.test.mjs`（分组 / 过滤 / 标签含 ❌ 与「无活跃套餐」字样不误杀）、`test/query-usage-smart.test.mjs`（匹配 key / index、顺序优先、空 apiKey 与空槽位跳过）、`test/utils-cc-switch-getapikey.test.mjs`（getAPIKey 环境变量优先级、PROXY_MANAGED 占位符回退 db 分支）

### 变更

- 颜色 / 百分比分档跟随展示值：`pctColorCode` / `pctSegment` 统一先经 `formatPct` 归一再分档，保证「显示 99%」对应橙色而非红色
- `query-usage-all` 输出顺序调整：错误行不再与有效行混排，统一垫底并以空行分隔（组内仍保持账号顺序）
- `query-usage-smart` 查询函数改经 `QUERY_FNS[matched.key]` 取值（原为循环内捕获的闭包变量）
- `scripts/` 四个 `.cmd` 脚本（login-qwen / login-opencode / preview / query-usage-all）结束提示「按任意键继续…」改为「按任意键退出…」（pause 后脚本即退出）
- 测试加固：`query-usage-opencode-go` 假数据改用确定性索引（i+1）替代 `Math.random()`，消除偶发失败；`utils-query-usage` 宽度相关测试改用 `stubTermWidth` stub `process.stdout.columns`，不再依赖 `COLUMNS` 环境变量

### 修复

- `hideOnMonthlyExhausted` 月度用尽判定改用 `formatPct`：99.6% 等未真正用尽不再因四舍五入成 100% 而整行凭空消失
- 自定义账号标签含 ❌ 前缀或「无活跃套餐」字样时不再被误判为错误行 / 被 `--hide-on-no-active-plan` 静默丢弃（原实现整行匹配，现只匹配数据段）

## v2.5.0-2026.07.30

### 新增

- `--hide-on-no-active-plan` 参数（仅 `all` 脚本生效）：账号无活跃订阅或订阅过期时隐藏该行输出（`true`/`false`，默认 `false`）；`smart` 脚本在两种兜底场景（使用免费模型 / 匹配不到账号）下自动启用，与 `--hide-on-monthly-exhausted` 一同强制隐藏月度用完与无活跃套餐的账号
- 负缓存机制：错误结果单独使用 30s TTL（`NEG_CACHE_TTL_MS`），避免故障期负缓存过期后又等满请求超时反复轰炸上游；正缓存仍为 5s（`CACHE_TTL_MS`）。`readCache` 按 `entry.output` 是否为字符串区分正负缓存并选用对应 TTL
- 统一请求超时常量 `REQUEST_TIMEOUT_MS = 10000`：ark / ollama / opencode-go / qwen 四个查询脚本共用，替换各自硬编码的 3000 / 5000ms；ccstatusline 自定义命令超时建议相应改为大于此值
- 无活跃套餐识别：新增 `NO_ACTIVE_PLAN` 常量，各查询脚本在判定账号无订阅 / 订阅过期降级时抛出含此标记的错误，`all` 脚本据此过滤输出行（匹配 `ERROR_MARK + NO_ACTIVE_PLAN`，不扫整行以免误杀自定义标签）
- Ollama 套餐类型解析：新增 `parsePlanType`，从 settings 页面 "Cloud usage" 标题右侧带 `capitalize` class 的 span 提取套餐类型，`free`（未订阅 / 已过期降级）视为无活跃套餐
- `smart` 脚本匹配不到账号时改为查询全部账号用量（原为静默退出），与免费模型兜底共用 `queryAllFallback`，保证两处显示效果一致
- 错误标记常量 `ERROR_MARK`（`❌` 后随一个空格）：各查询 / 登录脚本的错误前缀统一引用，`all` 脚本过滤无活跃套餐行时据此定位错误消息，与渲染逻辑共用同一常量保持同步

### 变更

- 渲染降噪与精简：移除 10 格进度条 `bar`，`pctSegment` 改为只渲染着色百分比；窗口间分隔符 `|` 与倒计时 `↻` 改用灰色（#808080）降噪，窗口标签改用白色（#E0E0E0），倒计时改用白色与百分比区分；`AUTO` 档宽度估算改用 `_plain` 模式直接生成纯文本测宽，不再先渲染完整 ANSI 再用正则剥色
- 颜色常量重构：`LABEL`（亮白 ANSI 97）改为真彩色 `WHITE`（#E0E0E0），新增 `GRAY`（#808080）；`colorful-tokens` 异常问号同步改用 `WHITE`
- `query-usage-all` 输出顺序调整为 ark → ollama → opencode → qwen；并向各查询函数透传已解析的 `_config`，避免每个账号重复读取 `config.json`
- 错误标签前缀提前解析：ark / opencode-go 在校验凭据前先 `resolvePrefixes`，使缺凭据等早期错误也能用正确的账号 / 类型标签渲染（仅 `loadConfig` / `findAccount` 这类更早的错误回退到默认标签）
- `colorful-tokens` 着色阈值调整：[0,128k) 绿 / [128k,256k) 黄 / [256k,512k) 橙 / [512k,+∞) 红（原为 256k / 384k / 512k 三档），更贴合上下文窗口实际占比
- OpenCodeGo 鉴权失败判定重写：改用 `resp.url` 跳转到 `auth.opencode.ai/authorize` 判定 cookie 过期 / workspace_id 不属于该账号，与「无活跃套餐」（以 `data-slot="subscribe-button"` 正向认定）区分，分别给出修复凭据与允许 smart 兜底隐藏的不同提示
- `preview.mjs` 假数据：火山方舟 `coding` 与 `agent` 样本对调，使颜色按阅读顺序循环
- `scripts/query-usage-all.cmd` 透传 `--hide-on-no-active-plan=false`
- 单元测试：新增 `parsePlanType`（pro / free / 空格大小写 / 缺失场景）、`parseArgs` 的 `hideOnNoActivePlan` 用例；`colorful-tokens` 阈值与边界用例随新档位更新；移除已删除的 `bar` 与 `pctSegment` 进度条用例
- README / README_EN 更新：smart 兜底说明改为「免费模型或匹配不到账号均显示全部」、缓存说明补充「错误结果缓存 30 秒」、ccstatusline 超时建议改为大于 10s、参数表新增 `--hide-on-no-active-plan`

### 修复

- `colorful-tokens` token 字段未强制转数字：若上游传入字符串会字符串拼接而非求和，改用一元 `+` 转数字
- `readCache` 遍历 usage 键时局部变量 `key` 遮蔽外层缓存键，改名为 `usageKey` 消除遮蔽

## v2.4.0-2026.07.27

### 新增

- Ollama Cloud 用量查询：新增 `src/query/query-usage-ollama.mjs`，请求 `ollama.com/settings` 解析 SSR HTML，提取 session（映射 rolling）/ weekly 两个窗口用量；重置时间优先取 `local-time` 元素的 `data-time` 精确时间戳，回退到 "Resets in X hours" 文本时长解析；cookie 失效（3xx 重定向或页面出现登录关键词）时明确提示从浏览器重新获取 `__Secure-session`。Ollama 登录受 Cloudflare 人机验证保护，Playwright 启动的浏览器会被判定为自动化而无法通过，故未提供登录脚本，cookie 需从真实浏览器手动复制
- 上下文 token 着色工具：新增 `src/tools/colorful-tokens.mjs`，作为 ccstatusline / ccstatusline-zh 的自定义命令，从 stdin JSON 读取 `context_window` 的 input+output token 总数按阈值（256k / 384k / 512k）着色输出，颜色复用 `COLORS` 与用量查询配色统一
- 登录公共逻辑重构与交互改进：`src/login/login-common.mjs` 迁移至 `src/utils/utils-login.mjs`；`playwright-core` 未安装时由自动安装改为询问后安装；`position` 越界时交互式重新输入（留空取消）；开浏览器前要求确认（防 position 手误）；浏览器被关闭时询问是否重开；登录期间 config 被改导致 position 丢失时询问是否追加到末尾，取消则把凭据打到 stderr 不丢失
- 配置文件：`config.example.json` / `config.schema.json` 新增 `ollama` 账号数组（`cookie` / `apiKey` / `longLabel` / `shortLabel`）
- `package.json`：新增 `ctx:tokens`（colorful-tokens）与 `query:ollama` scripts
- 单元测试：新增 `test/query-usage-ollama.test.mjs`（HTML 解析、英文时长解析、data-time 优先级与回退、过期钳制为 0）和 `test/colorful-tokens.test.mjs`（四档阈值与边界、k 单位格式化、JSON 解析容错）

### 变更

- 配色升级为 24 位真彩色：`COLORS` 的 GREEN / YELLOW / ORANGE / RED 由标准 ANSI 改为真彩色（#3FB950 / #E3B341 / #D97757 / #EF4444），ORANGE 由 #DE7356 调整为 #D97757
- 默认标签精简：`火山CodingPlan` -> `火山Coding`、`火山AgentPlan` -> `火山Agent`、`千问TokenPlan` -> `千问`
- `query-usage-all.mjs` 接入 Ollama，`QUERY_FNS` 输出顺序为 opencode -> ark -> ollama -> qwen
- `getVisibleWidth` 扩充宽字符判断范围：新增韩文字母 / 音节 / 兼容字母、平假名 / 片假名、CJK 统一汉字扩展 A
- `loadConfig` 区分 `ENOENT`（config.json 不存在）给出「请将 config.example.json 复制为 config.json」明确提示
- `suppressExperimentalWarning`（`utils-cc-switch.mjs`）导出供测试调用
- `login-qwen.mjs`：`waitForLoadState("networkidle")` 加 10s 超时避免无限等待
- `query-usage-opencode-go.mjs`：文件头与函数注释中 `OpenCodeGo` 统一为 `OpenCode Go`
- `preview.mjs` 假数据调整：按阅读顺序循环绿 / 黄 / 橙 / 红四档颜色，新增 Ollama 样本
- `playwright-core` 升级 ^1.61.1 -> ^1.62.0
- README / README_EN 大幅更新：新增 Ollama Cloud 章节与获取方式对照表、npm scripts 快捷运行说明、登录 `position` 取值与交互说明、配置字段表格重排、「CC Switch」统一为「CC-Switch」

### 修复

- `readCache` 不再为不存在的窗口凭空造出 null：改为按 `entry.usage` 实际键遍历，修复前硬编码 rolling / weekly / monthly 三窗口导致千问、Ollama 等无 monthly 的平台读缓存时多出一个 null 窗口
- `login-qwen.mjs` 用户取消登录（`runLogin` 返回 null）后访问 `result.cookie` 空指针：改为 `result?.cookie`

## v2.3.0-2026.07.25

### 新增

- 阿里云千问 Token Plan（个人版）用量查询：新增 `src/query/query-usage-qwen.mjs`，通过控制台 cookie 调用内部数据网关，解析五小时 / 每周两个窗口（千问无月度窗口）；cookie 失效时提示运行登录命令重新登录
- 千问 / OpenCodeGo 自动登录：新增 `src/login/`（`login-qwen.mjs`、`login-opencode.mjs` 及公共逻辑 `login-common.mjs`），用 Playwright 启动系统 Edge 引导登录，按 `key+position` 隔离持久化 profile，登录成功自动写回 `config.json`；`playwright-core` 未安装时自动安装
- 用量预览工具：新增 `src/tools/preview.mjs`，用模拟数据在终端预览各百分比档位的显示效果，无需真实账号
- `scripts/` 目录：Windows 双击运行脚本（`chcp 65001` UTF-8），含 `query-usage-all.cmd`、`login-qwen.cmd`、`login-opencode.cmd`、`preview.cmd`
- `package.json`：新增 `query:qwen` / `login:qwen` / `login:opencode` scripts 与 devDependency `playwright-core`
- 配置文件：`config.example.json` / `config.schema.json` 新增 `qwen` 账号数组（`cookie` / `apiKey` / `longLabel` / `shortLabel`）
- 单元测试：新增 `test/query-usage-qwen.test.mjs`（千问响应解析），既有测试随渲染与缓存改动同步更新
- `test/utils-cc-switch.test.mjs`：用临时 SQLite 文件集成测试 `lookupProviderInDb` 的命中 / 未命中 / `app_type` 过滤 / db 损坏场景

### 变更

- 目录重组：`CHANGELOG.md`、`README_EN.md`、`preview.png` 移至 `docs/`；`query-usage-all.cmd` 从 `src/query/` 移至 `scripts/`
- 缓存文件改名：`tmp/usage-cache.json` → `tmp/cache-usage.json`
- 渲染泛化：`utils-query-usage.mjs` 新增 `WINDOW` / `WINDOW_LABELS` 枚举，`renderWindows` 由硬编码三窗口改为按窗口键遍历 `usage` 中存在的窗口——平台无某窗口（如千问无月度）时不输出；缺失数据占位符由 `—` 改为 `--`
- `query-usage-all.mjs` / `query-usage-smart.mjs` 接入千问，`QUERY_FNS` 输出与匹配顺序为 opencode → ark → qwen
- `getAPIKey`（`utils-cc-switch.mjs`）移除默认参数 `id = getCurrentProviderId()`，改为在环境变量短路返回之后再获取当前供应商 id（环境变量已有 key 时不再强制读取 `settings.json`）；`settings_config.env` 缺少 key 时给出明确报错
- OpenCodeGo cookie 过期 / 无效（HTTP 401/403 或页面关键词）时，错误提示明确引导运行 `login-opencode.cmd` 重新登录
- `.gitignore` 新增忽略 `node_modules/`
- README 更新：新增千问、登录脚本、预览工具说明与英文版链接
- 千问非 200 响应读取响应体并附上错误详情（`errorMsg`/`message`），与火山方舟的 `callOpenApi` 错误处理对齐
- `lookupProviderInDb`（`utils-cc-switch.mjs`）捕获 SQLite 异常并包装为「CC-Switch 数据库读取失败」友好提示，便于定位故障来源
- `openDb`（`utils-cc-switch.mjs`）支持 `CC_SWITCH_DB_PATH` 环境变量重定向 db 路径，供集成测试注入临时文件

### 修复

- 配置类错误（config 读取失败 / 账号越界 / 缺凭据）不再写负缓存：仅对已进入网络查询阶段后的失败写负缓存，避免无意义的负缓存写入，以及配置在 TTL 内修复后短暂显示旧错误

## v2.2.0-2026.07.21

### 新增

- 查询结果缓存：smart 入口带 5 秒 TTL 缓存（`tmp/usage-cache.json`，已 gitignore），命中时跳过网络请求，查询失败也写负缓存防止高频重试；手动运行各子脚本仍为实时查询
- `package.json`：声明 `type: module`、Node 版本要求与 npm scripts
- 单元测试：`test/` 目录，基于 `node:test`，覆盖渲染、参数解析、缓存、响应解析等纯函数（ark/opencode 的解析函数同步改为导出供测试调用）

### 变更

- 架构重构：子进程调用改为进程内函数调用，各查询脚本改为「导出函数 + CLI 壳」双入口模式，`smart`/`all` 直接 import 调用，全链路零子进程启动开销；各脚本仍可独立运行，输出格式不变
- `utils-query-usage.mjs`：移除 `safeExec`/`safeExecAsync`/`SCRIPTS`/`HELPER`；新增 `readCache`/`writeCache`/`fetchUsageCached`/`isMainModule`/`renderErrorLine`/`COLORS` 颜色常量
- `get-actual-model.mjs` 抽出纯函数 `getActualModel(raw)` 供 smart 进程内调用
- `query-usage-all.mjs` 不再接受 `--type`：各 ark 账号一律用自己的 `type` 配置，避免全局参数覆盖账号配置
- `query-usage-smart.mjs`：入口改为 `isMainModule` 守卫，错误兜底改用 `process.stdout.write`，与其他脚本统一

### 修复

- 修复 `--type` 命令行默认值覆盖账号 `type` 配置的问题：`parseArgs` 不再为 `--type` 提供默认值，未传时正确回退到账号 `type`，再回退 `coding`

## v2.1.0-2026.07.18

### 新增

- `--hide-on-monthly-exhausted` 参数：月度额度耗尽时隐藏该行输出（`true`/`false`，默认 `false`）；smart 脚本使用免费模型查询全部账号时自动启用，过滤已耗尽的账号
- 用量行前缀着色（薰衣草蓝），错误提示前缀同步着色

### 变更

- `query-usage-all.bat` 变更为 `query-usage-all.cmd`
- `query-usage-all.mjs` 过滤子脚本的空输出，避免隐藏行留下空行
- `query-usage-ark.mjs` 拆分 `fetchUsage` 与 `renderWindows`，隐藏逻辑统一收敛到 `renderWindows`
- `query-usage-smart.mjs` 重构参数透传：非免费模型分支只传必要参数（position/display/type），不再透传用户传入的 `--type` 等参数
- `get-actual-model.mjs` 判断路由模式时 `ANTHROPIC_BASE_URL` 优先取环境变量，再回退 `settings.json`

## v2.0.1-2026.07.13

### 修复

- 修复通过 CC Launcher / `claude --settings` 启动 Claude Code 时 `getAPIKey` 读取的是 CC-Switch 全局当前供应商、而非实际注入供应商的 API Key 的问题：改为优先从环境变量 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` 读取，遇到 `PROXY_MANAGED` 占位符则回退到数据库查询

### 变更

- README 项目结构展示从表格改为树形代码块，新增"相关项目"章节介绍 CC Launcher
- `.gitignore` 新增忽略 `.claude/` 目录

## v2.0.0-2026.07.11

### 新增

- 多账号支持：配置文件改为数组，可同时配置多个账号，通过 `--position` 参数指定查询的账号
- CC-Switch 集成：新增 `src/utils/utils-cc-switch.mjs`，读取当前供应商信息与 API Key
- 智能显示模式：`--display auto` 按终端宽度自动选择长版或短版输出
- 自定义标签：每个账号可配置 `longLabel`/`shortLabel`，便于区分多个账号
- JSON Schema 校验：新增 `config/config.schema.json`，编辑器可据此提供字段提示
- 并行查询：`query-usage-all.mjs` 并行执行各子脚本

### 变更

- ⚠️ 目录结构重构：脚本从根目录移至 `src/query/`、`src/tools/` 和 `src/utils/`，配置文件移至 `config/`
- ⚠️ 配置文件格式变更：从单账号对象改为多账号数组，旧配置需迁移
- ⚠️ 命令行参数改为命名式：统一使用 `--display`/`-d`、`--type`/`-t`、`--position`/`-p`，不再支持位置参数（如 `node query-usage-ark.mjs agent` 需改为 `--type agent`）
- ⚠️ smart 脚本改用 CC-Switch：通过读取 `~/.cc-switch` 的 `settings.json` 和 SQLite 数据库匹配当前供应商，不再依赖 `ANTHROPIC_BASE_URL`
- ⚠️ Node.js 版本要求提升至 22.13+：依赖 `node:sqlite` 内置模块读取 CC-Switch 数据库（22.13 起默认可用，无需加 `--experimental-sqlite` 标志）
- ⚠️ 脚本重命名：`query-usage-utils.mjs` -> `utils-query-usage.mjs`
- 百分比按用量分档着色（0-59% 绿 / 60-79% 黄 / 80-99% 橙 / 100% 红）
- 使用免费模型时改为显示全部账号用量（原为不显示）
- 屏蔽 `node:sqlite` 的 ExperimentalWarning
- `get-actual-model.mjs` 路由模式不再硬编码 opus/sonnet/haiku/fable 档位，改为遍历 `settings.json` 中配对的 `ANTHROPIC_DEFAULT_*_MODEL_NAME`/`_MODEL` 自动匹配
- `get-actual-model.mjs` 异常提示改为中文
- `parseCodingPlanResponse` 精简为 API 实际返回字段（`QuotaUsage`/`Level`/`Percent`/`ResetTimestamp`）

## v1.1.1-2026.07.04

### 变更

- 优化 README 的描述与排版

## v1.1.0-2026.07.04

### 新增

- 火山方舟 Agent Plan 用量查询
- `query-usage-all.bat`，Windows 下可双击运行
- 提取 `query-usage-utils.mjs` 共享工具函数（safeExec、进度条、倒计时、着色）

### 变更

- 全面重构为 ES Module（`.js` -> `.mjs`）
- 火山方舟改用**火山引擎 OpenAPI（AK/SK 签名 V4）**，不再依赖浏览器 cookie
- 拆分 `query-usage-all.mjs` 和 `query-usage-smart.mjs`，分别实现全部查询和自动匹配查询
- `query-usage-smart.mjs` 在使用免费模型时，不显示套餐用量

## v1.0.0-2026.07.03

### 新增

- OpenCodeGo 用量查询（SSR HTML 页面解析）
- 火山方舟 Coding Plan 用量查询（浏览器 cookie + X-CSRF-Token）
- 根据 `ANTHROPIC_BASE_URL` 自动匹配并运行对应查询脚本
- 输出百分比 + 进度条 + 重置倒计时
