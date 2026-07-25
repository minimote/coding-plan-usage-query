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
    DISPLAY,
    KEYS,
    DEFAULT_LABELS,
    renderWindows,
    renderErrorLine,
    loadConfig,
    resolvePrefixes,
    findAccount,
    fetchUsageCached,
    writeCache,
    isMainModule,
    parseArgs,
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
const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0";

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

// #region 登录失效错误 ----------------

class LoginExpiredError extends Error {
    constructor(message = "cookie 失效") {
        super(message);
        this.name = "LoginExpiredError";
    }
}

// #endregion 登录失效错误 --------------------------------

// #region API 调用 ----------------

/**
 * 调用千问 usage 接口，返回 data.DataV2.data.data
 *
 * @param {string} cookie 千问登录 cookie
 * @returns {Promise<object>}
 * @throws {LoginExpiredError} cookie 失效
 * @throws {Error} 其他错误
 */
async function callUsageApi(cookie) {
    const resp = await fetch(USAGE_URL, {
        method: "POST",
        headers: {
            accept: "application/json, text/plain, */*",
            "content-type": "application/x-www-form-urlencoded",
            cookie,
            origin: ORIGIN,
            referer: REFERER,
            "user-agent": UA,
        },
        body: BODY,
        signal: AbortSignal.timeout(5000),
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
            `HTTP ${resp.status}${detail ? ` (${detail})` : ""}`,
        );
    }

    let json;
    try {
        json = await resp.json();
    } catch {
        throw new Error("响应非 JSON");
    }

    const data = json?.data;
    if (!data || data.success === false) {
        const code = data?.errorCode || "";
        if (code.includes("NotLogined")) {
            throw new LoginExpiredError();
        }
        throw new Error(data?.errorMsg || `接口返回失败: ${code}`);
    }

    const inner = data?.DataV2?.data?.data;
    if (!inner) {
        throw new Error("响应结构异常");
    }
    // 字段全缺失或改名时主动报错，避免静默渲染 0% 用量误导用户
    if (
        typeof inner.per5HourPercentage !== "number" &&
        typeof inner.per1WeekPercentage !== "number"
    ) {
        throw new Error("响应结构异常，接口可能已更新");
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
        const resetNum = Number(reset);
        return {
            pct: pct * 100,
            sec: Number.isFinite(resetNum)
                ? Math.max(0, Math.round((resetNum - now) / 1000))
                : 0,
        };
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
    return parseUsageResponse(data);
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
 * @returns {Promise<string>} 输出行
 */
export async function queryUsage(options = {}) {
    const { position = 0, display = DISPLAY.AUTO, cache = false } = options;

    let prefixes = DEFAULT_LABELS[KEY];
    // 是否已进入网络查询阶段：仅对此后的失败写负缓存（配置类错误不写，原因同 ark）
    let reachedFetch = false;
    try {
        const cfg = loadConfig();
        const account = findAccount(cfg[KEY], position);
        prefixes = resolvePrefixes(account, DEFAULT_LABELS[KEY]);
        const cookie = (account.cookie || "").trim();

        if (!cookie) {
            return renderErrorLine(
                prefixes,
                display,
                "cookie 为空，请运行 login-qwen.cmd 登录",
            );
        }

        reachedFetch = true;
        const result = await fetchUsageCached(`${KEY}:${position}`, cache, () =>
            fetchUsage(cookie),
        );
        if (result.output !== undefined) {
            return result.output;
        }
        return renderWindows(result.usage, display, prefixes);
    } catch (err) {
        const output = renderErrorLine(
            prefixes,
            display,
            err instanceof LoginExpiredError
                ? "cookie 失效，请运行 login-qwen.cmd 重新登录"
                : err.message,
        );
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
