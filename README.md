# CodingPlan Usage Query

<div align="center">

<img src="https://img.shields.io/badge/Node.js-22.13%2B-5FA04E?logo=nodedotjs&logoColor=white" alt="Node.js 22.13+ required">
<img src="https://img.shields.io/github/license/minimote/coding-plan-usage-query?color=blue&label=%C2%A9%20License" alt="License">

</div>

<p>

<div align="center">
    中文 | <a href="docs/README_EN.md">English</a>
    &emsp;----&emsp;
    <a href="https://gitee.com/minimote/coding-plan-usage-query">Gitee</a> | <a href="https://github.com/minimote/coding-plan-usage-query">GitHub</a>
</div>

<p>

> 查询各平台 Coding Plan 的套餐用量和重置倒计时，推荐搭配 [ccstatusline](https://github.com/sirmalloc/ccstatusline) / [ccstatusline-zh](https://github.com/huangguang1999/ccstatusline-zh) 的自定义命令放在 Claude Code 状态栏查看。

## 支持的套餐

|               套餐                |        获取方式         |
| :-------------------------------: | :---------------------: |
| 火山方舟 Coding Plan / Agent Plan | 火山引擎 OpenAPI(AK/SK) |
|           Ollama Cloud            | 页面 HTML 解析(cookie)  |
|            OpenCode Go            | 页面 HTML 解析(cookie)  |
|       阿里云千问 Token Plan       | 控制台内部 API(cookie)  |

## 效果预览

![Preview](docs/preview.png)

> 运行 `scripts/preview.cmd`（或 `node src/tools/preview.mjs`）可用模拟数据预览显示效果。

## 项目结构

```text
coding-plan-usage-query/
├── config/
│   ├── config.example.json                # 配置模板
│   └── config.schema.json                 # JSON Schema 校验
├── docs/
│   ├── CHANGELOG.md                       # 更新日志
│   ├── README_EN.md                       # 英文版 README
│   └── preview.png                        # 效果预览图
├── scripts/
│   ├── login-opencode.cmd                 # Windows 双击登录 OpenCode Go
│   ├── login-qwen.cmd                     # Windows 双击登录千问
│   ├── preview.cmd                        # Windows 双击预览显示效果
│   └── query-usage-all.cmd                # Windows 双击运行（UTF-8 chcp 65001）
├── src/
│   ├── login/
│   │   ├── login-opencode.mjs             # OpenCode Go 登录
│   │   └── login-qwen.mjs                 # 千问登录
│   ├── query/
│   │   ├── query-usage-all.mjs            # 查询全部套餐（并行）
│   │   ├── query-usage-ark.mjs            # 火山方舟用量查询
│   │   ├── query-usage-ollama.mjs         # Ollama Cloud 用量查询
│   │   ├── query-usage-opencode-go.mjs    # OpenCode Go 用量查询
│   │   ├── query-usage-qwen.mjs           # 千问 Token Plan 用量查询
│   │   └── query-usage-smart.mjs          # 智能查询：根据实际使用的套餐自动匹配（带 5 秒缓存）
│   ├── tools/
│   │   ├── colorful-tokens.mjs            # 上下文 token 数按阈值着色
│   │   ├── get-actual-model.mjs           # 获取真实模型名称
│   │   └── preview.mjs                    # 生成模拟用量预览输出
│   └── utils/
│       ├── utils-cc-switch.mjs            # CC-Switch 工具
│       ├── utils-login.mjs                # 登录公共逻辑（Playwright、profile、写回 config）
│       └── utils-query-usage.mjs          # 共享工具函数
├── test/                                  # 单元测试（node --test）
└── tmp/                                   # 查询结果缓存与登录 profile（自动生成，已 gitignore）
```

各查询脚本为「导出函数 + CLI 壳」双入口：既可直接 `node` 运行，也被 `smart`/`all` 以进程内函数调用，避免子进程启动开销。

## 前置要求

- Node.js 22.13 或更高版本（使用 `node:sqlite` 内置模块，实验性警告已自动屏蔽）

## 快速开始

### 1. 创建配置文件

将 `config/config.example.json` 复制为 `config/config.json`。

### 2. 填写配置文件

打开 `config.json`，按 `config.schema.json` 中的字段说明填入凭据：

- **火山方舟 Coding Plan / Agent Plan**：在火山引擎控制台创建 AccessKey，填入 `accessKeyId` 和 `secretAccessKey`
- **Ollama Cloud**：根据 `config.schema.json` 提示填写 `cookie`
- **OpenCode Go**：运行 `login-opencode.cmd` 自动写入 `authCookie` 和 `workspaceID`，或根据 `config.schema.json` 提示填写
- **阿里云千问 Token Plan**：运行 `login-qwen.cmd` 自动写入 `cookie`，或根据 `config.schema.json` 提示填写

详细说明见下方 [配置文件说明](#配置文件说明)。

### 3. 运行查询

```bash
# 智能查询：根据实际使用的套餐自动匹配（带 5 秒缓存）
node src/query/query-usage-smart.mjs

# 查询所有套餐
node src/query/query-usage-all.mjs

# 火山方舟（用账号 type 配置，默认 coding）
node src/query/query-usage-ark.mjs

# 火山方舟 Agent Plan（强制指定）
node src/query/query-usage-ark.mjs --type agent

# Ollama Cloud
node src/query/query-usage-ollama.mjs

# OpenCode Go
node src/query/query-usage-opencode-go.mjs

# 阿里云千问
node src/query/query-usage-qwen.mjs

# 使用浏览器登录千问，自动读取凭据
node src/login/login-qwen.mjs

# 使用浏览器登录 OpenCode Go，自动读取凭据
node src/login/login-opencode.mjs

# 指定账号位置（从 0 开始）
node src/query/query-usage-ark.mjs --position 1

# 预览显示效果
node src/tools/preview.mjs
```

> 上述命令也可通过 npm scripts 快捷运行：`npm run query`（smart）、`npm run query:all`、`npm run query:ark`/`query:ollama`/`query:opencode`/`query:qwen`（各套餐）、`npm run login:qwen`/`login:opencode`（登录）。透传参数时需加 `--`，如 `npm run query:ark -- --type agent`。

## 命令行参数

查询脚本支持以下参数：

|             参数              | 缩写 | 说明                                                                                                               |
| :---------------------------: | :--: | ------------------------------------------------------------------------------------------------------------------ |
|          `--display`          | `-d` | 显示模式：`auto`（默认，`a`）/ `long`（`l`）/ `short`（`s`）                                                       |
|           `--type`            | `-t` | 火山方舟套餐类型：`coding`（`c`）/ `agent`（`a`），未传时用账号 `type` 配置，再回退 `coding`（all/smart 脚本忽略） |
|         `--position`          | `-p` | 账号位置（从 0 开始，默认 0）                                                                                      |
| `--hide-on-monthly-exhausted` |  -   | 月额度耗尽时不输出该条查询（`true`/`false`，默认 `false`，smart 脚本忽略该参数）                                   |

> 登录脚本（`login-qwen`/`login-opencode`）仅支持 `--position`/`-p` 参数。`position` 取 0~N（N 为当前账号数）：`< N` 更新已有账号，`= N` 新建第 N+1 个账号；越界时会提示重新输入，开浏览器前会要求确认。

## 配置文件说明

配置文件 `config/config.json` 顶层为 JSON 对象，包含 `ark`、`ollama`、`opencode`、`qwen` 四个数组，分别对应火山方舟、Ollama、OpenCode、千问的账号列表，每个数组支持多账号。`apiKey` 字段用于 `query-usage-smart.mjs` 匹配当前供应商，不使用 smart 脚本可不填。

### 火山方舟 Coding Plan / Agent Plan

```json
{
    "ark": [
        {
            "shortLabel": "Coding",
            "longLabel": "火山Coding",
            "apiKey": "xxx",
            "type": "coding",
            "accessKeyId": "xxx",
            "secretAccessKey": "xxx"
        },
        {
            "shortLabel": "Agent",
            "longLabel": "火山Agent",
            "apiKey": "xxx",
            "type": "agent",
            "accessKeyId": "xxx",
            "secretAccessKey": "xxx"
        }
    ]
}
```

|            字段            | 必填 | 说明                                                           |
| :------------------------: | :--: | -------------------------------------------------------------- |
|           `type`           |  否  | 套餐类型：`coding`（默认）或 `agent`                           |
| `longLabel` / `shortLabel` |  否  | 显示标签，不填使用默认值（火山Coding/Coding、火山Agent/Agent） |
|       `accessKeyId`        |  是  | 火山引擎 AccessKey ID                                          |
|     `secretAccessKey`      |  是  | 火山引擎 SecretAccessKey                                       |
|          `apiKey`          |  否  | CC-Switch 里填的 API Key，smart 脚本据此匹配账号               |

在火山引擎控制台 <https://console.volcengine.com/iam/keymanage> 创建 AccessKey（子账户需具有 `AccessKeySelfManageAccess` 和 `ArkReadOnlyAccess` 权限）。

### Ollama Cloud

```json
{
    "ollama": [
        {
            "apiKey": "xxx",
            "shortLabel": "Ollama",
            "longLabel": "Ollama",
            "cookie": "xxx"
        }
    ]
}
```

|            字段            | 必填 | 说明                                                       |
| :------------------------: | :--: | :--------------------------------------------------------- |
| `longLabel` / `shortLabel` |  否  | 显示标签，不填使用默认值（Ollama/Ollama）                  |
|          `cookie`          |  是  | `__Secure-session` cookie 的值，从浏览器 DevTools 手动复制 |
|          `apiKey`          |  否  | CC-Switch 里填的 API Key，smart 脚本据此匹配账号           |

> Ollama 登录受 Cloudflare 人机验证保护，Playwright 启动的浏览器会被判定为自动化而无法通过验证，故未提供登录脚本。请登录 <https://ollama.com> 后从浏览器 DevTools -> Application -> Cookies 复制 `__Secure-session` 的值填入配置。

### OpenCode Go

```json
{
    "opencode": [
        {
            "apiKey": "xxx",
            "shortLabel": "Go",
            "longLabel": "OpenCodeGo",
            "workspaceID": "wrk_xxx",
            "authCookie": "xxx"
        }
    ]
}
```

|            字段            | 必填 | 说明                                                           |
| :------------------------: | :--: | :------------------------------------------------------------- |
| `longLabel` / `shortLabel` |  否  | 显示标签，不填使用默认值（OpenCodeGo/Go）                      |
|        `authCookie`        |  是  | opencode.ai 的 auth cookie，运行 `login-opencode.cmd` 自动填充 |
|       `workspaceID`        |  是  | 工作区 ID，形如 `wrk_...`，运行 `login-opencode.cmd` 自动填充  |
|          `apiKey`          |  否  | CC-Switch 里填的 API Key，smart 脚本据此匹配账号               |

### 阿里云千问 Token Plan

```json
{
    "qwen": [
        {
            "shortLabel": "千问",
            "longLabel": "千问",
            "apiKey": "sk-sp-xxx",
            "cookie": "xxx"
        }
    ]
}
```

|            字段            | 必填 | 说明                                                  |
| :------------------------: | :--: | ----------------------------------------------------- |
| `longLabel` / `shortLabel` |  否  | 显示标签，不填使用默认值（千问/千问）                 |
|          `cookie`          |  是  | 千问控制台登录 cookie，运行 `login-qwen.cmd` 自动填充 |
|          `apiKey`          |  否  | CC-Switch 里填的 API Key，smart 脚本据此匹配账号      |

## 自动匹配账号

`query-usage-smart.mjs` 的工作流程：

1. 读取 `~/.cc-switch/settings.json` 的 `currentProviderClaude` 获取当前供应商
2. 获取当前供应商的 API Key（优先环境变量 `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY`，代理模式回退查询 `~/.cc-switch/cc-switch.db`）
3. 在 `config.json` 中匹配 `apiKey` 字段相同的账号
4. 进程内调用对应查询函数获取用量

说明：

- 检测到免费模型时，改为显示全部账号用量
- 匹配不到账号时静默退出（不输出任何内容）
- 查询结果缓存 5 秒（`tmp/cache-usage.json`），减少高频刷新时的 API 请求
- 手动运行子脚本时不使用缓存

## 搭配 ccstatusline / ccstatusline-zh 使用

推荐将 `query-usage-smart.mjs` 配置为 ccstatusline / ccstatusline-zh 的自定义命令，放在 Claude Code 状态栏实时查看（需使用绝对路径）：

```bash
node F:/xxx/query-usage-smart.mjs
```

- 自定义命令超时建议设为 6000ms
- 如需显示彩色百分比，请在 ccstatusline / ccstatusline-zh 中将自定义命令设置为保留颜色

## 更新日志

[CHANGELOG](docs/CHANGELOG.md)

## 相关项目

- **CC Launcher**（[Gitee](https://gitee.com/minimote/cc-launcher) | [GitHub](https://github.com/minimote/cc-launcher)）：使用指定的 CC-Switch 供应商启动 Claude Code，可同时运行多个不同供应商的 Claude Code 实例，不影响 CC-Switch 的全局激活状态。

## License

[MIT License](LICENSE)
