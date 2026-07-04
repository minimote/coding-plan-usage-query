# CodingPlan Usage Query

<div align="center">

<img src="https://img.shields.io/badge/Node.js-18%2B-5FA04E?logo=nodedotjs&logoColor=white" alt="Node.js 18+ required">
<img src="https://img.shields.io/github/license/minimote/coding-plan-usage-query?color=blue&label=%C2%A9%20license" alt="License">

</div>

<div align="center">
    中文 | <a href="README_EN.md">English</a>
    &emsp;——&emsp;
    <a href="https://gitee.com/minimote/coding-plan-usage-query">Gitee</a> | <a href="https://github.com/minimote/coding-plan-usage-query">GitHub</a>
</div>

> 查询各平台 AI Coding Plan 的套餐用量和重置倒计时。输出百分比、进度条和剩余时间，推荐搭配 [ccstatusline](https://github.com/sirmalloc/ccstatusline) / [ccstatusline-zh](https://github.com/huangguang1999/ccstatusline-zh) 自定义命令，放在 Claude Code 状态栏查看。

目前支持：

|               套餐                |     获取方式     |
| :-------------------------------: | :--------------: |
| 火山方舟 Coding Plan / Agent Plan | 火山引擎 OpenAPI |
|            OpenCode Go            |  页面 HTML 解析  |

## 效果预览

> 注：如果想显示彩色的百分比，请在 ccstatusline / ccstatusline-zh 中将自定义命令设置为保留颜色

![Preview](preview.png)

## 文件说明

|             文件              | 说明                                                   |
| :---------------------------: | ------------------------------------------------------ |
|     `config.example.json`     | 配置文件模板，重命名为 `config.json` 后填写            |
|    `get-actual-model.mjs`     | 获取 CC Switch 路由下实际的模型名称，可单独使用        |
|     `query-usage-all.bat`     | Windows 下可双击运行，快速查看全部平台用量             |
|     `query-usage-all.mjs`     | 查询所有套餐用量，适合同时使用多个平台时               |
|     `query-usage-ark.mjs`     | 火山方舟 Coding Plan / Agent Plan 用量查询，可单独使用 |
| `query-usage-opencode-go.mjs` | OpenCodeGo 用量查询，可单独使用                        |
|    `query-usage-smart.mjs`    | 根据 `ANTHROPIC_BASE_URL` 自动匹配并运行对应查询脚本   |
|    `query-usage-utils.mjs`    | 共享工具函数（`safeExec`、进度条、倒计时、着色）       |

## 前置要求

- Node.js 18 或更高版本

## 使用方式

### 1. 重命名配置文件

将 `config.example.json` 重命名为 `config.json`。

### 2. 填写配置文件

打开 `config.json`，每个配置项前都有 `_说明` 字段，按提示获取后填入：

- **火山方舟**：在火山引擎控制台创建 AccessKey，填入 `ark.accessKeyId` 和 `ark.secretAccessKey`
- **OpenCodeGo**：登录 opencode.ai，从浏览器 Cookie 中提取 `auth` 值，从地址栏获取 `workspaceID`

### 3. 搭配 `ccstatusline` / `ccstatusline-zh` 自定义命令使用

```bash
# 自定义命令超时建议设为 5000ms

# 根据 ANTHROPIC_BASE_URL 自动判断显示哪个套餐
node query-usage-smart.mjs

# 查询所有套餐
node query-usage-all.mjs

# 火山方舟 Coding Plan（默认）
node query-usage-ark.mjs

# 火山方舟 Agent Plan
node query-usage-ark.mjs agent

# OpenCodeGo
node query-usage-opencode-go.mjs
```

## 更新日志

### v1.1.0-2026.07.04

- 全面重构为 ES Module（`.js` → `.mjs`）
- 火山方舟改用**火山引擎 OpenAPI（AK/SK 签名 V4）**，不再依赖浏览器 cookie
- 新增火山方舟 Agent Plan 用量查询
- 新增 `query-usage-all.bat`，Windows 下可双击运行
- 拆分 `query-usage-all.mjs` 和 `query-usage-smart.mjs`，分别实现全部查询和自动匹配查询
- `query-usage-smart.mjs` 在使用免费模型时，不显示套餐用量
- 提取 `query-usage-utils.mjs` 共享工具函数（safeExec、进度条、倒计时、着色）

### v1.0.0-2026.07.03

- 首次发布
- 支持 OpenCodeGo 用量查询（SSR HTML 页面解析）
- 支持火山方舟 Coding Plan 用量查询（浏览器 cookie + X-CSRF-Token）
- 支持根据 `ANTHROPIC_BASE_URL` 自动匹配并运行对应查询脚本
- 输出百分比 + 进度条 + 重置倒计时
