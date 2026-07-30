# 更新日志

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
