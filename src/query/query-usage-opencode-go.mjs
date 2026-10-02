/**
 * @file OpenCode Go 用量查询
 *
 * 读取 config.json 的 opencode 数组获取凭据
 * 请求 https://opencode.ai/zen/go/v1/usage 内部端点，解析用量信息
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
    KEYS,
    NO_ACTIVE_PLAN,
    INVALID_API_KEY,
    BROWSER_UA,
    DEFAULT_LABELS,
    ensureAnyWindow,
    fetchWithTimeout,
    httpStatusError,
    isMainModule,
    readJsonResponse,
    toResetSec,
    runQueryCli,
    runQueryUsage,
} from "../utils/utils-query-usage.mjs";

// #region 配置常量 ----------------

const KEY = KEYS.OPENCODE;

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

// #endregion 配置常量 --------------------------------

// #region 解析工具 ----------------

/**
 * 解析 /zen/go/v1/usage 响应体为项目标准 usage 结构
 *
 * 三个窗口形态一致：`{ status, percent, resetsAt }`，其中 percent 是已用百分比
 * （0-100，非剩余），resetsAt 是 ISO 字符串。该端点未写进官方文档，
 * 上游随时可能改结构，故字段一律不强转，缺了就丢窗口交渲染层显示 --
 *
 * @param {object} payload /zen/go/v1/usage 响应体
 * @param {number} [now=Date.now()] 当前时间戳，用于计算倒计时
 * @returns {{
 *     rolling: { pct: number, sec: number } | null,
 *     weekly: { pct: number, sec: number } | null,
 *     monthly: { pct: number, sec: number } | null
 * }}
 */
export function parseUsageResponse(payload, now = Date.now()) {
    const toWindow = (w) => {
        if (!w || typeof w !== "object") {
            return null;
        }
        // percent 必须是原始 number：Number() 会把 null/""/false 强转为 0，
        // 后端对缺失字段返回 null 时会被误算成 0%（未使用）而非丢弃窗口
        const pct = w.percent;
        if (typeof pct !== "number" || !Number.isFinite(pct)) {
            return null;
        }
        return {
            pct,
            sec: toResetSec(Date.parse(w.resetsAt), now),
        };
    };

    const usage = payload?.usage;
    return {
        rolling: toWindow(usage?.rolling),
        weekly: toWindow(usage?.weekly),
        monthly: toWindow(usage?.monthly),
    };
}

// #endregion 解析工具 --------------------------------

// #region 用量请求 ----------------

/**
 * 请求 OpenCode Go 用量端点并解析
 *
 * 错误判别顺序：error.type 优先于状态码（同一类限流/WAF 也回 403，按状态码会把它们
 * 误报成无活跃套餐）；EntitlementError→无 Go 订阅，AuthError/401/跳登录页→key 无效
 *
 * @param {string} apiKey OpenCode Go 的 API Key
 * @returns {Promise<{
 *     rolling: { pct: number, sec: number } | null,
 *     weekly: { pct: number, sec: number } | null,
 *     monthly: { pct: number, sec: number } | null
 * }>}
 * @throws {Error} key 无效 / 无 Go 订阅 / 结构异常
 */
async function fetchUsage(apiKey) {
    const resp = await fetchWithTimeout(USAGE_URL, {
        headers: {
            authorization: `Bearer ${apiKey}`,
            accept: "application/json",
            "user-agent": BROWSER_UA,
        },
        // 不自动跟随 3xx：未鉴权被重定向到登录页要与「200 + 用量响应」区分开
        redirect: "manual",
    });

    if (!resp.ok) {
        const errType = await readErrorType(resp);
        if (errType === "EntitlementError") {
            throw new Error(NO_ACTIVE_PLAN);
        }
        if (errType === "AuthError" || resp.status === 401) {
            throw new Error(INVALID_API_KEY);
        }
        const location =
            resp.status >= 300 && resp.status < 400
                ? resp.headers.get("location")
                : null;
        if (location) {
            throw new Error(`${INVALID_API_KEY}(重定向到 ${location})`);
        }
        throw new Error(httpStatusError(resp.status));
    }

    const payload = await readJsonResponse(resp);
    const usage = parseUsageResponse(payload);
    ensureAnyWindow(usage);
    return usage;
}

/**
 * 读取错误响应体的 error.type 字段
 *
 * 非 JSON 或无该字段时返回 null，由调用方回落到状态码判断
 *
 * @param {Response} resp fetch Response
 * @returns {Promise<string | null>} 错误类型名，如 "EntitlementError"
 */
async function readErrorType(resp) {
    try {
        const body = await resp.json();
        const type = body?.error?.type;
        return typeof type === "string" ? type : null;
    } catch (err) {
        // 超时由 AbortSignal.timeout 触发（DOMException name=TimeoutError），吞掉会让
        // 调用方落到 HTTP 状态码分支报「请求失败(HTTP 5xx)」而非「请求超时」，
        // 与 readJsonResponse 的处理一致，原样抛
        if (err?.name === "TimeoutError" || err?.name === "AbortError") {
            throw err;
        }
        return null;
    }
}

// #endregion 用量请求 --------------------------------

// #region 查询入口 ----------------

/**
 * 查询 OpenCode Go 用量并返回渲染后的输出行
 *
 * 不抛出异常：出错时返回带账号标签前缀的错误字符串，便于调用方保持退出码 0
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
    return runQueryUsage(
        {
            key: KEY,
            defaultLabels: DEFAULT_LABELS[KEY],
            readCredential: (account) => (account.apiKey || "").trim(),
            missingCredential: "配置缺少 apiKey，请填入 OpenCode Go 的 API Key",
            fetchUsage,
        },
        options,
    );
}

// #endregion 查询入口 --------------------------------

// #region CLI 壳 ----------------

if (isMainModule(import.meta.url)) {
    await runQueryCli(queryUsage, DEFAULT_LABELS[KEY]);
}

// #endregion CLI 壳 --------------------------------
