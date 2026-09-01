/**
 * @file Command Code 用量查询
 *
 * 读取 config.json 的 commandcode 数组获取凭据
 * 并行请求 billing/credits 与 billing/subscriptions 两个内部端点，
 * credits 给窗口用量（5h/周）与月剩余额度，subscriptions 给 planId（查表得月上限）
 * 与月度周期，两者缺一不可
 *
 * 用法:
 *   node query-usage-commandcode.mjs
 *
 * 参数:
 *   --position / -p    <n>               账号位置（0 开始，默认 0）
 *   --display / -d     auto|long|short   显示模式，默认 auto
 *   --hide-on-monthly-exhausted  月度用量耗尽时隐藏该行（true|false，默认 false）
 *
 * 也可被 import 后调用 queryUsage(options)
 */

import {
    DISPLAY,
    KEYS,
    NO_ACTIVE_PLAN,
    DEFAULT_LABELS,
    renderWindows,
    renderErrorLine,
    friendlyError,
    loadConfig,
    resolvePrefixes,
    findAccount,
    fetchUsageCached,
    writeCache,
    isMainModule,
    parseArgs,
    REQUEST_TIMEOUT_MS,
} from "../utils/utils-query-usage.mjs";

// #region 配置常量 ----------------

const KEY = KEYS.COMMANDCODE;

const BASE_URL = "https://api.commandcode.ai";

/**
 * planId → 月度额度上限（美元）
 *
 * 月上限是商业定价，API 响应中不存在（credits.monthlyCredits 是月剩余不是月上限），
 * 只能按 planId 查表；上游定价调整或上新套餐时需同步维护此表
 * @type {Object<string, number>}
 */
const PLAN_MONTHLY_CREDITS = {
    "individual-go": 10,
    "individual-goat": 70,
    "individual-pro": 30,
    "individual-pro-v1": 80,
    "individual-provider": 15,
    "individual-max": 150,
    "individual-ultra": 300,
    "teams-pro": 40,
};

// #endregion 配置常量 --------------------------------

// #region 解析工具 ----------------

/**
 * 解析 credits + subscriptions 两份响应为项目标准 usage 结构
 *
 * 窗口数据来自 credits.windowLimits（resetAt 为毫秒 epoch 数字）；
 * 月度窗口由 planId 查表上限与 credits.monthlyCredits（月剩余）计算得出，
 * 查不到表时月剩余无处安放 → monthly 为 null（渲染层显示 月:--）
 *
 * @param {object} credits /alpha/billing/credits 响应体
 * @param {object} subs /alpha/billing/subscriptions 响应体
 * @param {number} [now=Date.now()] 当前时间戳，用于计算倒计时
 * @returns {{
 *     rolling: { pct: number, sec: number } | null,
 *     weekly: { pct: number, sec: number } | null,
 *     monthly: { pct: number, sec: number } | null
 * }}
 */
export function parseUsageResponse(credits, subs, now = Date.now()) {
    const toWindow = (w) => {
        if (!w || typeof w !== "object") {
            return null;
        }
        const cap = Number(w.cap);
        // used 必须是原始 number：Number() 会把 null/""/false 强转为 0，
        // 后端对缺失字段返回 null 时会被误算成 0%（未使用）而非丢弃窗口
        const used = w.used;
        if (
            typeof used !== "number" ||
            !Number.isFinite(used) ||
            !Number.isFinite(cap) ||
            cap <= 0
        ) {
            return null;
        }
        const resetNum = Number(w.resetAt);
        return {
            pct: (used / cap) * 100,
            // 毫秒 epoch → 秒倒计时；缺失/非法 → null（渲染层显示 ↻ --）
            sec:
                Number.isFinite(resetNum) && resetNum > 0
                    ? Math.round((resetNum - now) / 1000)
                    : null,
        };
    };

    const windows = credits?.windowLimits;
    // monthlyCredits 必须是原始 number：Number() 会把 null/""/false 强转为 0，
    // 后端对无月度额度的套餐返回 null 时会被误算成 100%（已耗尽），开启
    // hideOnMonthlyExhausted 时还会因此隐藏整行
    const monthlyCredits = credits?.credits?.monthlyCredits;
    const planLimit = PLAN_MONTHLY_CREDITS[subs?.data?.planId];
    // 月度窗口：上限查表 + 剩余来自 API；缺一即 null，不凭空估算
    const monthly =
        Number.isFinite(planLimit) &&
        planLimit > 0 &&
        typeof monthlyCredits === "number" &&
        Number.isFinite(monthlyCredits)
            ? {
                  pct: ((planLimit - monthlyCredits) / planLimit) * 100,
                  sec: toMonthSec(subs?.data?.currentPeriodEnd, now),
              }
            : null;

    return {
        rolling: toWindow(windows?.fiveHour),
        weekly: toWindow(windows?.weekly),
        monthly,
    };
}

/**
 * 月度周期结束时间（ISO 字符串）→ 秒倒计时
 * @param {string} iso currentPeriodEnd
 * @param {number} now
 * @returns {number | null}
 */
function toMonthSec(iso, now) {
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t > 0 ? Math.round((t - now) / 1000) : null;
}

// #endregion 解析工具 --------------------------------

// #region API 调用 ----------------

/**
 * 请求 Command Code 内部端点，返回解析后的 JSON
 *
 * @param {string} path 以 / 开头的路径（可含 query）
 * @param {string} apiKey
 * @returns {Promise<object>}
 * @throws {Error} 401/403 归一为「无活跃套餐」；其他非 2xx 抛 HTTP 错误
 */
async function callApi(path, apiKey) {
    const resp = await fetch(BASE_URL + path, {
        headers: {
            authorization: `Bearer ${apiKey}`,
            accept: "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (resp.status === 401 || resp.status === 403) {
        // API Key 无效/被吊销表现为鉴权失败；对状态栏场景，与无活跃套餐同义
        throw new Error(NO_ACTIVE_PLAN);
    }
    if (!resp.ok) {
        throw new Error(`请求失败(HTTP ${resp.status})`);
    }

    try {
        return await resp.json();
    } catch {
        throw new Error("响应非 JSON");
    }
}

/**
 * 并行请求 credits 与 subscriptions，解析为项目标准 usage 结构
 *
 * @param {string} apiKey
 * @returns {Promise<{
 *     rolling: { pct: number, sec: number } | null,
 *     weekly: { pct: number, sec: number } | null,
 *     monthly: { pct: number, sec: number } | null
 * }>}
 */
async function fetchUsage(apiKey) {
    const [credits, subs] = await Promise.all([
        callApi("/alpha/billing/credits", apiKey),
        callApi("/alpha/billing/subscriptions", apiKey),
    ]);

    const usage = parseUsageResponse(credits, subs);
    if (
        usage.rolling === null &&
        usage.weekly === null &&
        usage.monthly === null
    ) {
        // 结构整体识别失败（字段改名/接口更新）：主动报错，避免静默渲染 0% 误导
        throw new Error("响应结构异常，接口可能已更新");
    }
    return usage;
}

// #endregion API 调用 --------------------------------

// #region 查询入口 ----------------

/**
 * 查询 Command Code 用量并返回渲染后的输出行
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

    let prefixes = DEFAULT_LABELS[KEY];
    // 是否已进入网络查询阶段：仅对此后的失败写负缓存（配置类错误不写，原因同 ark）
    let reachedFetch = false;
    try {
        const cfg = options._config || loadConfig();
        const account = findAccount(cfg[KEY], position);
        prefixes = resolvePrefixes(account, DEFAULT_LABELS[KEY]);
        const apiKey = (account.apiKey || "").trim();

        if (!apiKey) {
            return renderErrorLine(
                prefixes,
                display,
                "apiKey 为空，请填入 Command Code API Key",
            );
        }

        reachedFetch = true;
        const result = await fetchUsageCached(`${KEY}:${position}`, cache, () =>
            fetchUsage(apiKey),
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
        const output = renderErrorLine(prefixes, display, friendlyError(err));
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
        const output = await queryUsage({
            position: parsed.position,
            display: parsed.display,
            hideOnMonthlyExhausted: parsed.hideOnMonthlyExhausted,
        });
        if (output) {
            process.stdout.write(output);
        }
    } catch (err) {
        process.stdout.write(
            renderErrorLine(DEFAULT_LABELS[KEY], display, err.message) + "\n",
        );
    }
}

if (isMainModule(import.meta.url)) {
    main();
}

// #endregion CLI 壳 --------------------------------
