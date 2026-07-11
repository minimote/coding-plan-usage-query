/**
 * @file OpenCodeGo 用量查询
 *
 * 读取 config.json 的 opencode 数组获取凭据
 * 请求 https://opencode.ai/workspace/<WorkspaceID>/go 页面，解析用量信息
 *
 * 用法:
 *   node query-usage-opencode-go.mjs
 *
 * 参数:
 *   --display / -d    显示模式：auto(a,默认) | long(l) | short(s)
 *   --position / -p   账号位置（0 开始，默认 0）
 */

import {
    DISPLAY,
    KEYS,
    renderWindows,
    loadConfig,
    resolvePrefixes,
    DEFAULT_LABELS,
    findAccount,
    parseArgs,
} from "../utils/utils-query-usage.mjs";

// #region 状态变量 ----------------

/** @type {"auto" | "long" | "short"} */
let gDisplay = DISPLAY.AUTO;

// #endregion 状态变量 --------------------------------

// #region 配置常量 ----------------

const KEY = KEYS.OPENCODE;

// #endregion 配置常量 --------------------------------

// #region 解析工具 ----------------

/**
 * 从 SSR HTML 中取某用量窗口对象的 body 文本
 *
 * 用量对象固定形态 name:\$R[数字]={...}；页面里 name 可能先作为别处字段名出现
 * （如 monthlyUsage:0），故用 ":\$R[数字]=" 前缀锁定，再花括号配对取正文
 *
 * @param {string} html 页面 HTML
 * @param {string} name 用量对象名（如 "rollingUsage"）
 * @returns {string | null} 花括号内的 body 文本
 */
function getWindowObject(html, name) {
    const match = html.match(
        name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":\\$R\\[\\d+\\]=\\{",
    );
    if (!match) {
        return null;
    }
    const start = match.index + match[0].length;
    let depth = 1,
        i = start;
    while (i < html.length && depth > 0) {
        const ch = html[i];
        if (ch === "{") {
            depth++;
        } else if (ch === "}") {
            depth--;
        }
        i++;
    }
    if (depth > 0) {
        return null;
    } // 未闭合
    return html.substring(start, i - 1);
}

/**
 * 从已提取的窗口对象 body 中取字段值
 *
 * @param {string} body 窗口对象 body（由 getWindowObject 返回）
 * @param {string} field 字段名（如 "usagePercent"）
 * @returns {string | null}
 */
function getFieldValue(body, field) {
    const match = body.match(
        field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:\\s*(-?[\\d.]+)",
    );
    return match ? match[1] : null;
}

/**
 * 从 SSR HTML 中提取三个用量窗口数据
 * @param {string} html
 * @returns {{
 *     rolling: {
 *         pct:number,
 *         sec:number
 *     } | null,
 *     weekly: { pct:number, sec:number } | null,
 *     monthly: { pct:number, sec:number } | null
 * }}
 */
function parseUsageWindows(html) {
    const parseWindow = (key) => {
        const body = getWindowObject(html, key + "Usage");
        if (!body) {
            return null;
        }
        const pctRaw = getFieldValue(body, "usagePercent");
        if (pctRaw === null) {
            return null;
        }
        const secRaw = getFieldValue(body, "resetInSec");
        return {
            pct: parseFloat(pctRaw),
            sec: secRaw !== null ? parseInt(secRaw, 10) : 0,
        };
    };
    return {
        rolling: parseWindow("rolling"),
        weekly: parseWindow("weekly"),
        monthly: parseWindow("monthly"),
    };
}

// #endregion 解析工具 --------------------------------

// #region 用量请求 ----------------

/**
 * 请求 opencode.ai 页面并解析用量数据
 *
 * @param {string} authCookie
 * @param {string} workspaceID
 * @returns {Promise<{
 *     rolling: { pct: number, sec: number } | null,
 *     weekly: { pct: number, sec: number } | null,
 *     monthly: { pct: number, sec: number } | null
 * }>}
 */
async function fetchUsage(authCookie, workspaceID) {
    const cookie = "auth=" + authCookie;
    const timeoutMs = 3000;
    const baseUrl = "https://opencode.ai";
    const userAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

    const resp = await fetch(`${baseUrl}/workspace/${workspaceID}/go`, {
        headers: {
            Cookie: cookie,
            "User-Agent": userAgent,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(timeoutMs),
    });

    if (resp.status === 401 || resp.status === 403) {
        throw new Error(`cookie 已过期或无效(HTTP ${resp.status})`);
    }
    if (!resp.ok) {
        throw new Error(`请求失败(HTTP ${resp.status})`);
    }

    const html = await resp.text();

    // cookie 过期但 HTTP 仍 200 时，页面会出现登录/未关联账号等关键词
    if (
        /\/login|sign in|auth\/authorize|not associated with an account|actor of type "public"/i.test(
            html,
        )
    ) {
        throw new Error("cookie 已过期或无效");
    }

    const usage = parseUsageWindows(html);
    if (usage.rolling === null) {
        if (/usagePercent/.test(html)) {
            throw new Error("页面解析失败，页面结构可能已更新");
        } else {
            throw new Error("未找到用量数据，请检查 workspace_id 是否正确");
        }
    }
    return usage;
}

// #endregion 用量请求 --------------------------------

// #region 脚本入口 ----------------

async function main() {
    const { display, position } = parseArgs(process.argv);
    gDisplay = display;

    const cfg = loadConfig();
    const account = findAccount(cfg[KEY], position);
    const authCookie = (account.authCookie || "").trim();
    const workspaceID = (account.workspaceID || "").trim();
    if (!authCookie || !workspaceID) {
        throw new Error("配置缺少 authCookie 或 workspaceID");
    }

    const usage = await fetchUsage(authCookie, workspaceID);

    const prefixes = resolvePrefixes(account, DEFAULT_LABELS[KEY]);
    console.log(renderWindows(usage, display, prefixes));
}

main().catch((err) => {
    const mode = gDisplay === DISPLAY.SHORT ? DISPLAY.SHORT : DISPLAY.LONG;
    const prefix = DEFAULT_LABELS[KEY][mode];
    console.log(`${prefix} | ❌ ${err.message}`);
});

// #endregion 脚本入口 --------------------------------
