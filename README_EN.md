# CodingPlan Usage Query

<p align="center">
  <a href="README.md">中文</a> | English &emsp;——&emsp;
  <a href="https://gitee.com/minimote/coding-plan-usage-query">Gitee</a> | <a href="https://github.com/minimote/coding-plan-usage-query">GitHub</a>
</p>

> Since some platforms do not provide API endpoints for checking coding plan usage, this project was created to retrieve usage data and reset time through alternative methods — scraping web pages or calling console interfaces. Currently supports **Volcengine Ark Coding Plan** and **OpenCodeGo**.

It outputs percentage, progress bar, and reset countdown in a single line — perfect for the Claude Code status bar. Recommended for use with [ccstatusline](https://github.com/sirmalloc/ccstatusline) or [ccstatusline-zh](https://github.com/huangguang1999/ccstatusline-zh).

## Preview

![Preview](preview.png)

## Files

| File                               | Description                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| `config.example.json`              | Configuration template — rename to `config.json` and fill in                          |
| `get-plan-usage-all.js`            | Router — automatically selects the correct child script based on `ANTHROPIC_BASE_URL` |
| `get-plan-usage-ark-codingplan.js` | Volcengine Ark Coding Plan, can be used standalone                                    |
| `get-plan-usage-opencode-go.js`    | OpenCodeGo, can be used standalone                                                    |

## Getting Started

### 1. Rename the config file

&emsp;&emsp;Rename `config.example.json` to `config.json`.

### 2. Fill in credentials

&emsp;&emsp;Open `config.json`. Each configuration field is preceded by a `_说明` (instructions) field — follow the steps provided to obtain and fill in your credentials.

### 3. Usage with `ccstatusline` / `ccstatusline-zh`

```bash
# Recommended custom command timeout: 5000ms

# Auto-select platform based on ANTHROPIC_BASE_URL
node F:\xxx\get-plan-usage-all.js

# Or query a single platform directly
node F:\xxx\get-plan-usage-ark-codingplan.js
node F:\xxx\get-plan-usage-opencode-go.js
```
