/**
 * @file CommandCode 用量查询
 *
 * 读取 config.json 的 commandcode 数组获取凭据
 * 并行请求 billing/credits、billing/subscriptions 与 usage/summary 三个内部端点，
 * credits 给窗口用量（5h/周）与月剩余额度，subscriptions 给月度周期，
 * summary 给本周期已花金额（与月剩余相加即为月总额度）
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

// #endregion 配置常量 --------------------------------

// #region 解析工具 ----------------

/**
 * 解析 credits + subscriptions + summary 三份响应为项目标准 usage 结构
 *
 * 月度用「已花 + 剩余」反推总额度：/alpha 不返回月上限
 *
 * @param {object} credits /alpha/billing/credits 响应体
 * @param {object} subs /alpha/billing/subscriptions 响应体
 * @param {object} summary /alpha/usage/summary 响应体
 * @param {number} [now=Date.now()] 当前时间戳，用于计算倒计时
 * @returns {{
 *     rolling: { pct: number, sec: number } | null,
 *     weekly: { pct: number, sec: number } | null,
 *     monthly: { pct: number, sec: number } | null,
 *     note: string | null
 * }}
 */
export function parseUsageResponse(credits, subs, summary, now = Date.now()) {
  const toWindow = (w) => {
    if (!w || typeof w !== "object") {
      return null;
    }
    // 必须是原始 number，Number() 会把 null/"" 强转成 0 而误算成未使用
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

  // limited 显式 false 是按量付费，不展示滚动窗口；缺失时照常展示，避免改字段名后窗口消失
  const windows = credits?.windowLimits;
  const windowLimited = windows?.limited !== false;
  const monthly = monthlyWindow(
    credits?.credits,
    toTotalCost(summary),
    toMonthSec(subs?.data?.currentPeriodEnd, now),
  );
  const usage = { monthly: monthly.window, note: monthly.note };
  // 按量付费账号不写键（缺键=平台无此窗口），而不是置 null（会被渲染成 五:--）
  if (windowLimited) {
    usage.rolling = toWindow(windows?.fiveHour);
    usage.weekly = toWindow(windows?.weekly);
  }
  return usage;
}

/**
 * summary 的本周期已花金额
 *
 * 兼容顶层与 { success, data } 包装两种响应形态；负数/非有限值视为不可用
 *
 * @param {object} summary /alpha/usage/summary 响应体
 * @returns {number | null}
 */
function toTotalCost(summary) {
  const raw = summary?.totalCost ?? summary?.data?.totalCost;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
    ? raw
    : null;
}

/**
 * 月剩余 + 本周期已花 → 月度窗口
 *
 * 分母是反推出来的月总额度（已花 + 剩余）；剩余缺失时不能按 0 计，
 * 否则分母只剩 totalCost、百分比恒为 100%
 *
 * @param {object} creditValues credits.credits
 * @param {number | null} totalCost usage/summary 的本周期已花
 * @param {number | null} periodSec 月度周期剩余秒数
 * @returns {{ window: { pct: number, sec: number } | null, note: string | null }}
 */
function monthlyWindow(creditValues, totalCost, periodSec) {
  if (totalCost === null) {
    // 分子拿不到，5h/周仍有效，只降级月窗口
    return { window: null, note: "月已花金额获取失败" };
  }
  // 必须是非负 number：Number() 会把 null/"" 强转成 0 而误算成已耗尽
  const remaining = creditValues?.monthlyCredits;
  if (typeof remaining !== "number" || !Number.isFinite(remaining) || remaining < 0) {
    return { window: null, note: "月剩余额度获取失败" };
  }
  // purchasedCredits 和 freeCredits 归属未验证，一并
  // 只按「已花 + 套餐剩余」算总额度，避免重复计数
  const pool = totalCost + remaining;
  if (pool <= 0) {
    return { window: null, note: null };
  }
  return {
    window: { pct: (totalCost / pool) * 100, sec: periodSec },
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
 * 请求 CommandCode 内部端点，返回解析后的 JSON
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

  // 401/403 指向 key 本身；套餐过期是 200 + 窗口全空，不走这两个码，
  // 故不能判成「无活跃套餐」而被 hideOnNoActivePlan 静默隐藏
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(INVALID_API_KEY);
  }
  if (!resp.ok) {
    throw new Error(httpStatusError(resp.status));
  }

  return readJsonResponse(resp);
}

/**
 * 并行请求三个端点，解析为项目标准 usage 结构
 *
 * @param {string} apiKey
 * @returns {Promise<{
 *     rolling: { pct: number, sec: number } | null,
 *     weekly: { pct: number, sec: number } | null,
 *     monthly: { pct: number, sec: number } | null,
 *     note?: string | null
 * }>}
 */
async function fetchUsage(apiKey) {
  // summary 只补月窗口，失败不该拖垮 5h/周；用常规超时，实测首次请求约 2.6s
  const summaryPromise = callApi("/alpha/usage/summary", apiKey).catch(
    () => null,
  );
  const [credits, subs] = await Promise.all([
    callApi("/alpha/billing/credits", apiKey),
    callApi("/alpha/billing/subscriptions", apiKey),
  ]);

  // 套餐过期时返回 200 + data:null，先拦下避免误报结构异常
  if (!subs?.data) {
    throw new Error(NO_ACTIVE_PLAN);
  }

  const usage = parseUsageResponse(credits, subs, (await summaryPromise) ?? {});
  ensureAnyWindow(usage);
  return usage;
}

// #endregion API 调用 --------------------------------

// #region 查询入口 ----------------

/**
 * 查询 CommandCode 用量并返回渲染后的输出行
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
      missingCredential: "apiKey 为空，请填入 CommandCode API Key",
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
