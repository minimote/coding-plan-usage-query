# CodingPlan Usage Query

<p align="center">
  中文 | <a href="README_EN.md">English</a> &emsp;——&emsp;
  <a href="https://gitee.com/minimote/coding-plan-usage-query">Gitee</a> | <a href="https://github.com/minimote/coding-plan-usage-query">GitHub</a>
</p>

> &emsp;&emsp;由于部分平台没有提供 API 套餐用量查询的接口，所以有了该项目，通过其他方式获取套餐用量和重置时间，目前支持**火山方舟 Coding Plan** 和 **OpenCodeGo** 。

&emsp;&emsp;可以输出百分比、进度条和重置倒计时，适合放到 Claude Code 状态栏查看，推荐搭配 [ccstatusline](https://github.com/sirmalloc/ccstatusline) 或 [ccstatusline-zh](https://github.com/huangguang1999/ccstatusline-zh) 使用。

## 效果预览

![Preview](preview.png)

## 文件说明

| 文件                               | 作用                                               |
| ---------------------------------- | -------------------------------------------------- |
| `config.example.json`              | 配置文件模板，重命名为`config.json` 后填写         |
| `get-plan-usage-all.js`            | 路由入口，根据 `ANTHROPIC_BASE_URL` 自动选择子脚本 |
| `get-plan-usage-ark-codingplan.js` | 火山方舟 Coding Plan 用量查询，可单独使用          |
| `get-plan-usage-opencode-go.js`    | OpenCodeGo 用量查询，可单独使用                    |

## 使用方式

### 1. 重命名配置文件

&emsp;&emsp;将 `config.example.json` 重命名为 `config.json`

### 2. 填写配置文件

&emsp;&emsp;打开 `config.json`，每个配置项前都有 `_说明` 字段，按提示获取后填入

### 3. 搭配 `ccstatusline/ccstatusline-zh` 自定义命令使用

```bash
# 自定义命令超时建议设为 5000ms

# 根据 ANTHROPIC_BASE_URL 自动判断显示哪个平台
node F:\xxx\get-plan-usage-all.js

# 或直接单独查询某一平台
node F:\xxx\get-plan-usage-ark-codingplan.js
node F:\xxx\get-plan-usage-opencode-go.js
```
