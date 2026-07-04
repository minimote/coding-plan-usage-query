/**
 * @file OpenCodeGo 用量查询
 *
 * 请求 https://opencode.ai/workspace/<WorkspaceID>/go 页面，解析 SSR 直出的用量 HTML
 *
 * 配置从同目录 config.json 读取（字段 opencode.authCookie / opencode.workspaceID）
 *
 * 用法: node query-usage-opencode-go.mjs
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { bar, toCountdown, pctColorCode } from "./query-usage-utils.mjs";

// ── Node.js 版本检查 ────────────────────────

if (parseInt(process.versions.node.split(".")[0], 10) < 18) {
    console.error(
        `OpenCodeGo | ❌ 需要 Node.js 18+，当前 ${process.versions.node}`,
    );
    process.exit(0);
}

// ── 配置 ────────────────────────────────

const CONFIG_FILE = join(
    dirname(fileURLToPath(import.meta.url)),
    "config.json",
);

// ── 工具函数 ──────────────────────────────

/**
 * 从 SSR HTML 中取某用量窗口对象的字段值
 *
 * 用量对象固定形态 name:$R[数字]={...}；页面里 name 可能先作为别处字段名出现
 * （如 monthlyUsage:0），故用 ":$R[数字]=" 前缀锁定，再花括号配对取正文，
 * 最后在正文中按 field:数值 提取
 *
 * @param {string} html 页面 HTML
 * @param {string} name 用量对象名（如 "rollingUsage"）
 * @param {string} field 要取的字段名（如 "usagePercent"）
 * @returns {string | null} 字段值的字符串形式；未匹配到时返回 null
 */
function getWindowValue(html, name, field) {
    const hm = html.match(
        name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":\\$R\\[\\d+\\]=\\{",
    );
    if (!hm) return null;
    const start = hm.index + hm[0].length;
    let depth = 1,
        i = start,
        end = -1;
    while (i < html.length && depth > 0) {
        const ch = html[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
        i++;
    }
    if (end < 0) return null;
    const body = html.substring(start, end);
    const fm = body.match(
        field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:\\s*(-?[\\d.]+)",
    );
    return fm ? fm[1] : null;
}

// ── 入口 ─────────────────────────────────

async function main() {
    if (!existsSync(CONFIG_FILE)) {
        console.log("OpenCodeGo | ❌ 未找到 config.json");
        process.exit(0);
    }

    /** @type {{ opencode?: { authCookie?: string, workspaceID?: string } }} */
    let cfg;
    try {
        cfg = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    } catch {
        console.log("OpenCodeGo | ❌ config.json 解析失败");
        process.exit(0);
    }

    const authCookie = (cfg.opencode?.authCookie || "").trim();
    const workspaceID = (cfg.opencode?.workspaceID || "").trim();
    if (!authCookie || !workspaceID) {
        console.log("OpenCodeGo | ❌ 缺少 opencode 配置");
        process.exit(0);
    }

    const cookie = "auth=" + authCookie;
    const timeoutMs = 3000;
    const baseUrl = "https://opencode.ai";
    const userAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

    // 先把名字写到 stdout，错误或正常数据接在后面
    process.stdout.write("OpenCodeGo | ");

    try {
        const resp = await fetch(`${baseUrl}/workspace/${workspaceID}/go`, {
            headers: {
                Cookie: cookie,
                "User-Agent": userAgent,
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            signal: AbortSignal.timeout(timeoutMs),
        });

        if (resp.status === 401 || resp.status === 403) {
            console.log(`cookie 已过期或无效(HTTP ${resp.status})`);
            return;
        }
        if (!resp.ok) {
            console.log(`请求失败(HTTP ${resp.status})`);
            return;
        }

        const html = await resp.text();
        const htmlLow = html.toLowerCase();
        for (const kw of [
            "/login",
            "sign in",
            "auth/authorize",
            "not associated with an account",
            'actor of type "public"',
        ]) {
            if (htmlLow.includes(kw)) {
                console.log("cookie 已过期或无效");
                return;
            }
        }

        // rolling 必须能取到，否则视为页面结构变化
        const rollingPct = getWindowValue(html, "rollingUsage", "usagePercent");
        if (rollingPct === null) {
            if (/usagePercent/.test(html))
                console.log("页面解析失败，SSR 格式可能已变更");
            else console.log("未找到用量数据，请检查 workspace_id 是否正确");
            return;
        }

        const labels = { rolling: "5小时", weekly: "1周", monthly: "1月" };
        const windows = ["rolling", "weekly", "monthly"];
        const segs = [];
        for (const w of windows) {
            const pctRaw = getWindowValue(html, w + "Usage", "usagePercent");
            if (pctRaw === null) {
                segs.push(`${labels[w]}:—`);
                continue;
            }
            let pct = parseFloat(pctRaw);
            if (pct < 0) pct = 0;
            if (pct > 100) pct = 100;
            let secRaw = getWindowValue(html, w + "Usage", "resetInSec");
            let sec = secRaw !== null ? parseInt(secRaw, 10) : 0;
            if (sec < 0) sec = 0;
            const color = pctColorCode(pct);
            segs.push(
                `${labels[w]}:${bar(pct)} \x1b[${color}m${Math.round(pct)}%\x1b[0m ↻ ${toCountdown(sec)}`,
            );
        }
        console.log(segs.join(" | "));
    } catch (err) {
        if (err.name === "AbortError") {
            console.log("网络请求失败: 超时");
        } else {
            console.log(`网络请求失败: ${err.message}`);
        }
    }
}

main().catch((err) => {
    console.error(`OpenCodeGo | ❌ ${err.message}`);
    process.exit(0);
});
