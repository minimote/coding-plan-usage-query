/**
 * @file 火山方舟 Coding Plan / Agent Plan 用量查询
 *
 * 调用方舟控制台 OpenAPI，使用火山引擎签名 V4（AK/SK）鉴权
 *
 * AK/SK 从同目录 config.json 读取（字段 ark.accessKeyId / ark.secretAccessKey）
 *
 * 用法:
 *   node query-usage-ark.mjs           ← 默认 Coding Plan
 *   node query-usage-ark.mjs coding    ← Coding Plan
 *   node query-usage-ark.mjs agent     ← Agent Plan
 */

import { createHmac, createHash } from "crypto";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { bar, toCountdown, pctColorCode } from "./query-usage-utils.mjs";

// ── Node.js 版本检查 ────────────────────────

if (parseInt(process.versions.node.split(".")[0], 10) < 18) {
    console.error(
        `火山方舟 | ❌ 需要 Node.js 18+，当前 ${process.versions.node}`,
    );
    process.exit(0);
}

// ── 配置 ────────────────────────────────

const HOST = "open.volcengineapi.com";
const SERVICE = "ark";
const REGION = "cn-beijing";
const VERSION = "2024-01-01";

// ── 读取凭据 ──────────────────────────────

/**
 * 从同目录 config.json 读取 AK/SK 凭据
 *
 * @returns {{ accessKeyId: string, secretAccessKey: string } | null}
 *   凭据对象，缺失时返回 null
 */
function loadCredentials() {
    const configFile = join(
        dirname(fileURLToPath(import.meta.url)),
        "config.json",
    );
    if (!existsSync(configFile)) return null;

    try {
        const cfg = JSON.parse(readFileSync(configFile, "utf-8"));
        const ak = (cfg.ark?.accessKeyId || "").trim();
        const sk = (cfg.ark?.secretAccessKey || "").trim();
        return ak && sk ? { accessKeyId: ak, secretAccessKey: sk } : null;
    } catch {
        return null;
    }
}

// ── 签名工具 ──────────────────────────────

/**
 * HMAC-SHA256 摘要
 *
 * @param {string | Buffer} key  密钥
 * @param {string | Buffer} data 待签名数据
 * @returns {Buffer} SHA-256 MAC
 */
function hmacSha256(key, data) {
    return createHmac("sha256", key).update(data).digest();
}

/**
 * SHA-256 摘要 → 小写十六进制字符串
 *
 * @param {string | Buffer} data 输入
 * @returns {string} 64 位 hex
 */
function sha256Hex(data) {
    return createHash("sha256").update(data).digest("hex");
}

/**
 * RFC 3986 百分号编码
 *
 * unreserved 字符（A-Z a-z 0-9 - _ . ~）原样保留，其余 %XX 编码
 *
 * @param {string} input 原始字符串
 * @returns {string} 编码后的字符串
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
 * - canonical headers 固定顺序 host;x-date;x-content-sha256;content-type
 * - algorithm = HMAC-SHA256（无 AWS4 前缀）
 * - credential scope 结尾 = request（非 aws4_request）
 * - SK 不加 AWS4 前缀
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

    const canonicalHeaders =
        `host:${HOST}\n` +
        `x-date:${xDate}\n` +
        `x-content-sha256:${bodyHash}\n` +
        `content-type:application/json; charset=utf-8\n`;
    const signedHeaders = "host;x-date;x-content-sha256;content-type";
    const canonicalRequest = `POST\n/\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${bodyHash}`;

    const credentialScope = `${shortDate}/${region}/${SERVICE}/request`;
    const stringToSign = `HMAC-SHA256\n${xDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

    const kDate = hmacSha256(sk, shortDate);
    const kRegion = hmacSha256(kDate, region);
    const kService = hmacSha256(kRegion, SERVICE);
    const kSigning = hmacSha256(kService, "request");
    const signature = hmacSha256(kSigning, stringToSign).toString("hex");

    const authorization =
        `HMAC-SHA256 Credential=${ak}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return { authorization, xDate, xContentSha256: bodyHash };
}

/**
 * 构造规范化 query string（Action / Region / Version 按 key 字母序）
 *
 * @param {string} action OpenAPI Action 名
 * @returns {string} 规范化 query string
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

// ── 调用 OpenAPI ─────────────────────────

/**
 * 调用方舟控制面 OpenAPI，返回解析后的 JSON 对象
 *
 * @param {string} action API Action 名
 * @param {string} ak     AccessKey ID
 * @param {string} sk     SecretAccessKey
 * @returns {Promise<object>} JSON 响应体
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

    const url = `https://${HOST}/?${canonicalQuery}`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "X-Date": xDate,
            "X-Content-Sha256": xContentSha256,
            "Content-Type": "application/json; charset=utf-8",
            Authorization: authorization,
        },
        body,
    });

    if (!response.ok) {
        const text = await response.text();
        let detail = "";
        try {
            const err = JSON.parse(text);
            const e = (err.ResponseMetadata || err).Error;
            if (e) detail = ` (${e.Code}: ${e.Message})`;
        } catch {
            /* 忽略 */
        }
        throw new Error(`HTTP ${response.status}${detail}`);
    }

    const data = await response.json();

    const meta = data.ResponseMetadata;
    if (meta?.Error) {
        throw new Error(`${meta.Error.Code}: ${meta.Error.Message}`);
    }

    return data;
}

// ── 解析响应 ─────────────────────────────

/**
 * @typedef {Object} TierItem
 * @property {string} label      窗口标识（session / weekly / monthly）
 * @property {number} percent    已用百分比 0-100
 * @property {number | string | null} resetTimestamp 重置时间戳（秒或毫秒）
 */

/**
 * 解析 GetCodingPlanUsage 响应
 *
 * @param {object} data 原始 JSON 响应
 * @returns {TierItem[]} 用量窗口数组
 */
function parseCodingPlanResponse(data) {
    const result = data.Result || data;
    const windows = result.QuotaUsage || result.Usages || result.Details || [];
    if (!Array.isArray(windows)) return [];

    return windows.map((w) => ({
        label: (w.Level || w.Type || w.Period || "").toLowerCase(),
        percent: parseFloat(w.Percent ?? w.UsedPercent ?? w.UsagePercent ?? 0),
        resetTimestamp: w.ResetTimestamp || w.ResetTime || null,
    }));
}

/**
 * 解析 GetAFPUsage 响应
 *
 * AFP 的配额是绝对额度（Quota/Used），需转为百分比
 * 窗口由字段名（AFPFiveHour / AFPWeekly / AFPMonthly）标识
 * Quota ≤ 0 时视为未订阅，跳过
 *
 * @param {object} data 原始 JSON 响应
 * @returns {{ planType: string | null, tiers: TierItem[] }}
 */
function parseAfpResponse(data) {
    const result = data.Result || data;
    const planType = result.PlanType ? String(result.PlanType).trim() : null;

    /** @type {[string, string][]} */
    const fieldMap = [
        ["AFPFiveHour", "session"],
        ["AFPWeekly", "weekly"],
        ["AFPMonthly", "monthly"],
    ];

    /** @type {TierItem[]} */
    const tiers = [];

    for (const [field, label] of fieldMap) {
        const win = result[field];
        if (!win) continue;

        const quota = parseFloat(win.Quota ?? 0);
        if (quota <= 0) continue;

        const used = parseFloat(win.Used ?? 0);
        const percent = Math.min((used / quota) * 100, 100);

        tiers.push({
            label,
            percent,
            resetTimestamp: win.ResetTime || null,
        });
    }

    return { planType, tiers };
}

// ── 渲染输出 ─────────────────────────────

/**
 * 将用量数据渲染为状态栏文本
 *
 * @param {TierItem[]} tiers  用量窗口数组
 * @param {string} label      简短套餐标签（如 "火山CodingPlan"）
 * @returns {string} 输出的状态栏文本
 */
function renderOutput(tiers, label) {
    if (!tiers || tiers.length === 0) {
        return `${label} | 无活跃套餐`;
    }

    const now = Math.floor(Date.now() / 1000);
    const labels = { session: "5小时", weekly: "1周", monthly: "1月" };
    const order = ["session", "weekly", "monthly"];
    const segs = [];

    for (const key of order) {
        const item = tiers.find((t) => t.label === key);
        if (!item) {
            segs.push(`${labels[key]}:—`);
            continue;
        }

        let pct = item.percent;
        if (pct < 0) pct = 0;
        if (pct > 100) pct = 100;

        let sec = 0;
        if (item.resetTimestamp != null) {
            const ts =
                typeof item.resetTimestamp === "number"
                    ? item.resetTimestamp
                    : parseInt(item.resetTimestamp, 10);
            const resetSec = ts > 1e12 ? Math.floor(ts / 1000) : ts;
            sec = resetSec - now;
        }

        const color = pctColorCode(pct);
        segs.push(
            `${labels[key]}:${bar(pct)} \x1b[${color}m${Math.round(pct)}%\x1b[0m ↻ ${toCountdown(sec)}`,
        );
    }

    return `${label} | ${segs.join(" | ")}`;
}

// ── 解析参数 ─────────────────────────────

/**
 * 解析命令行参数，返回套餐类型
 *
 * @param {string[]} argv
 * @returns {{ type: "coding" | "agent" }}
 */
function parseArgs(argv) {
    const type = (argv[2] || "coding").toLowerCase();
    if (type !== "coding" && type !== "agent") {
        console.error(`用法: node ${argv[1]} <coding(默认)|agent>`);
        process.exit(0);
    }
    return { type };
}

// ── 入口 ─────────────────────────────────

async function main() {
    const { type } = parseArgs(process.argv);

    const creds = loadCredentials();
    if (!creds) {
        console.error("火山方舟 | ❌ 未配置凭据");
        process.exit(0);
    }

    const planLabel = type === "coding" ? "火山CodingPlan" : "火山AgentPlan";

    /** @type {TierItem[]} */
    let tiers;

    try {
        if (type === "coding") {
            const data = await callOpenApi(
                "GetCodingPlanUsage",
                creds.accessKeyId,
                creds.secretAccessKey,
            );
            tiers = parseCodingPlanResponse(data);
        } else {
            const data = await callOpenApi(
                "GetAFPUsage",
                creds.accessKeyId,
                creds.secretAccessKey,
            );
            const parsed = parseAfpResponse(data);
            tiers = parsed.tiers;
        }
    } catch (err) {
        console.error(`火山方舟 | ❌ ${err.message}`);
        return;
    }

    console.log(renderOutput(tiers, planLabel));
}

main().catch((err) => {
    console.error(`火山方舟 | ❌ ${err.message}`);
    process.exit(0);
});
