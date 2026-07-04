/**
 * @file 根据 ANTHROPIC_BASE_URL 智能路由到对应用量查询脚本
 *
 * 读 ~/.claude/settings.json 的 ANTHROPIC_BASE_URL，按域名分发到
 *   query-usage-ark.mjs / query-usage-opencode-go.mjs，拼接子脚本输出
 *
 * 用法: node query-usage-smart.mjs
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { safeExec } from "./query-usage-utils.mjs";

// ── 工具函数 ──────────────────────────────

/**
 * 通过 get-actual-model.mjs 获取实际模型名，检查是否免费
 *
 * 从 stdin 读取 ccstatusline-zh 传入的 JSON，传递给子脚本解析。
 * stdin 为空或子脚本出错时不拦截，正常执行后续逻辑。
 *
 * @returns {boolean} 模型名包含 "free" 时为 true
 */
function isFreeModel() {
    let raw;
    try {
        raw = readFileSync(0, "utf-8");
    } catch {
        return false;
    }
    if (!raw || raw.trim() === "") return false;
    const result = safeExec("get-actual-model.mjs", raw);
    return result.toLowerCase().includes("free");
}

// ── 入口 ─────────────────────────────────

function main() {
    // 免费模型不显示用量
    if (isFreeModel()) return;

    const cfgPath = join(homedir(), ".claude", "settings.json");
    let baseUrl;
    try {
        const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
        baseUrl = (cfg.env && cfg.env.ANTHROPIC_BASE_URL) || "";
    } catch (err) {
        console.error(`❌ 读取 settings.json 失败: ${err.message}`);
        process.exit(0);
    }

    const arkFile = "query-usage-ark.mjs";
    const goFile = "query-usage-opencode-go.mjs";

    if (/ark\.cn-beijing\.volces\.com/.test(baseUrl)) {
        // 火山直连 → 显示火山查询结果
        process.stdout.write(safeExec(arkFile));
    } else if (/opencode\.ai/.test(baseUrl)) {
        // OpenCodeGo 直连 → 两个都显示，换行分隔
        const go = safeExec(goFile).trimEnd();
        const ark = safeExec(arkFile).trimEnd();
        process.stdout.write(go + "\n" + ark);
    } else {
        // 其他（主要是 OpenCodeGo 路由的情况）→ 只显示 go
        process.stdout.write(safeExec(goFile));
    }
}

main();
