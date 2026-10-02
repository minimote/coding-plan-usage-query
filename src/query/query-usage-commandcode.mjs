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
    KEYS,
    NO_ACTIVE_PLAN,
    INVALID_API_KEY,
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

const KEY = KEYS.COMMANDCODE;

const BASE_URL = "https://api.commandcode.ai";

/**
 * planId → 月度额度上限（美元）
 *
 * 月上限是商业定价，API 响应中不存在（credits.monthlyCredits 是月剩余不是月上限），
 * 只能按 planId 查表；上游定价调整或上新套餐时需同步维护此表。
 * 查表失败时抛错而非静默隐去月窗口：月额度是最关键的限额，看不到必须让用户知道要更新工具
 * @type {Object<string, number>}
 */
const PLAN_MONTHLY_CREDITS = Object.freeze({
    "individual-go": 10,
    "individual-goat": 70,
    "individual-pro": 30,
    "individual-pro-v1": 80,
    "individual-provider": 15,
    "individual-max": 150,
    "individual-ultra": 300,
    "teams-pro": 40,
});

// #endregion 配置常量 --------------------------------

// #region 解析工具 ----------------

/**
 * 解析 credits + subscriptions 两份响应为项目标准 usage 结构
 *
 * 窗口数据来自 credits.windowLimits（resetAt 为毫秒 epoch 数字）；
 * 月度窗口由 planId 查表上限与 credits.monthlyCredits（月剩余）计算得出
 *
 * 月度上限不在任何响应字段里，只能按 planId 查表。planId 未收录（上游新增/改名套餐）
 * 时百分比算不出来，但 5h/周窗口仍然有效，故只降级月窗口并在 usage.note 附说明，
 * 不让整行失败——否则用户连其他窗口的用量都看不到
 *
 * @param {object} credits /alpha/billing/credits 响应体
 * @param {object} subs /alpha/billing/subscriptions 响应体
 * @param {number} [now=Date.now()] 当前时间戳，用于计算倒计时
 * @returns {{
 *     rolling: { pct: number, sec: number } | null,
 *     weekly: { pct: number, sec: number } | null,
 *     monthly: { pct: number, sec: number } | null,
 *     note: string | null
 * }}
 */
export function parseUsageResponse(credits, subs, now = Date.now()) {
    const toWindow = (w) => {
        if (!w || typeof w !== "object") {
            return null;
        }
        // cap/used 必须是原始 number：Number() 会把 null/""/false 强转为 0，
        // 后端对缺失字段返回 null 时会被误算成 0%（未使用）而非丢弃窗口
        const cap = w.cap;
        const used = w.used;
        if (
            typeof cap !== "number" ||
            !Number.isFinite(cap) ||
            typeof used !== "number" ||
            !Number.isFinite(used) ||
            cap <= 0
        ) {
            return null;
        }
        return {
            pct: (used / cap) * 100,
            sec: toResetSec(w.resetAt, now),
        };
    };

    const windows = credits?.windowLimits;
    // monthlyCredits 必须是原始 number：Number() 会把 null/""/false 强转为 0，
    // 后端对无月度额度的套餐返回 null 时会被误算成 100%（已耗尽），开启
    // hideOnMonthlyExhausted 时还会因此隐藏整行
    const monthlyCredits = credits?.credits?.monthlyCredits;
    const monthly = monthlyWindow(
        subs?.data?.planId,
        monthlyCredits,
        toMonthSec(subs?.data?.currentPeriodEnd, now),
    );
    return {
        rolling: toWindow(windows?.fiveHour),
        weekly: toWindow(windows?.weekly),
        monthly: monthly.window,
        note: monthly.note,
    };
}

/**
 * planId + 月剩余 → 月度窗口与（可能的）降级说明
 *
 * 上游把 purchasedCredits 计入 monthlyCredits，超额购买后月剩余会大于套餐上限，
 * 算出的百分比为负；负值意味着本工具算不出可信的月用量（而非「未使用」），
 * 故按数据不可信丢窗口，交由渲染层显示 月:-- 而不是绿色的 0%
 *
 * @param {string} planId subscriptions.data.planId
 * @param {unknown} monthlyCredits credits.credits.monthlyCredits
 * @param {number | null} periodSec 月度周期剩余秒数（由 currentPeriodEnd 算出）
 * @returns {{ window: { pct: number, sec: number } | null, note: string | null }}
 *          window 为 null 时显示 月:--；note 为需要用户知晓的降级原因
 */
function monthlyWindow(planId, monthlyCredits, periodSec) {
    const remaining =
        typeof monthlyCredits === "number" && Number.isFinite(monthlyCredits)
            ? monthlyCredits
            : null;

    if (typeof planId !== "string" || !planId) {
        // 无套餐名（未订阅/字段缺失）时无从换算，也不能凭空报错
        return { window: null, note: null };
    }
    const planLimit = PLAN_MONTHLY_CREDITS[planId];
    // 判类型而非 !== undefined：planId 若撞上 Object.prototype 的键名（toString 等），
    // 下标取值得到的是函数，会把「未收录」漏过去并算出 NaN 百分比
    if (typeof planLimit !== "number") {
        // 上游新增/改名套餐：月上限无从得知，但不让整行失败——5h/周窗口仍然有效，
        // 用户也该看得到。只把能拿到的那两项（月剩余、套餐名）如实说出来
        return {
            window: null,
            note:
                remaining === null
                    ? `当前为「${planId}」套餐，月总额度未知`
                    : `月剩余 $${remaining.toFixed(2)}，当前为「${planId}」套餐`,
        };
    }
    if (remaining === null) {
        return { window: null, note: null };
    }
    const pct = ((planLimit - remaining) / planLimit) * 100;
    // 负值 = 超额购买致月剩余大于上限，数据不可信
    return {
        window: pct < 0 ? null : { pct, sec: periodSec },
        note: null,
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
    return toResetSec(t, now);
}

// #endregion 解析工具 --------------------------------

// #region API 调用 ----------------

/**
 * 请求 Command Code 内部端点，返回解析后的 JSON
 *
 * @param {string} path 以 / 开头的路径（可含 query）
 * @param {string} apiKey
 * @returns {Promise<object>}
 * @throws {Error} 401/403 → apiKey 无效；其他非 2xx 抛 HTTP 错误
 */
async function callApi(path, apiKey) {
    const resp = await fetchWithTimeout(BASE_URL + path, {
        headers: {
            authorization: `Bearer ${apiKey}`,
            accept: "application/json",
        },
    });

    // 401/403 指向 key 本身（填错/被吊销/无 scope）；套餐过期表现为 200 + 窗口全 null，
    // 不走这两个码，故 403 不应判成「无活跃套餐」（会被 hideOnNoActivePlan 静默吞掉）
    if (resp.status === 401 || resp.status === 403) {
        throw new Error(INVALID_API_KEY);
    }
    if (!resp.ok) {
        throw new Error(httpStatusError(resp.status));
    }

    return readJsonResponse(resp);
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

    // 无活跃订阅时上游返回 200 且 subscriptions.data 为 null；先拦下避免三窗口全空
    // 误报「响应结构异常」
    if (!subs?.data) {
        throw new Error(NO_ACTIVE_PLAN);
    }

    const usage = parseUsageResponse(credits, subs);
    ensureAnyWindow(usage);
    return usage;
}

// #endregion API 调用 --------------------------------

// #region 查询入口 ----------------

/**
 * 查询 Command Code 用量并返回渲染后的输出行
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
            missingCredential: "apiKey 为空，请填入 Command Code API Key",
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
