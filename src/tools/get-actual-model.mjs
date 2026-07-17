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
 *   node get-actual-model.mjs
 */

import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

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

    let j;
    try {
        j = JSON.parse(raw);
    } catch {
        process.stdout.write(raw ? "JSON 解析失败" : "输入为空");
        return;
    }

    const display = j?.model?.display_name;
    if (
        display === undefined ||
        display === null ||
        String(display).trim() === ""
    ) {
        process.stdout.write(raw ? "未找到模型名" : "输入为空");
        return;
    }

    // 读 settings.json 判断是否路由

    const cfgPath = join(homedir(), ".claude", "settings.json");
    let cfg;
    try {
        cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    } catch {
        process.stdout.write(String(display));
        return;
    }

    // 路由模式判定：环境变量优先，回退 settings.json
    const baseUrl =
        process.env.ANTHROPIC_BASE_URL || cfg?.env?.ANTHROPIC_BASE_URL || "";

    // 路由模式：遍历 env 中配对的 MODEL_NAME/MODEL，按 display_name 匹配后拼上 [xxx] 后缀
    if (/:\/\/(127\.0\.0\.1|localhost)/.test(baseUrl)) {
        const lower = String(display).toLowerCase();
        const env = cfg.env || {};

        // 收集 ANTHROPIC_DEFAULT_<name>_MODEL_NAME，排除值为空或缺少对应 _MODEL 的条目，
        // 按 name 长度降序，优先匹配更具体的名称
        let name = null;
        let model = null;
        const tierKeys = Object.keys(env)
            .map((key) => key.match(/^ANTHROPIC_DEFAULT_(.+)_MODEL_NAME$/))
            .filter((m) => {
                if (!m) return false;
                const modelKey = `ANTHROPIC_DEFAULT_${m[1]}_MODEL`;
                return env[m[0]]?.trim() && env[modelKey] !== undefined;
            })
            .sort((a, b) => b[1].length - a[1].length);
        for (const tierMatch of tierKeys) {
            if (lower.includes(tierMatch[1].toLowerCase())) {
                name = env[tierMatch[0]];
                model = env[`ANTHROPIC_DEFAULT_${tierMatch[1]}_MODEL`];
                break;
            }
        }

        // 未匹配到任何 tier，直接输出 display_name
        if (!name) {
            process.stdout.write(String(display));
            return;
        }

        // 从 MODEL 提取末尾 [xxx] 后缀拼到 NAME 后，如 glm-latest[1M]
        const suffix = String(model).match(/\[.*\]$/);
        if (suffix) {
            process.stdout.write(`${name}${suffix[0]}`);
        } else {
            process.stdout.write(String(name));
        }
    } else {
        // 直连模式：直接输出 display_name
        process.stdout.write(String(display));
    }
}

main();
