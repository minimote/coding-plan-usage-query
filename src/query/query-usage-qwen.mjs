/**
 * @file 阿里云千问 Token Plan 个人版用量查询
 *
 * 纯查询脚本：cookie 失效时显示错误，不自动登录
 * 登录请运行 login-qwen.cmd（或 node src/login/login-qwen.mjs）
 *
 * 用法:
 *   node query-usage-qwen.mjs
 *
 * 参数:
 *   --position / -p    <n>               账号位置（0 开始，默认 0）
 *   --display / -d     auto|long|short   显示模式，默认 auto
 *
 * 也可被 import 后调用 queryUsage(options)
 */

import {
    KEYS,
    NO_ACTIVE_PLAN,
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

const KEY = KEYS.QWEN;

const USAGE_URL =
    "https://cs-data.qianwenai.com/data/api.json" +
    "?product=sfm_qwen&action=BroadScopeAspnGateway" +
    "&api=zeldaHttp.apikeyMgr.%2Ftokenplan%2Fpersonal%2Fapi%2Fv2%2Fusage";

const ORIGIN = "https://platform.qianwenai.com";
const REFERER =
    "https://platform.qianwenai.com/home/billing/subscription/token-plan-individual";

const PARAMS = encodeURIComponent(
    JSON.stringify({
        Api: "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage",
        Data: {
            cornerstoneParam: {
                domain: "platform.qianwenai.com",
                consoleSite: "QIANWENAI",
                console: "ONE_CONSOLE",
                xsp_lang: "zh-CN",
                protocol: "V2",
                productCode: "p_efm",
            },
        },
        V: "1.0",
    }),
);
const BODY = `product=sfm_qwen&action=BroadScopeAspnGateway&region=cn-beijing&params=${PARAMS}`;

// #endregion 配置常量 --------------------------------

// #region 登录失效文案 ----------------

/** cookie 失效的提示（直接以 Error 抛出，壳层透传 message，无需专门的重试子类） */
const LOGIN_EXPIRED = "cookie 失效，请运行 login-qwen.cmd 重新登录";

// #endregion 登录失效文案 --------------------------------

// #region API 调用 ----------------

/**
 * 调用千问 usage 接口，返回 data.DataV2.data.data
 *
 * @param {string} cookie 千问登录 cookie
 * @returns {Promise<object>}
 * @throws {Error} cookie 失效 / 其他错误
 */
async function callUsageApi(cookie) {
    const resp = await fetchWithTimeout(USAGE_URL, {
        method: "POST",
        headers: {
            accept: "application/json, text/plain, */*",
            "content-type": "application/x-www-form-urlencoded",
            cookie,
            origin: ORIGIN,
            referer: REFERER,
            "user-agent": BROWSER_UA,
        },
        body: BODY,
    });

    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        let detail = "";
        try {
            const j = JSON.parse(text);
            detail = j?.data?.errorMsg || j?.message || j?.errorMsg || "";
        } catch {
            /* 响应非 JSON，忽略 */
        }
        throw new Error(
            detail
                ? `请求失败(HTTP ${resp.status}) (${detail})`
                : httpStatusError(resp.status),
        );
    }

    const json = await readJsonResponse(resp);

    const data = json?.data;
    if (!data || data.success === false) {
        const code = data?.errorCode || "";
        if (code.includes("NotLogined")) {
            throw new Error(LOGIN_EXPIRED);
        }
        throw new Error(data?.errorMsg || `接口返回失败: ${code}`);
    }

    const inner = data?.DataV2?.data?.data;
    if (!inner) {
        // 套餐过期/未订阅时接口返回 SUCCESS 但 data 内层为空，视为无活跃套餐
        throw new Error(NO_ACTIVE_PLAN);
    }
    return inner;
}

/**
 * 解析 usage 响应为项目标准 usage 结构
 *
 * 千问无月度窗口，故不返回 monthly 键
 *
 * @param {object} data data.DataV2.data.data
 * @param {number} [now=Date.now()] 当前时间戳，用于计算倒计时
 * @returns {{ rolling: ({pct:number,sec:number}|null), weekly: ({pct:number,sec:number}|null) }}
 */
export function parseUsageResponse(data, now = Date.now()) {
    const toWindow = (pct, reset) => {
        if (typeof pct !== "number" || !Number.isFinite(pct)) {
            return null;
        }
        // 不钳制：负数（重置时间已过 / 无重置如 null、空串）与 null（字段缺失）原样透传，
        // 由 renderWindows 统一显示 ↻ --，不再显示「0 分钟后重置」
        return { pct: pct * 100, sec: toResetSec(reset, now) };
    };
    return {
        rolling: toWindow(data.per5HourPercentage, data.per5HourResetTime),
        weekly: toWindow(data.per1WeekPercentage, data.per1WeekResetTime),
    };
}

/**
 * 查询用量，返回 renderWindows 可消费的格式
 *
 * @param {string} cookie
 * @returns {Promise<object>}
 */
async function fetchUsage(cookie) {
    const data = await callUsageApi(cookie);
    const usage = parseUsageResponse(data);
    // 字段全缺失或改名时主动报错，避免静默渲染 0% 用量误导用户
    ensureAnyWindow(usage);
    return usage;
}

// #endregion API 调用 --------------------------------

// #region 查询入口 ----------------

/**
 * 查询千问 Token Plan 用量并返回渲染后的输出行
 *
 * 纯查询：cookie 为空或失效时返回错误行，不触发登录
 *
 * @param {object} [options]
 * @param {number} [options.position=0] 账号位置
 * @param {"auto"|"long"|"short"} [options.display=DISPLAY.AUTO] 展示档位
 * @param {boolean} [options.cache=false] 启用结果缓存
 * @param {object} [options._config] 内部：已解析的 config 对象，避免重复读取
 * @returns {Promise<string>} 输出行
 */
export async function queryUsage(options = {}) {
    return runQueryUsage(
        {
            key: KEY,
            defaultLabels: DEFAULT_LABELS[KEY],
            readCredential: (account) => (account.cookie || "").trim(),
            missingCredential: "cookie 为空，请运行 login-qwen.cmd 登录",
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
