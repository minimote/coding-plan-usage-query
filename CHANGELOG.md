# 更新日志

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
