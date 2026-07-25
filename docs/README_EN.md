# CodingPlan Usage Query

<div align="center">

<img src="https://img.shields.io/badge/Node.js-22.13%2B-5FA04E?logo=nodedotjs&logoColor=white" alt="Node.js 22.13+ required">
<img src="https://img.shields.io/github/license/minimote/coding-plan-usage-query?color=blue&label=%C2%A9%20License" alt="License">

</div>

<p>

<div align="center">
    <a href="../README.md">中文</a> | English
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
|      Alibaba Cloud Qwen Token Plan      |   Console Cookie   |

## Preview

![Preview](preview.png)

> Run `scripts/preview.cmd` (or `node src/tools/preview.mjs`) to preview the display at various percentage levels in the terminal using mock data — no real account needed.

## Project Structure

```text
coding-plan-usage-query/
├── config/
│   ├── config.example.json                # Config template
│   └── config.schema.json                 # JSON Schema validation
├── scripts/
│   ├── query-usage-all.cmd                # Double-click to run on Windows (UTF-8 via chcp 65001)
│   ├── login-qwen.cmd                     # Double-click to log in to Qwen on Windows
│   ├── login-opencode.cmd                 # Double-click to log in to OpenCodeGo on Windows
│   └── preview.cmd                        # Double-click to preview display on Windows
├── src/
│   ├── login/
│   │   ├── login-common.mjs             # Shared login logic (Playwright, profile, config writeback)
│   │   ├── login-qwen.mjs               # Qwen login
│   │   └── login-opencode.mjs           # OpenCodeGo login
│   ├── query/
│   │   ├── query-usage-all.mjs            # Query all plans (parallel)
│   │   ├── query-usage-ark.mjs            # Volcengine Ark query
│   │   ├── query-usage-qwen.mjs           # Qwen Token Plan query
│   │   ├── query-usage-opencode-go.mjs    # OpenCodeGo query
│   │   └── query-usage-smart.mjs          # Auto-match via CC-Switch (with 5s cache)
│   ├── tools/
│   │   ├── get-actual-model.mjs           # Get actual model name
│   │   └── preview.mjs                    # Generate mock usage preview output
│   └── utils/
│       ├── utils-query-usage.mjs           # Shared utilities
│       └── utils-cc-switch.mjs             # CC-Switch utilities
├── test/                                  # Unit tests (node --test)
└── tmp/                                   # Query result cache and login profiles (auto-generated, gitignored)
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
- **OpenCodeGo**: Run `login-opencode.cmd` to log in and write the `auth` cookie and `workspaceID` (playwright-core is auto-installed on first run)
- **Alibaba Cloud Qwen**: Run `login-qwen.cmd` to log in and write the cookie (playwright-core is auto-installed on first run)

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

# Alibaba Cloud Qwen (prompts to run login command if cookie expired)
node src/query/query-usage-qwen.mjs

# Log in to Qwen to refresh cookie (double-click login-qwen.cmd on Windows, or command line)
npm run login:qwen

# Log in to OpenCodeGo to refresh credentials (double-click login-opencode.cmd on Windows, or command line)
npm run login:opencode

# Specify account position (0-indexed)
node src/query/query-usage-ark.mjs --position 1

# Preview display (no real account needed)
node src/tools/preview.mjs
```

## Command Line Arguments

Query scripts support the following arguments:

|           Argument            | Short | Description                                                                                                                                |
| :---------------------------: | :---: | ------------------------------------------------------------------------------------------------------------------------------------------ |
|          `--display`          | `-d`  | Display mode: `auto` (default, `a`) / `long` (`l`) / `short` (`s`)                                                                         |
|           `--type`            | `-t`  | Volcengine Ark plan type: `coding` (`c`) / `agent` (`a`); falls back to the account's `type`, then `coding` (ignored by all/smart scripts) |
|         `--position`          | `-p`  | Account position (0-indexed, default 0)                                                                                                    |
| `--hide-on-monthly-exhausted` |   -   | Skip output when monthly quota exhausted: `true`/`false` (default `false`; ignored by the smart script)                                    |

> Login scripts (`login-qwen`/`login-opencode`) only support the `--position`/`-p` argument.

## Configuration

`config/config.json` is a JSON object with three keys: `ark` (Volcengine Ark accounts), `opencode` (OpenCodeGo accounts), and `qwen` (Alibaba Cloud Qwen accounts). Each key holds an array of account objects. Multiple accounts are supported. The `apiKey` field is used by `query-usage-smart.mjs` to match the current provider; leave it empty if not using the smart script.

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

|           Field            | Required | Description                                                         |
| :------------------------: | :------: | ------------------------------------------------------------------- |
| `longLabel` / `shortLabel` |    No    | Display label, defaults to `OpenCodeGo`/`Go`                        |
|        `authCookie`        |   Yes    | `auth` cookie from opencode.ai, auto-filled by `login-opencode.cmd` |
|       `workspaceID`        |   Yes    | Workspace ID, e.g. `wrk_...`, auto-filled by `login-opencode.cmd`   |
|          `apiKey`          |    No    | CC-Switch API Key for matching current account                      |

> Run `npm run login:opencode` (or double-click `login-opencode.cmd`) to auto-fill after login

### Alibaba Cloud Qwen

```json
{
    "qwen": [
        {
            "apiKey": "sk-sp-xxx",
            "cookie": "cna=xxx; login_qianwenai_ticket=xxx; ...",
            "longLabel": "千问",
            "shortLabel": "千问"
        }
    ]
}
```

|           Field            | Required | Description                                                        |
| :------------------------: | :------: | ------------------------------------------------------------------ |
| `longLabel` / `shortLabel` |    No    | Display label, defaults to `千问TokenPlan`/`千问`                  |
|          `cookie`          |   Yes    | Qwen console login cookie, auto-filled by running `login-qwen.cmd` |
|          `apiKey`          |    No    | CC-Switch API Key for matching current account                     |

> Qwen has no public usage-query OpenAPI; the console cookie is used to call an internal data gateway
> The cookie expires; run `login-qwen.cmd` again to re-login when it expires
> Login depends on `playwright-core` (devDependency), auto-installed on first run of `login-qwen.cmd`

## Auto-Match Account

`query-usage-smart.mjs` workflow:

1. Read `currentProviderClaude` from `~/.cc-switch/settings.json` to get the current provider
2. Get the current provider's API Key (prioritize env vars `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY`; fall back to `~/.cc-switch/cc-switch.db` in proxy mode)
3. Match the account with the same `apiKey` in `config.json`
4. Call the corresponding query function in-process

> When a free model is detected, all accounts are displayed instead
> If no matching account is found, the script exits silently (no output)
> Query results are cached for 5 seconds (`tmp/cache-usage.json`) to reduce upstream API calls under frequent refreshes; running the sub-scripts manually always queries live

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

[MIT License](../LICENSE)
