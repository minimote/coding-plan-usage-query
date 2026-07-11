# CodingPlan Usage Query

<div align="center">

<img src="https://img.shields.io/badge/Node.js-22.13%2B-5FA04E?logo=nodedotjs&logoColor=white" alt="Node.js 22.13+ required">
<img src="https://img.shields.io/github/license/minimote/coding-plan-usage-query?color=blue&label=%C2%A9%20License" alt="License">

</div>

<p>

<div align="center">
    <a href="README.md">中文</a> | English
    &emsp;----&emsp;
    <a href="https://gitee.com/minimote/coding-plan-usage-query">Gitee</a> | <a href="https://github.com/minimote/coding-plan-usage-query">GitHub</a>
</div>

<p>

> Query Coding Plan usage and reset countdown across platforms. Outputs percentage, progress bar, and reset countdown in a single line — perfect for the Claude Code status bar. Recommended for use with [ccstatusline](https://github.com/sirmalloc/ccstatusline) / [ccstatusline-zh](https://github.com/huangguang1999/ccstatusline-zh).

## Supported Plans

|                  Plan                   |  How to get data   |
| :-------------------------------------: | :----------------: |
| Volcengine Ark Coding Plan / Agent Plan | Volcengine OpenAPI |
|               OpenCode Go               | HTML page parsing  |

## Preview

![Preview](preview.png)

## Project Structure

|  Directory   | File                          | Description                                                                               |
| :----------: | :---------------------------- | :---------------------------------------------------------------------------------------- |
|  `config/`   | `config.example.json`         | Configuration template — copy to `config.json` and fill in                                |
|              | `config.schema.json`          | JSON Schema for editor field hints                                                        |
| `src/query/` | `query-usage-all.bat`         | Double-click to run on Windows, quickly view all platforms                                |
|              | `query-usage-all.mjs`         | Query all plans in parallel, suitable for multi-platform usage                            |
|              | `query-usage-ark.mjs`         | Volcengine Ark Coding Plan / Agent Plan query, can be used standalone                     |
|              | `query-usage-opencode-go.mjs` | OpenCodeGo usage query, can be used standalone                                            |
|              | `query-usage-smart.mjs`       | Auto-match account based on CC-Switch current provider                                    |
| `src/tools/` | `get-actual-model.mjs`        | Resolve the actual model name from Claude config, requires ccstatusline / ccstatusline-zh |
| `src/utils/` | `utils-query-usage.mjs`       | Shared utilities (arg parsing, subprocess, progress bar, countdown, colors)               |
|              | `utils-cc-switch.mjs`         | CC-Switch utilities (current provider detection and API Key reading)                      |

## Prerequisites

- Node.js 22.13 or later (uses built-in `node:sqlite` module; experimental warning is suppressed automatically)

## Quick Start

### 1. Create config file

Copy `config/config.example.json` to `config/config.json`.

### 2. Fill in credentials

Open `config.json` and fill in credentials according to `config.schema.json`:

- **Volcengine Ark**: Create an AccessKey in the Volcengine console, fill in `accessKeyId` and `secretAccessKey`
- **OpenCodeGo**: Log in to opencode.ai, extract `auth` from browser cookies, get `workspaceID` from address bar

See [Configuration](#configuration) below for details.

### 3. Run queries

```bash
# Auto-match based on CC-Switch current provider
node src/query/query-usage-smart.mjs

# Query all plans
node src/query/query-usage-all.mjs

# Volcengine Ark Coding Plan (default)
node src/query/query-usage-ark.mjs

# Volcengine Ark Agent Plan
node src/query/query-usage-ark.mjs --type agent

# OpenCodeGo
node src/query/query-usage-opencode-go.mjs

# Specify account position (0-indexed)
node src/query/query-usage-ark.mjs --position 1
```

## Command Line Arguments

|   Argument   | Short | Description                                                        |
| :----------: | :---: | ------------------------------------------------------------------ |
| `--display`  | `-d`  | Display mode: `auto` (default, `a`) / `long` (`l`) / `short` (`s`) |
|   `--type`   | `-t`  | Volcengine Ark plan type: `coding` (default, `c`) / `agent` (`a`)  |
| `--position` | `-p`  | Account position (0-indexed, default 0)                            |

## Configuration

`config/config.json` is a JSON object with two keys: `ark` (Volcengine Ark accounts) and `opencode` (OpenCodeGo accounts). Each key holds an array of account objects. Multiple accounts are supported. The `apiKey` field is used by `query-usage-smart.mjs` to match the current provider; leave it empty if not using the smart script.

### Volcengine Ark

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

|           Field            | Required | Description                                                                     |
| :------------------------: | :------: | ------------------------------------------------------------------------------- |
|           `type`           |    No    | Plan type: `coding` (default) or `agent`                                        |
| `longLabel` / `shortLabel` |    No    | Display label, defaults to `火山CodingPlan`/`Coding` or `火山AgentPlan`/`Agent` |
|       `accessKeyId`        |   Yes    | Volcengine AccessKey ID                                                         |
|     `secretAccessKey`      |   Yes    | Volcengine SecretAccessKey                                                      |
|          `apiKey`          |    No    | CC-Switch API Key for matching current account                                  |

> Create an AccessKey at <https://console.volcengine.com/iam/keymanage>
> Sub-accounts need `AccessKeySelfManageAccess` and `ArkReadOnlyAccess` permissions

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

|           Field            | Required | Description                                       |
| :------------------------: | :------: | ------------------------------------------------- |
| `longLabel` / `shortLabel` |    No    | Display label, defaults to `OpenCodeGo`/`Go`      |
|        `authCookie`        |   Yes    | `auth` value from browser cookies on opencode.ai  |
|       `workspaceID`        |   Yes    | Workspace ID from the address bar, e.g. `wrk_...` |
|          `apiKey`          |    No    | CC-Switch API Key for matching current account    |

> F12 -> Application -> Cookies -> opencode.ai -> auth

## Auto-Match Account

`query-usage-smart.mjs` workflow:

1. Read `currentProviderClaude` from `~/.cc-switch/settings.json` to get the current provider
2. Read `~/.cc-switch/cc-switch.db` to get the current provider's API Key
3. Match the account with the same `apiKey` in `config.json`
4. Run the corresponding query script

> When a free model is detected, all accounts are displayed instead
> If no matching account is found, the script exits silently (no output)

## Usage with ccstatusline / ccstatusline-zh

It is recommended to configure `query-usage-smart.mjs` as a custom command in ccstatusline / ccstatusline-zh for real-time display in the Claude Code status bar (use absolute path):

```bash
node F:/xxx/query-usage-smart.mjs
```

- Recommended custom command timeout: 6000ms
- To display colored percentages, check "preserve colors" for the custom command in ccstatusline / ccstatusline-zh

## Changelog

[CHANGELOG](CHANGELOG.md)

## License

[MIT License](LICENSE)
