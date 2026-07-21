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

> Query Coding Plan usage and reset countdown across platforms. Recommended for use with [ccstatusline](https://github.com/sirmalloc/ccstatusline) / [ccstatusline-zh](https://github.com/huangguang1999/ccstatusline-zh) custom commands, displayed in the Claude Code status bar.

## Supported Plans

|                  Plan                   |  How to get data   |
| :-------------------------------------: | :----------------: |
| Volcengine Ark Coding Plan / Agent Plan | Volcengine OpenAPI |
|               OpenCode Go               | HTML page parsing  |

## Preview

![Preview](preview.png)

## Project Structure

```text
coding-plan-usage-query/
├── config/
│   ├── config.example.json                # Config template
│   └── config.schema.json                 # JSON Schema validation
├── src/
│   ├── query/
│   │   ├── query-usage-all.cmd            # Double-click to run (Windows; GBK encoding for Chinese output)
│   │   ├── query-usage-all.mjs            # Query all plans (parallel)
│   │   ├── query-usage-ark.mjs            # Volcengine Ark query
│   │   ├── query-usage-opencode-go.mjs    # OpenCodeGo query
│   │   └── query-usage-smart.mjs          # Auto-match via CC-Switch (with 5s cache)
│   ├── tools/
│   │   └── get-actual-model.mjs           # Get actual model name
│   └── utils/
│       ├── utils-query-usage.mjs           # Shared utilities
│       └── utils-cc-switch.mjs             # CC-Switch utilities
├── test/                                  # Unit tests (node --test)
└── tmp/                                   # Query result cache (auto-generated, gitignored)
```

Each query script follows a "exported function + CLI shell" dual-entry pattern: it can be run directly with `node`, and is also called in-process by `smart`/`all` to avoid child-process startup overhead.

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

# Volcengine Ark (uses account's `type`, defaults to coding)
node src/query/query-usage-ark.mjs

# Volcengine Ark Agent Plan (override)
node src/query/query-usage-ark.mjs --type agent

# OpenCodeGo
node src/query/query-usage-opencode-go.mjs

# Specify account position (0-indexed)
node src/query/query-usage-ark.mjs --position 1
```

## Command Line Arguments

|           Argument            | Short | Description                                                                                                                                |
| :---------------------------: | :---: | ------------------------------------------------------------------------------------------------------------------------------------------ |
|          `--display`          | `-d`  | Display mode: `auto` (default, `a`) / `long` (`l`) / `short` (`s`)                                                                         |
|           `--type`            | `-t`  | Volcengine Ark plan type: `coding` (`c`) / `agent` (`a`); falls back to the account's `type`, then `coding` (ignored by all/smart scripts) |
|         `--position`          | `-p`  | Account position (0-indexed, default 0)                                                                                                    |
| `--hide-on-monthly-exhausted` |   -   | Skip output when monthly quota exhausted: `true`/`false` (default `false`; ignored by the smart script)                                    |

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
2. Get the current provider's API Key (prioritize env vars `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY`; fall back to `~/.cc-switch/cc-switch.db` in proxy mode)
3. Match the account with the same `apiKey` in `config.json`
4. Call the corresponding query function in-process

> When a free model is detected, all accounts are displayed instead
> If no matching account is found, the script exits silently (no output)
> Query results are cached for 5 seconds (`tmp/usage-cache.json`) to reduce upstream API calls under frequent refreshes; running the sub-scripts manually always queries live

## Usage with ccstatusline / ccstatusline-zh

It is recommended to configure `query-usage-smart.mjs` as a custom command in ccstatusline / ccstatusline-zh for real-time display in the Claude Code status bar (use absolute path):

```bash
node F:/xxx/query-usage-smart.mjs
```

- Recommended custom command timeout: 6000ms
- To display colored percentages, check "preserve colors" for the custom command in ccstatusline / ccstatusline-zh

## Changelog

[CHANGELOG](CHANGELOG.md)

## Related Projects

- **CC Launcher** ([Gitee](https://gitee.com/minimote/cc-launcher) | [GitHub](https://github.com/minimote/cc-launcher)): Launch Claude Code with a specified CC-Switch provider; multiple instances using different providers can run simultaneously without affecting the global active state.

## License

[MIT License](LICENSE)
