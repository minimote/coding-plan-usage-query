/**
 * @file 火山方舟 Coding Plan / Agent Plan 用量查询
 *
 * 读取 config.json 的 ark 数组获取凭据
 * 调用方舟控制台 OpenAPI 查询用量信息
 *
 * 用法:
 *   node query-usage-ark.mjs
 *
 * 参数:
 *   --type / -t       套餐类型：coding(c) | agent(a)，未传时用账号 type，再回退 coding
 *   --display / -d    显示模式：auto(a,默认) | long(l) | short(s)
 *   --position / -p   账号位置（0 开始，默认 0）
 *   --hide-on-monthly-exhausted  月度用量耗尽时隐藏该行（true|false，默认 false）
 *
 * 也可被 import 后调用 queryUsage(options)
 */

import {
    DISPLAY,
    TYPE,
    KEYS,
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
} from "../utils/utils-query-usage.mjs";
import { createHmac, createHash } from "crypto";

// #region 配置常量 ----------------

const HOST = "open.volcengineapi.com";
const SERVICE = "ark";
const REGION = "cn-beijing";
const VERSION = "2024-01-01";
const KEY = KEYS.ARK;

// #endregion 配置常量 --------------------------------

// #region 签名工具 ----------------

/**
 * HMAC-SHA256 摘要
 * @param {string | Buffer} key
 * @param {string | Buffer} data
 * @returns {Buffer}
 */
function hmacSha256(key, data) {
    return createHmac("sha256", key).update(data).digest();
}

/**
 * SHA-256 → 小写 hex
 * @param {string | Buffer} data
 * @returns {string}
 */
function sha256Hex(data) {
    return createHash("sha256").update(data).digest("hex");
}

/**
 * RFC 3986 百分号编码（unreserved 原样保留）
 * @param {string} input
 * @returns {string}
 */
function uriEncode(input) {
    let out = "";
    for (let i = 0; i < input.length; i++) {
        const ch = input.charCodeAt(i);
        if (
            (ch >= 0x41 && ch <= 0x5a) ||
            (ch >= 0x61 && ch <= 0x7a) ||
            (ch >= 0x30 && ch <= 0x39) ||
            ch === 0x2d ||
            ch === 0x5f ||
            ch === 0x2e ||
            ch === 0x7e
        ) {
            out += input[i];
        } else {
            out += "%" + ch.toString(16).toUpperCase().padStart(2, "0");
        }
    }
    return out;
}

/**
 * 火山引擎签名 V4（AWS SigV4 变体）
 *
 * canonical headers 固定 host;x-date;x-content-sha256;content-type
 * algorithm 无 AWS4 前缀，credential scope 结尾为 request
 *
 * @param {string} ak     AccessKey ID
 * @param {string} sk     SecretAccessKey
 * @param {string} region 区域
 * @param {string} query  规范化 query string
 * @param {string} body   请求体
 * @returns {{ authorization: string, xDate: string, xContentSha256: string }}
 */
function signVolcengine(ak, sk, region, query, body) {
    const now = new Date();
    const xDate = now
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
    const shortDate = xDate.slice(0, 8);
    const bodyHash = sha256Hex(body);

    const NL = "\n";
    const canonicalHeaders =
        `host:${HOST}${NL}` +
        `x-date:${xDate}${NL}` +
        `x-content-sha256:${bodyHash}${NL}` +
        `content-type:application/json; charset=utf-8${NL}`;
    const signedHeaders = "host;x-date;x-content-sha256;content-type";
    const canonicalRequest = `POST\n/\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${bodyHash}`;

    const credentialScope = `${shortDate}/${region}/${SERVICE}/request`;
    const stringToSign = `HMAC-SHA256\n${xDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

    const kDate = hmacSha256(sk, shortDate);
    const kRegion = hmacSha256(kDate, region);
    const kService = hmacSha256(kRegion, SERVICE);
    const kSigning = hmacSha256(kService, "request");
    const signature = hmacSha256(kSigning, stringToSign).toString("hex");

    return {
        authorization:
            `HMAC-SHA256 Credential=${ak}/${credentialScope}, ` +
            `SignedHeaders=${signedHeaders}, Signature=${signature}`,
        xDate,
        xContentSha256: bodyHash,
    };
}

// #endregion 签名工具 --------------------------------

// #region API 调用 ----------------

/**
 * 构造规范化 query string（参数按 key 字母序）
 * @param {string} action OpenAPI Action 名
 * @returns {string}
 */
function buildCanonicalQuery(action) {
    const pairs = [
        ["Action", action],
        ["Region", REGION],
        ["Version", VERSION],
    ];
    pairs.sort((a, b) => a[0].localeCompare(b[0]));
    return pairs.map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join("&");
}

/**
 * 调用方舟 OpenAPI，返回解析后的 JSON
 *
 * @param {string} action
 * @param {string} ak
 * @param {string} sk
 * @returns {Promise<object>}
 */
async function callOpenApi(action, ak, sk) {
    const canonicalQuery = buildCanonicalQuery(action);
    const body = "";
    const { authorization, xDate, xContentSha256 } = signVolcengine(
        ak,
        sk,
        REGION,
        canonicalQuery,
        body,
    );

    const resp = await fetch(`https://${HOST}/?${canonicalQuery}`, {
        method: "POST",
        headers: {
            "X-Date": xDate,
            "X-Content-Sha256": xContentSha256,
            "Content-Type": "application/json; charset=utf-8",
            Authorization: authorization,
        },
        body,
        signal: AbortSignal.timeout(3000),
    });

    if (!resp.ok) {
        const text = await resp.text();
        let detail = "";
        try {
            const e = (JSON.parse(text).ResponseMetadata || {}).Error;
            if (e) {
                detail = ` (${e.Code}: ${e.Message})`;
            }
        } catch {
            /* 忽略 */
        }
        throw new Error(`HTTP ${resp.status}${detail}`);
    }

    const data = await resp.json();
    const meta = data.ResponseMetadata;
    if (meta?.Error) {
        throw new Error(`${meta.Error.Code}: ${meta.Error.Message}`);
    }
    return data;
}

/**
 * @typedef {Object} TierItem
 * @property {string} label      窗口标识（session / weekly / monthly）
 * @property {number} percent    已用百分比 0-100
 * @property {number | string | null} resetTimestamp 重置时间戳
 */

/**
 * 解析 GetCodingPlanUsage 响应
 *
 * 响应结构：Result.QuotaUsage[{ Level, Percent, ResetTimestamp }]
 * Level 取值 session/weekly/monthly；ResetTimestamp 为 Unix 秒，-1 表示无重置
 *
 * @param {object} data
 * @returns {TierItem[]}
 */
export function parseCodingPlanResponse(data) {
    const result = data.Result || data;
    const windows = result.QuotaUsage;
    if (!Array.isArray(windows)) {
        return [];
    }

    return windows.map((item) => ({
        label: (item.Level || "").toLowerCase(),
        percent: parseFloat(item.Percent ?? 0),
        resetTimestamp: item.ResetTimestamp ?? null,
    }));
}

/**
 * 解析 GetAFPUsage 响应
 *
 * AFP 配额为绝对额度（Quota/Used），需转为百分比
 * Quota ≤ 0 视为未订阅，跳过
 *
 * @param {object} data
 * @returns {{ planType: string | null, tiers: TierItem[] }}
 */
export function parseAfpResponse(data) {
    const result = data.Result || data;
    const planType = result.PlanType ? String(result.PlanType).trim() : null;

    /** @type {TierItem[]} */
    const tiers = [];

    for (const [field, label] of [
        ["AFPFiveHour", "session"],
        ["AFPWeekly", "weekly"],
        ["AFPMonthly", "monthly"],
    ]) {
        const window = result[field];
        if (!window) {
            continue;
        }

        const quota = parseFloat(window.Quota ?? 0);
        if (quota <= 0) {
            continue;
        }

        tiers.push({
            label,
            percent: Math.min(
                (parseFloat(window.Used ?? 0) / quota) * 100,
                100,
            ),
            resetTimestamp: window.ResetTime || null,
        });
    }

    return { planType, tiers };
}

// #endregion API 调用 --------------------------------

// #region 格式适配 ----------------

/**
 * 查询用量，返回 renderWindows 可直接消费的格式
 *
 * 整合 API 调用 → 响应解析 → 时间戳转倒计时秒数
 *
 * @param {string} ak  AccessKey ID
 * @param {string} sk  SecretAccessKey
 * @param {"coding" | "agent"} type 套餐类型
 * @returns {Promise<{
 *     rolling: ({ pct: number, sec: number } | null),
 *     weekly: ({ pct: number, sec: number } | null),
 *     monthly: ({ pct: number, sec: number } | null)
 * }>}
 */
async function fetchUsage(ak, sk, type) {
    const apiAction =
        type === TYPE.CODING ? "GetCodingPlanUsage" : "GetAFPUsage";
    const data = await callOpenApi(apiAction, ak, sk);

    const tiers =
        type === TYPE.CODING
            ? parseCodingPlanResponse(data)
            : parseAfpResponse(data).tiers;

    if (!tiers || tiers.length === 0) {
        throw new Error("无活跃套餐");
    }

    const now = Math.floor(Date.now() / 1000);

    /** @param {string} key 窗口标识（session / weekly / monthly） */
    const getUsage = (key) => {
        const item = tiers.find((t) => t.label === key);
        if (!item) {
            return null;
        }
        let sec = 0;
        if (item.resetTimestamp != null) {
            const ts =
                typeof item.resetTimestamp === "number"
                    ? item.resetTimestamp
                    : parseInt(item.resetTimestamp, 10);
            sec = (ts > 1e12 ? Math.floor(ts / 1000) : ts) - now;
        }
        return { pct: item.percent, sec };
    };

    return {
        rolling: getUsage("session"),
        weekly: getUsage("weekly"),
        monthly: getUsage("monthly"),
    };
}

// #endregion 格式适配 --------------------------------

// #region 查询入口 ----------------

/**
 * 查询火山方舟用量并返回渲染后的输出行
 *
 * 不抛出异常：出错时返回带默认标签前缀的错误字符串，便于调用方保持退出码 0
 *
 * @param {object} [options]
 * @param {number} [options.position=0] 账号位置（0 开始）
 * @param {"auto" | "long" | "short"} [options.display=DISPLAY.AUTO] 展示档位
 * @param {"coding" | "agent"} [options.type] 套餐类型；缺省时用账号 type，再缺省用 coding
 * @param {boolean} [options.hideOnMonthlyExhausted=false] 月度耗尽时隐藏
 * @param {boolean} [options.cache=false] 启用结果缓存（含错误负缓存）
 * @returns {Promise<string>} 输出行；隐藏时为空字符串
 */
export async function queryUsage(options = {}) {
    const {
        position = 0,
        display = DISPLAY.AUTO,
        type: optType,
        hideOnMonthlyExhausted = false,
        cache = false,
    } = options;

    // 出错时 catch 用于选错误前缀的套餐类型，随解析推进逐步细化
    let effType = Object.values(TYPE).includes(optType) ? optType : TYPE.CODING;
    try {
        const cfg = loadConfig();
        const account = findAccount(cfg[KEY], position);

        // 套餐类型优先级：调用方 type > 账号 type > 默认 coding
        const type = Object.values(TYPE).includes(optType)
            ? optType
            : Object.values(TYPE).includes(account.type)
              ? account.type
              : TYPE.CODING;
        effType = type;
        const ak = (account.accessKeyId || "").trim();
        const sk = (account.secretAccessKey || "").trim();
        if (!ak || !sk) {
            throw new Error("配置缺少 accessKeyId 或 secretAccessKey");
        }

        const prefixes = resolvePrefixes(account, DEFAULT_LABELS[KEY][type]);

        const result = await fetchUsageCached(
            `${KEY}:${position}:${type}`,
            cache,
            () => fetchUsage(ak, sk, type),
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
        const output = renderErrorLine(
            DEFAULT_LABELS[KEY][effType],
            display,
            err.message,
        );
        if (cache) {
            writeCache(`${KEY}:${position}:${effType}`, { output });
        }
        return output;
    }
}

// #endregion 查询入口 --------------------------------

// #region CLI 壳 ----------------

async function main() {
    let display = DISPLAY.AUTO;
    let type = TYPE.CODING;
    try {
        const parsed = parseArgs(process.argv);
        display = parsed.display;
        if (Object.values(TYPE).includes(parsed.type)) {
            type = parsed.type;
        }
        const output = await queryUsage(parsed);
        if (output) {
            console.log(output);
        }
    } catch (err) {
        // queryUsage 不抛错，此处只兜底 parseArgs 失败
        console.log(
            renderErrorLine(DEFAULT_LABELS[KEY][type], display, err.message),
        );
    }
}

if (isMainModule(import.meta.url)) {
    main();
}

// #endregion CLI 壳 --------------------------------
