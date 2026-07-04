/**
 * @file 通过 Claude 配置文件反推真实模型名称
 *
 * 从 ccstatusline-zh 的标准输入接收 JSON（格式：{"model": {"display_name": "..."}}），
 * 结合 ~/.claude/settings.json 的 ANTHROPIC_BASE_URL 判断是否处于路由模式，
 * 直连模式直接输出 display_name，路由模式按档位前缀映射到真实模型名。
 *
 * 用法: node get-actual-model.mjs
 */

import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ── 读 stdin ──────────────────────────────

function main() {
    const raw = readFileSync(0, "utf8");

    let j;
    try {
        j = JSON.parse(raw);
    } catch {
        process.stdout.write(raw || "(empty stdin)");
        return;
    }

    const display = j?.model?.display_name;
    if (
        display === undefined ||
        display === null ||
        String(display).trim() === ""
    ) {
        process.stdout.write(raw || "(empty stdin)");
        return;
    }

    // ── 读 settings.json 判断是否路由 ────────────

    const cfgPath = join(homedir(), ".claude", "settings.json");
    let cfg;
    try {
        cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    } catch {
        process.stdout.write(String(display));
        return;
    }

    const baseUrl = cfg?.env?.ANTHROPIC_BASE_URL || "";

    if (/:\/\/(127\.0\.0\.1|localhost)/.test(baseUrl)) {
        // 路由模式：按 display_name 前缀反推档位，拼上 [xxx] 后缀
        const lower = String(display).toLowerCase();
        let targetName;
        let targetModel;
        if (lower.includes("opus")) {
            targetName = cfg.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME;
            targetModel = cfg.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
        } else if (lower.includes("sonnet")) {
            targetName = cfg.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME;
            targetModel = cfg.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
        } else if (lower.includes("haiku")) {
            targetName = cfg.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME;
            targetModel = cfg.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
        } else if (lower.includes("fable")) {
            targetName = cfg.env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME;
            targetModel = cfg.env.ANTHROPIC_DEFAULT_FABLE_MODEL;
        } else {
            process.stdout.write(String(display));
            return;
        }

        if (
            targetName === undefined ||
            targetName === null ||
            String(targetName).trim() === ""
        ) {
            process.stdout.write("?");
            return;
        }

        const m = String(targetModel).match(/\[.*\]$/);
        if (m) {
            process.stdout.write(`${targetName}${m[0]}`);
        } else {
            process.stdout.write(String(targetName));
        }
    } else {
        // 直连模式：直接输出 display_name
        process.stdout.write(String(display));
    }
}

main();
