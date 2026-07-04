# CodingPlan Usage Query

<div align="center">

<img src="https://img.shields.io/badge/Node.js-18%2B-5FA04E?logo=nodedotjs&logoColor=white" alt="Node.js 18+ required">
<img src="https://img.shields.io/github/license/minimote/coding-plan-usage-query?color=blue&label=%C2%A9%20license" alt="License">

</div>

<div align="center">
    <a href="README.md">中文</a> | English
    &emsp;——&emsp;
    <a href="https://gitee.com/minimote/coding-plan-usage-query">Gitee</a> | <a href="https://github.com/minimote/coding-plan-usage-query">GitHub</a>
</div>

> Query AI Coding Plan usage and reset countdown across platforms. Outputs percentage, progress bar, and remaining time in a single line — perfect for the Claude Code status bar. Recommended for use with [ccstatusline](https://github.com/sirmalloc/ccstatusline) / [ccstatusline-zh](https://github.com/huangguang1999/ccstatusline-zh).

**Currently supported:**

|                  Plan                   |  How to get data   |
| :-------------------------------------: | :----------------: |
| Volcengine Ark Coding Plan / Agent Plan | Volcengine OpenAPI |
|               OpenCode Go               | HTML page parsing  |

## Preview

> Note: to display colored percentages, enable "preserve colors" for the custom command in ccstatusline / ccstatusline-zh.

![Preview](preview.png)

## Files

|             File              | Description                                                                            |
| :---------------------------: | -------------------------------------------------------------------------------------- |
|     `config.example.json`     | Configuration template — rename to `config.json` and fill in                           |
|    `get-actual-model.mjs`     | Resolve the actual model name under CC Switch routing, can be used standalone          |
|     `query-usage-all.bat`     | Double-click to run on Windows, quickly view all platform usage                        |
|     `query-usage-all.mjs`     | Query all platform usage at once, suitable when using multiple platforms               |
|     `query-usage-ark.mjs`     | Volcengine Ark Coding Plan / Agent Plan usage query, can be used standalone            |
| `query-usage-opencode-go.mjs` | OpenCodeGo usage query, can be used standalone                                         |
|    `query-usage-smart.mjs`    | Auto-select the matching query script based on `ANTHROPIC_BASE_URL`; skips free models |
|    `query-usage-utils.mjs`    | Shared utility functions (`safeExec`, progress bar, countdown, colors)                 |

## Prerequisites

- Node.js 18 or later

## Getting Started

### 1. Rename the config file

Rename `config.example.json` to `config.json`.

### 2. Fill in credentials

Open `config.json`. Each configuration field is preceded by a `_说明` (instructions) field — follow the steps provided to obtain and fill in your credentials.

- **Volcengine Ark**: Create an AccessKey in the Volcengine console, fill in `ark.accessKeyId` and `ark.secretAccessKey`
- **OpenCodeGo**: Log in to opencode.ai, extract the `auth` value from browser cookies, and get the `workspaceID` from the address bar

### 3. Usage with `ccstatusline` / `ccstatusline-zh`

```bash
# Recommended custom command timeout: 5000ms

# Auto-select platform based on ANTHROPIC_BASE_URL
node query-usage-smart.mjs

# Query all platforms
node query-usage-all.mjs

# Volcengine Ark Coding Plan (default)
node query-usage-ark.mjs

# Volcengine Ark Agent Plan
node query-usage-ark.mjs agent

# OpenCodeGo
node query-usage-opencode-go.mjs
```

## Changelog

### v1.1.0-2026.07.04

- Full refactor to ES Modules (`.js` → `.mjs`)
- Volcengine Ark now uses **Volcengine OpenAPI (AK/SK Signature V4)**, no longer depends on browser cookies
- Added Volcengine Ark Agent Plan usage query
- Added `query-usage-all.bat` for double-click on Windows
- Split `query-usage-all.mjs` and `query-usage-smart.mjs` for all-query and auto-match respectively
- `query-usage-smart.mjs` hides usage info when using a free model
- Extracted `query-usage-utils.mjs` for shared utilities (`safeExec`, progress bar, countdown, colors)

### v1.0.0-2026.07.03

- Initial release
- OpenCodeGo usage query (SSR HTML page parsing)
- Volcengine Ark Coding Plan usage query (browser cookie + X-CSRF-Token)
- Auto-match query script based on `ANTHROPIC_BASE_URL`
- Output percentage + progress bar + reset countdown
