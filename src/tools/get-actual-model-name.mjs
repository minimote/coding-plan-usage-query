/**
 * @file 通过 Claude 配置文件反推真实模型名称
 *
 * 从 ccstatusline-zh 的标准输入接收 JSON
 * 结合 ANTHROPIC_BASE_URL 判断是否处于路由模式
 *   ANTHROPIC_BASE_URL 优先取环境变量，回退 settings.json
 * 直连模式直接输出 display_name
 * 路由模式遍历 settings.json 中配对的 *_MODEL_NAME/_MODEL
 * 按 display_name 匹配后输出真实模型名
 *
 * 用法:
 *   node get-actual-model-name.mjs
 *
 * 也可被 import 后调用 getActualModelName(raw)
 */

import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { isMainModule, escapeRegExp } from "../utils/utils-query-usage.mjs";

// #region 核心逻辑 ----------------

/**
 * 从 ccstatusline 传入的 JSON 原文解析真实模型名
 *
 * @param {string} raw stdin 收到的 JSON 字符串
 * @returns {string} 真实模型名；解析失败时返回错误提示字符串
 */
export function getActualModelName(raw) {
    let j;
    try {
        j = JSON.parse(raw);
    } catch {
        return raw ? "JSON 解析失败" : "输入为空";
    }

    const display = j?.model?.display_name;
    if (
        display === undefined ||
        display === null ||
        String(display).trim() === ""
    ) {
        return raw ? "未找到模型名" : "输入为空";
    }

    // 读 settings.json 判断是否路由

    // 测试可通过 CC_CLAUDE_SETTINGS_PATH 重定向到临时 settings.json，避免触碰真实 ~/.claude
    const cfgPath =
        process.env.CC_CLAUDE_SETTINGS_PATH ||
        join(homedir(), ".claude", "settings.json");
    let cfg;
    try {
        cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    } catch {
        return String(display);
    }

    // 路由模式判定：环境变量优先，回退 settings.json
    const baseUrl =
        process.env.ANTHROPIC_BASE_URL || cfg?.env?.ANTHROPIC_BASE_URL || "";

    // 路由模式：在 env 配对的 MODEL_NAME/MODEL 中按 display_name 匹配真实模型名
    if (/:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(baseUrl)) {
        // 未匹配到任何 tier 时回退 display_name
        return matchRoutedModel(display, cfg.env || {}) ?? String(display);
    }
    // 直连模式：直接输出 display_name
    return String(display);
}

/**
 * 路由模式下按 display_name 反推真实模型名（纯函数，可独立测试）
 *
 * 收集 env 中 ANTHROPIC_DEFAULT_<name>_MODEL_NAME 条目，排除值为空或缺少对应
 * ANTHROPIC_DEFAULT_<name>_MODEL 的条目，按 name 长度降序优先匹配更具体的名称；
 * 命中后从 MODEL 提取末尾 [xxx] 后缀拼到 NAME 后（如 glm-latest[1M]）
 *
 * @param {string} displayName 模型显示名（j.model.display_name）
 * @param {object} env settings.json 的 env 对象
 * @returns {string | null} 匹配到的真实模型名（含 [xxx] 后缀）；未匹配返回 null
 */
export function matchRoutedModel(displayName, env) {
    const lower = String(displayName).toLowerCase();

    const tierKeys = Object.keys(env)
        .map((key) => key.match(/^ANTHROPIC_DEFAULT_(.+)_MODEL_NAME$/))
        .filter((m) => {
            if (!m) return false;
            const modelKey = `ANTHROPIC_DEFAULT_${m[1]}_MODEL`;
            return env[m[0]]?.trim() && env[modelKey] !== undefined;
        })
        .sort((a, b) => b[1].length - a[1].length);

    for (const tierMatch of tierKeys) {
        // env 键段用下划线连接（如 SONNET_4），真实 display_name 用连字符 / 空格 / 下划线
        // 分隔（如 claude-sonnet-4、Claude Sonnet 4）：把下划线归一为任意分隔符再匹配，
        // 否则多词 tier 永远匹配不到、静默回退到更短的通配 tier
        // 先转义正则特殊字符（tier 名来自 settings.json 的 env 键，可能含 . ( ) 等），
        // 避免 '.' 通配任意字符误匹配、不平衡括号抛 SyntaxError 使 smart 整体崩溃
        const keyPattern = new RegExp(
            escapeRegExp(tierMatch[1].toLowerCase()).replace(/_/g, "[-_\\s]"),
        );
        if (keyPattern.test(lower)) {
            const name = env[tierMatch[0]];
            const model = env[`ANTHROPIC_DEFAULT_${tierMatch[1]}_MODEL`];
            // 从 MODEL 提取末尾 [xxx] 后缀拼到 NAME 后，如 glm-latest[1M]；只取末尾单个括号组，避免贪心吞掉靠前括号
            const suffix = String(model).match(/\[[^\]]*\]$/);
            return suffix ? `${name}${suffix[0]}` : String(name);
        }
    }
    return null;
}

// #endregion 核心逻辑 --------------------------------

// #region CLI 壳 ----------------

function main() {
    // 终端直接运行时 stdin 为 TTY
    if (process.stdin.isTTY) {
        process.stdout.write(
            "请在 ccstatusline / ccstatusline-zh 中作为自定义命令调用",
        );
        return;
    }
    let raw;
    try {
        raw = readFileSync(0, "utf8");
    } catch {
        process.stdout.write("stdin 读取失败");
        return;
    }

    process.stdout.write(getActualModelName(raw));
}

if (isMainModule(import.meta.url)) {
    main();
}

// #endregion CLI 壳 --------------------------------
