# CodingPlan Usage Query

<div align="center">

<img src="https://img.shields.io/badge/Node.js-22.13%2B-5FA04E?logo=nodedotjs&logoColor=white" alt="Node.js 22.13+ required">
<img src="https://img.shields.io/github/license/minimote/coding-plan-usage-query?color=blue&label=%C2%A9%20License" alt="License">

</div>

<p>

<div align="center">
    中文 | <a href="README_EN.md">English</a>
    &emsp;----&emsp;
    <a href="https://gitee.com/minimote/coding-plan-usage-query">Gitee</a> | <a href="https://github.com/minimote/coding-plan-usage-query">GitHub</a>
</div>

<p>

> 查询各平台 Coding Plan 的套餐用量和重置倒计时，推荐搭配 [ccstatusline](https://github.com/sirmalloc/ccstatusline) / [ccstatusline-zh](https://github.com/huangguang1999/ccstatusline-zh) 的自定义命令放在 Claude Code 状态栏查看。

## 支持的套餐

|               套餐                |     获取方式     |
| :-------------------------------: | :--------------: |
| 火山方舟 Coding Plan / Agent Plan | 火山引擎 OpenAPI |
|            OpenCode Go            |  页面 HTML 解析  |

## 效果预览

![Preview](preview.png)

## 项目结构

```text
coding-plan-usage-query/
├── config/
│   ├── config.example.json                # 配置模板
│   └── config.schema.json                 # JSON Schema 校验
└── src/
    ├── query/
    │   ├── query-usage-all.bat            # Windows 双击运行
    │   ├── query-usage-all.mjs            # 并行查询全部套餐
    │   ├── query-usage-ark.mjs            # 火山方舟用量查询
    │   ├── query-usage-opencode-go.mjs    # OpenCodeGo 用量查询
    │   └── query-usage-smart.mjs          # 按 CC-Switch 自动匹配
    ├── tools/
    │   └── get-actual-model.mjs           # 反推真实模型名称
    └── utils/
        ├── utils-query-usage.mjs           # 共享工具函数
        └── utils-cc-switch.mjs             # CC-Switch 工具
```

## 前置要求

- Node.js 22.13 或更高版本（使用 `node:sqlite` 内置模块，实验性警告已自动屏蔽）

## 快速开始

### 1. 创建配置文件

将 `config/config.example.json` 复制为 `config/config.json`。

### 2. 填写配置文件

打开 `config.json`，按 `config.schema.json` 中的字段说明填入凭据：

- **火山方舟**：在火山引擎控制台创建 AccessKey，填入 `accessKeyId` 和 `secretAccessKey`
- **OpenCodeGo**：登录后从浏览器 Cookie 中获取 `auth` 值，从地址栏获取 `workspaceID`

详细说明见下方 [配置文件说明](#配置文件说明)。

### 3. 运行查询

```bash
# 根据 CC-Switch 当前供应商自动判断显示哪个套餐
node src/query/query-usage-smart.mjs

# 查询所有套餐
node src/query/query-usage-all.mjs

# 火山方舟 Coding Plan（默认）
node src/query/query-usage-ark.mjs

# 火山方舟 Agent Plan
node src/query/query-usage-ark.mjs --type agent

# OpenCodeGo
node src/query/query-usage-opencode-go.mjs

# 指定账号位置（从 0 开始）
node src/query/query-usage-ark.mjs --position 1
```

## 命令行参数

|     参数     | 缩写 | 说明                                                         |
| :----------: | :--: | ------------------------------------------------------------ |
| `--display`  | `-d` | 显示模式：`auto`（默认，`a`）/ `long`（`l`）/ `short`（`s`） |
|   `--type`   | `-t` | 火山方舟套餐类型：`coding`（默认，`c`）/ `agent`（`a`）      |
| `--position` | `-p` | 账号位置（从 0 开始，默认 0）                                |

## 配置文件说明

配置文件 `config/config.json` 顶层为 JSON 对象，包含 `ark` 和 `opencode` 两个数组，分别对应火山方舟和 OpenCodeGo 的账号列表，每个数组支持多账号。`apiKey` 字段用于 `query-usage-smart.mjs` 匹配当前供应商，不使用 smart 脚本可不填。

### 火山方舟

```json
{
    "ark": [
        {
            "apiKey": "xxx",
            "type": "coding",
            "longLabel": "火山CodingPlan",
            "shortLabel": "Coding",
            "accessKeyId": "xxx",
            "secretAccessKey": "xxx"
        },
        {
            "apiKey": "xxx",
            "type": "agent",
            "longLabel": "火山AgentPlan",
            "shortLabel": "Agent",
            "accessKeyId": "xxx",
            "secretAccessKey": "xxx"
        }
    ]
}
```

|            字段            | 必填 | 说明                                                                   |
| :------------------------: | :--: | ---------------------------------------------------------------------- |
|           `type`           |  否  | 套餐类型：`coding`（默认）或 `agent`                                   |
| `longLabel` / `shortLabel` |  否  | 显示标签，不填使用默认值（火山CodingPlan/Coding、火山AgentPlan/Agent） |
|       `accessKeyId`        |  是  | 火山引擎 AccessKey ID                                                  |
|     `secretAccessKey`      |  是  | 火山引擎 SecretAccessKey                                               |
|          `apiKey`          |  否  | CC-Switch 里填的 API Key，smart 脚本据此匹配账号                       |

> 在火山引擎控制台 <https://console.volcengine.com/iam/keymanage> 创建 AccessKey
> 子账户需具有 `AccessKeySelfManageAccess` 和 `ArkReadOnlyAccess` 权限

### OpenCodeGo

```json
{
    "opencode": [
        {
            "authCookie": "xxx",
            "workspaceID": "wrk_xxx",
            "apiKey": "xxx"
        }
    ]
}
```

|            字段            | 必填 | 说明                                                   |
| :------------------------: | :--: | ------------------------------------------------------ |
| `longLabel` / `shortLabel` |  否  | 显示标签，不填使用默认值（OpenCodeGo/Go）              |
|        `authCookie`        |  是  | 登录 opencode.ai/auth 后从浏览器 Cookie 复制 auth 的值 |
|       `workspaceID`        |  是  | 工作区 ID，登录后在网址栏获取，类似 `wrk_...`          |
|          `apiKey`          |  否  | CC-Switch 里填的 API Key，smart 脚本据此匹配账号       |

> F12 -> 应用程序(Application) -> Cookies -> opencode.ai -> auth

## 自动匹配账号

`query-usage-smart.mjs` 的工作流程：

1. 读取 `~/.cc-switch/settings.json` 的 `currentProviderClaude` 获取当前供应商
2. 读取 `~/.cc-switch/cc-switch.db` 获取当前供应商的 API Key
3. 在 `config.json` 中匹配 `apiKey` 字段相同的账号
4. 调用对应子脚本查询用量

> 检测到免费模型时，改为显示全部账号用量
> 匹配不到账号时静默退出（不输出任何内容）

## 搭配 ccstatusline / ccstatusline-zh 使用

推荐将 `query-usage-smart.mjs` 配置为 ccstatusline / ccstatusline-zh 的自定义命令，放在 Claude Code 状态栏实时查看（需使用绝对路径）：

```bash
node F:/xxx/query-usage-smart.mjs
```

- 自定义命令超时建议设为 6000ms
- 如需显示彩色百分比，请在 ccstatusline / ccstatusline-zh 中将自定义命令设置为保留颜色

## 更新日志

[CHANGELOG](CHANGELOG.md)

## 相关项目

- **CC Launcher**（[Gitee](https://gitee.com/minimote/cc-launcher) | [GitHub](https://github.com/minimote/cc-launcher)）：使用指定的 CC-Switch 供应商启动 Claude Code，可同时运行多个不同供应商的 Claude Code 实例，不影响 CC-Switch 的全局激活状态。

## License

[MIT License](LICENSE)
