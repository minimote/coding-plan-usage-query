/**
 * @file OpenCode Go 用量查询
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
 *   --hide-on-monthly-exhausted  月度用量耗尽时隐藏该行（true|false，默认 false）
 *
 * 也可被 import 后调用 queryUsage(options)
 */

import {
    DISPLAY,
    KEYS,
    NO_ACTIVE_PLAN,
    renderWindows,
    renderErrorLine,
    loadConfig,
    resolvePrefixes,
    DEFAULT_LABELS,
    findAccount,
    parseArgs,
    fetchUsageCached,
    writeCache,
    isMainModule,
    REQUEST_TIMEOUT_MS,
} from "../utils/utils-query-usage.mjs";

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
export function parseUsageWindows(html) {
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
    const baseUrl = "https://opencode.ai";
    const userAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

    const resp = await fetch(`${baseUrl}/workspace/${workspaceID}/go`, {
        headers: {
            Cookie: cookie,
            "User-Agent": userAgent,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (resp.status === 401 || resp.status === 403) {
        throw new Error(
            `cookie 已过期或无效(HTTP ${resp.status})，请运行 login-opencode.cmd 重新登录`,
        );
    }
    if (!resp.ok) {
        throw new Error(`请求失败(HTTP ${resp.status})`);
    }

    const html = await resp.text();

    // 鉴权失败（cookie 过期 / workspaceID 不属于该账号）：opencode 会 302 跳到 OpenAuth 页面，
    // 跟随重定向后 resp.url 落在 auth.opencode.ai/authorize，页面标题为 "OpenAuth"。
    // 必须与「无活跃套餐」区分：前者提示用户修复凭据，后者才允许 smart 兜底隐藏。
    if (
        /auth\.opencode\.ai\/authorize|\/auth\/authorize/i.test(resp.url || "") ||
        /<title>OpenAuth<\/title>/i.test(html)
    ) {
        throw new Error(
            "cookie 已过期或 workspace_id 不属于该账号，请运行 login-opencode.cmd 重新登录或检查 workspaceID",
        );
    }

    const usage = parseUsageWindows(html);
    if (
        usage.rolling === null &&
        usage.weekly === null &&
        usage.monthly === null
    ) {
        // 200 且无鉴权跳转：workspace 有效。用 subscribe-button 正向认定无订阅
        if (/data-slot="subscribe-button"/.test(html)) {
            throw new Error(NO_ACTIVE_PLAN);
        }
        // 有用量关键字却解析不到对象 → 页面结构改版
        if (/usagePercent/.test(html)) {
            throw new Error("页面解析失败，页面结构可能已更新");
        }
        // 200、无鉴权、无订阅按钮、无用量数据：无法判定，给出可操作提示
        throw new Error("未找到用量数据，请检查 workspace_id 是否正确");
    }
    return usage;
}

// #endregion 用量请求 --------------------------------

// #region 查询入口 ----------------

/**
 * 查询 OpenCode Go 用量并返回渲染后的输出行
 *
 * 不抛出异常：出错时返回带默认标签前缀的错误字符串，便于调用方保持退出码 0
 *
 * @param {object} [options]
 * @param {number} [options.position=0] 账号位置（0 开始）
 * @param {"auto" | "long" | "short"} [options.display=DISPLAY.AUTO] 展示档位
 * @param {boolean} [options.hideOnMonthlyExhausted=false] 月度耗尽时隐藏
 * @param {boolean} [options.cache=false] 启用结果缓存（含错误负缓存）
 * @param {object} [options._config] 内部：已解析的 config 对象，避免重复读取
 * @returns {Promise<string>} 输出行；隐藏时为空字符串
 */
export async function queryUsage(options = {}) {
    const {
        position = 0,
        display = DISPLAY.AUTO,
        hideOnMonthlyExhausted = false,
        cache = false,
    } = options;

    // 错误前缀：try 内解析到账号后用 resolvePrefixes 覆盖，
    // 配置类错误（loadConfig/findAccount）发生在覆盖之前，回退到默认标签
    let prefixes = DEFAULT_LABELS[KEY];
    // 是否已进入网络查询阶段：仅对此后的失败写负缓存（配置类错误不写，原因同 ark）
    let reachedFetch = false;
    try {
        const cfg = options._config || loadConfig();
        const account = findAccount(cfg[KEY], position);
        const authCookie = (account.authCookie || "").trim();
        const workspaceID = (account.workspaceID || "").trim();
        if (!authCookie || !workspaceID) {
            throw new Error("配置缺少 authCookie 或 workspaceID");
        }

        prefixes = resolvePrefixes(account, DEFAULT_LABELS[KEY]);
        reachedFetch = true;
        const result = await fetchUsageCached(`${KEY}:${position}`, cache, () =>
            fetchUsage(authCookie, workspaceID),
        );
        if (result.output !== undefined) {
            return result.output;
        }

        return renderWindows(
            result.usage,
            display,
            prefixes,
            hideOnMonthlyExhausted,
        );
    } catch (err) {
        const output = renderErrorLine(prefixes, display, err.message);
        if (cache && reachedFetch) {
            writeCache(`${KEY}:${position}`, { output });
        }
        return output;
    }
}

// #endregion 查询入口 --------------------------------

// #region CLI 壳 ----------------

async function main() {
    let display = DISPLAY.AUTO;
    try {
        const parsed = parseArgs(process.argv);
        display = parsed.display;
        const output = await queryUsage(parsed);
        if (output) {
            process.stdout.write(output);
        }
    } catch (err) {
        // queryUsage 不抛错，此处只兜底 parseArgs 失败
        process.stdout.write(
            renderErrorLine(DEFAULT_LABELS[KEY], display, err.message) + "\n",
        );
    }
}

if (isMainModule(import.meta.url)) {
    main();
}

// #endregion CLI 壳 --------------------------------
