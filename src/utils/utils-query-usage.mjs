/**
 * @file 用量查询工具函数
 *
 * 包含枚举常量、参数校验、结果缓存、终端宽度适配、
 * 倒计时格式、百分比着色、窗口渲染、配置文件、标签解析、账号匹配、
 * 参数解析等公共工具
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { parseArgs as nodeParseArgs } from "util";
import { getAPIKey } from "./utils-cc-switch.mjs";

// #region 枚举常量 ----------------

/**
 * 递归冻结对象及其嵌套属性
 * @param {object} obj
 * @returns {object}
 */
function deepFreeze(obj) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) {
        if (v && typeof v === "object") deepFreeze(v);
    }
    return obj;
}

/**
 * 展示档位
 * @enum {string}
 */
export const DISPLAY = Object.freeze({
    AUTO: "auto",
    LONG: "long",
    SHORT: "short",
});

/**
 * 套餐类型
 * @enum {string}
 */
export const TYPE = Object.freeze({
    CODING: "coding",
    AGENT: "agent",
});

/**
 * 应用配置键名
 * @enum {string}
 */
export const KEYS = Object.freeze({
    ARK: "ark",
    OLLAMA: "ollama",
    OPENCODE: "opencode",
    QWEN: "qwen",
});

/**
 * 命令行参数名
 * @enum {string}
 */
export const ARGS = Object.freeze({
    TYPE: "--type",
    TYPE_SHORT: "-t",
    DISPLAY: "--display",
    DISPLAY_SHORT: "-d",
    POSITION: "--position",
    POSITION_SHORT: "-p",
    HIDE_ON_MONTHLY_EXHAUSTED: "--hide-on-monthly-exhausted",
    HIDE_ON_NO_ACTIVE_PLAN: "--hide-on-no-active-plan",
});

/**
 * ANSI 颜色转义序列
 * @enum {string}
 */
export const COLORS = Object.freeze({
    /** 重置颜色 */
    RESET: "\x1b[0m",

    /** 灰 #808080 */
    GRAY: "\x1b[38;2;128;128;128m",
    /** 浅灰 #B0B0B0（白与灰的平均），倒计时 */
    LIGHT_GRAY: "\x1b[38;2;176;176;176m",
    /** 白 #E0E0E0 */
    WHITE: "\x1b[38;2;224;224;224m",
    /** 绿 #3FB950 */
    GREEN: "\x1b[38;2;63;185;80m",
    /** Claude 橙色 #D97757 */
    ORANGE: "\x1b[38;2;217;119;87m",
    /** 黄 #E3B341 */
    YELLOW: "\x1b[38;2;227;179;65m",
    /** 红 #EF4444 */
    RED: "\x1b[38;2;239;68;68m",
    /** 薰衣草蓝紫 #B1B9F9，行前缀 */
    PREFIX: "\x1b[38;2;177;185;249m",
});

/**
 * config.json 的绝对路径
 * @type {string}
 */
export const CONFIG_PATH = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "config",
    "config.json",
);

/**
 * 各应用默认长/短标签
 *
 * 账号 longLabel/shortLabel 未配置时使用此项
 * @type {{
 *     ark: {
 *         coding: { long: string, short: string },
 *         agent: { long: string, short: string }
 *     },
 *     opencode: { long: string, short: string },
 *     qwen: { long: string, short: string }
 * }}
 */
export const DEFAULT_LABELS = deepFreeze({
    ark: {
        coding: {
            long: "火山Coding",
            short: "Coding",
        },
        agent: {
            long: "火山Agent",
            short: "Agent",
        },
    },
    ollama: {
        long: "Ollama",
        short: "Ollama",
    },
    opencode: {
        long: "OpenCodeGo",
        short: "Go",
    },
    qwen: {
        long: "千问",
        short: "千问",
    },
});

/**
 * 用量窗口标识
 * @enum {string}
 */
export const WINDOW = Object.freeze({
    ROLLING: "rolling",
    WEEKLY: "weekly",
    MONTHLY: "monthly",
});

/**
 * 各窗口的长/短标签
 * @type {Object<string, { long: string, short: string }>}
 */
export const WINDOW_LABELS = deepFreeze({
    [WINDOW.ROLLING]: { long: "五小时", short: "五" },
    [WINDOW.WEEKLY]: { long: "每周", short: "周" },
    [WINDOW.MONTHLY]: { long: "每月", short: "月" },
});

/**
 * 无活跃套餐标记
 *
 * 各查询脚本判定账号无订阅/订阅过期时，在抛出的错误消息中包含此字符串；
 * all 脚本开启 --hide-on-no-active-plan 时，据此过滤掉对应输出行。
 * 过滤匹配错误消息部分（ERROR_MARK + NO_ACTIVE_PLAN），不扫整行，避免自定义标签含此字样被误杀
 */
export const NO_ACTIVE_PLAN = "无活跃套餐";

/**
 * 错误行标记
 *
 * renderErrorLine 在错误消息前固定输出此前缀；all 脚本过滤无活跃套餐行时
 * 据此定位错误消息，与渲染逻辑共用同一常量保持同步
 */
export const ERROR_MARK = "❌ ";

// #endregion 枚举常量 --------------------------------

// #region 参数解析 ----------------

/**
 * 命令行参数解析
 *
 * 返回 { display, type, position, hideOnMonthlyExhausted, hideOnNoActivePlan }
 * --type 未传时返回 undefined，由调用方回退到账号 type / 默认 coding
 * 参数非法时抛出 Error，由调用方的 catch 处理
 *
 * @param {string[]} argv process.argv
 * @returns {{
 *     display: "auto" | "long" | "short",
 *     type: "coding" | "agent" | undefined,
 *     position: number,
 *     hideOnMonthlyExhausted: boolean,
 *     hideOnNoActivePlan: boolean,
 * }}
 */
export function parseArgs(argv) {
    const displayVals = Object.values(DISPLAY).join("|");
    const typeVals = Object.values(TYPE).join("|");
    const usage =
        `参数用法: [${ARGS.POSITION} <n>]` +
        ` [${ARGS.TYPE} <${typeVals}>] [${ARGS.DISPLAY} <${displayVals}>]`;
    let parsed;
    try {
        parsed = nodeParseArgs({
            args: argv.slice(2),
            options: {
                [ARGS.DISPLAY.slice(2)]: {
                    type: "string",
                    short: ARGS.DISPLAY_SHORT.slice(1),
                    default: DISPLAY.AUTO,
                },
                [ARGS.TYPE.slice(2)]: {
                    type: "string",
                    short: ARGS.TYPE_SHORT.slice(1),
                },
                [ARGS.POSITION.slice(2)]: {
                    type: "string",
                    short: ARGS.POSITION_SHORT.slice(1),
                    default: "0",
                },
                [ARGS.HIDE_ON_MONTHLY_EXHAUSTED.slice(2)]: {
                    type: "string",
                    default: "false",
                },
                [ARGS.HIDE_ON_NO_ACTIVE_PLAN.slice(2)]: {
                    type: "string",
                    default: "false",
                },
            },
        });
    } catch (err) {
        throw new Error(`参数解析失败: ${err.message}\n${usage}`);
    }

    let display, type;
    try {
        if (parsed.values[ARGS.TYPE.slice(2)] != null) {
            type = normalizeType(parsed.values[ARGS.TYPE.slice(2)]);
        }
        display = normalizeDisplay(parsed.values.display);
    } catch (err) {
        throw new Error(`${err.message}\n${usage}`);
    }

    let position;
    const posRaw = parsed.values[ARGS.POSITION.slice(2)];
    if (posRaw != null) {
        position = parseInt(posRaw, 10);
        if (isNaN(position) || position < 0 || String(position) !== posRaw) {
            throw new Error(`${ARGS.POSITION} 取值非法: ${posRaw}`);
        }
    }
    const hide = parsed.values[ARGS.HIDE_ON_MONTHLY_EXHAUSTED.slice(2)];
    const hideOnMonthlyExhausted = hide.toLowerCase() === "true";
    const hideNoActive = parsed.values[ARGS.HIDE_ON_NO_ACTIVE_PLAN.slice(2)];
    const hideOnNoActivePlan = hideNoActive.toLowerCase() === "true";

    return {
        display,
        type,
        position,
        hideOnMonthlyExhausted,
        hideOnNoActivePlan,
    };
}

/**
 * 转义正则特殊字符，用于把任意字符串作为字面量拼进 RegExp
 *
 * @param {string} s 原始字符串
 * @returns {string} 转义后的字符串
 */
export function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 规范化 --display 取值，支持 l→long, s→short 缩写
 *
 * auto 为自动档，透传不解析，由 renderWindows 按终端宽度选择
 *
 * @param {string} val 原始值
 * @param {object} [opts]
 * @param {"long"|"short"|"auto"} [opts.fallback] 非法值时静默回退到此值
 * @returns {"long"|"short"|"auto"}
 * @throws {Error} 非法值且未提供 fallback 时
 */
export function normalizeDisplay(val, { fallback } = {}) {
    const s = String(val).toLowerCase();
    const map = { l: DISPLAY.LONG, s: DISPLAY.SHORT, a: DISPLAY.AUTO };
    const result = map[s] || s;
    if (![DISPLAY.LONG, DISPLAY.SHORT, DISPLAY.AUTO].includes(result)) {
        if (fallback !== undefined) {
            return fallback;
        }
        throw new Error(`${ARGS.DISPLAY} 取值非法: ${val}`);
    }
    return result;
}

/**
 * 规范化 --type 取值，支持 c→coding, a→agent 缩写
 *
 * @param {string} val 原始值
 * @param {object} [opts]
 * @param {"coding"|"agent"} [opts.fallback] 非法值时静默回退到此值
 * @returns {"coding"|"agent"}
 * @throws {Error} 非法值且未提供 fallback 时
 */
export function normalizeType(val, { fallback } = {}) {
    const s = String(val).toLowerCase();
    const map = { c: TYPE.CODING, a: TYPE.AGENT };
    const result = map[s] || s;
    if (result !== TYPE.CODING && result !== TYPE.AGENT) {
        if (fallback !== undefined) {
            return fallback;
        }
        throw new Error(`${ARGS.TYPE} 取值非法: ${val}`);
    }
    return result;
}

// #endregion 参数解析 --------------------------------

// #region 结果缓存 ----------------

/**
 * 缓存文件绝对路径（项目根目录下 tmp/，单文件存全部缓存键）
 *
 * 测试可通过 CC_USAGE_CACHE_PATH 环境变量重定向到临时文件，
 * 避免清空正在运行的工具的真实生产缓存
 *
 * @returns {string}
 */
function getCachePath() {
    return (
        process.env.CC_USAGE_CACHE_PATH ||
        join(
            dirname(fileURLToPath(import.meta.url)),
            "..",
            "..",
            "tmp",
            "cache-usage.json",
        )
    );
}

/**
 * 正缓存有效期（毫秒）
 *
 * 成功用量的复用窗口：高频调用时减少上游 API 请求，且远快于用量数据的实际变化速度
 */
export const CACHE_TTL_MS = 5000;

/**
 * 负缓存有效期（毫秒）
 *
 * 错误结果的复用窗口：须 > REQUEST_TIMEOUT_MS，否则故障期会在负缓存过期后
 * 再次等满超时；设 30s 使故障期每 30s 才重试一次上游，既不轰炸也尽快自愈
 */
export const NEG_CACHE_TTL_MS = 30000;

/**
 * 单次请求超时（毫秒）
 *
 * 四个查询脚本共用；仅在卡住时触发，正常请求快则快，设大无日常代价
 */
export const REQUEST_TIMEOUT_MS = 10000;

/**
 * 读取缓存条目
 *
 * 缓存文件不存在、JSON 损坏、键不存在或已过期均返回 null（视为无缓存，自愈）
 * usage 数据的 sec 倒计时会减去已流逝秒数，保证显示无偏差
 *
 * @param {string} key 缓存键（如 "ark:0:coding"）
 * @returns {{ output: string } | { usage: object } | null}
 *          output 为缓存的错误字符串；usage 为窗口用量数据（键按各平台实际窗口）
 */
export function readCache(key) {
    let entry;
    try {
        entry = JSON.parse(readFileSync(getCachePath(), "utf-8"))[key];
    } catch {
        return null;
    }
    if (!entry || typeof entry.ts !== "number") {
        return null;
    }
    const elapsedMs = Date.now() - entry.ts;
    // 负缓存（错误）用更长的 TTL，避免故障期反复等满超时轰炸上游
    const ttl =
        typeof entry.output === "string" ? NEG_CACHE_TTL_MS : CACHE_TTL_MS;
    if (elapsedMs < 0 || elapsedMs >= ttl) {
        return null;
    }

    // 错误负缓存：TTL 内直接复用错误输出，避免故障时高频重试轰炸上游
    if (typeof entry.output === "string") {
        return { output: entry.output };
    }
    if (!entry.usage || typeof entry.usage !== "object") {
        return null;
    }

    // 倒计时扣除已流逝秒数；保留原始键结构，避免为不存在的窗口（如千问无 monthly）凭空造出 null
    const elapsedSec = elapsedMs / 1000;
    const shift = (w) =>
        w == null
            ? null
            : {
                  pct: w.pct,
                  // null（无重置）保持 null；负数（重置已过）不钳 0，均由渲染层统一显示 ↻ --
                  sec: w.sec == null ? null : w.sec - elapsedSec,
              };
    const shifted = {};
    for (const usageKey of Object.keys(entry.usage)) {
        shifted[usageKey] = shift(entry.usage[usageKey]);
    }
    return { usage: shifted };
}

/**
 * 写入缓存条目
 *
 * 读-改-写整个缓存文件；写入失败静默忽略（缓存只是优化，不影响主流程）
 *
 * @param {string} key 缓存键
 * @param {{ output?: string, usage?: object }} data
 *        output 为错误字符串（负缓存）；usage 为窗口用量数据
 */
export function writeCache(key, data) {
    const cachePath = getCachePath();
    let all = {};
    try {
        all = JSON.parse(readFileSync(cachePath, "utf-8"));
        // 数组也 typeof === "object"，会漏过下一条 null/非对象校验：给数组设命名属性后
        // JSON.stringify 丢弃，条目静默不落地，故一并重置为 {}
        if (typeof all !== "object" || all === null || Array.isArray(all)) {
            all = {};
        }
    } catch {
        /* 文件不存在或损坏，重建 */
    }
    all[key] = { ts: Date.now(), ...data };
    try {
        mkdirSync(dirname(cachePath), { recursive: true });
        writeFileSync(cachePath, JSON.stringify(all));
    } catch {
        /* 写入失败忽略 */
    }
}

/**
 * 读缓存或执行实际查询，成功结果自动写缓存
 *
 * 命中负缓存时返回 { output }（缓存的错误行），调用方直接输出；
 * 命中 usage 或实际查询成功时返回 { usage }；
 * fetchFn 抛出的异常原样透传，由调用方渲染错误行（并按需写负缓存）
 *
 * @param {string} key 缓存键
 * @param {boolean} enabled 是否启用缓存
 * @param {() => Promise<object>} fetchFn 实际查询函数，返回窗口用量数据
 * @returns {Promise<{ output: string } | { usage: object }>}
 */
export async function fetchUsageCached(key, enabled, fetchFn) {
    if (enabled) {
        const hit = readCache(key);
        if (hit) {
            return hit;
        }
    }
    const usage = await fetchFn();
    if (enabled) {
        writeCache(key, { usage });
    }
    return { usage };
}

// #endregion 结果缓存 --------------------------------

// #region CLI 入口判断 ----------------

/**
 * 判断模块是否被 node 直接运行（而非被 import）
 *
 * 用于「导出函数 + CLI 壳」双入口模式：直接运行时执行 CLI 逻辑
 *
 * @param {string} moduleUrl 调用方的 import.meta.url
 * @returns {boolean}
 */
export function isMainModule(moduleUrl) {
    if (!process.argv[1]) {
        return false;
    }
    try {
        return moduleUrl === pathToFileURL(process.argv[1]).href;
    } catch {
        return false;
    }
}

// #endregion CLI 入口判断 --------------------------------

// #region 渲染 ----------------

/**
 * 用量百分比 → 展示用整数（带端点保护）
 *
 * 100% 与 0% 在用户认知里是「用尽」「未使用」两个状态而非普通数值，
 * 直接四舍五入会让 99.7% 显示成 100%（误以为额度耗尽）、0.3% 显示成 0%
 * （误以为尚未开始用）。故对两端各留一档：
 *   - 真正 >= 100 才返回 100，(99, 100) 一律压到 99
 *   - 真正 <= 0 才返回 0，(0, 1) 一律抬到 1
 *   - 中间区间照常四舍五入，不放大偏差
 *
 * 各平台上游精度不一（ark/qwen 给原始小数，ollama 给页面已舍入的值），
 * 不追求逐位复刻官方页面，只保证不误导。幂等，可重复调用
 *
 * @param {number} pct 原始百分比，可能是小数，也可能越界
 * @returns {number} 0-100 的整数
 */
export function formatPct(pct) {
    // 只挡 NaN / 非数字（脏数据视为 0）；±Infinity 交给下面的越界钳制处理
    if (typeof pct !== "number" || Number.isNaN(pct)) {
        return 0;
    }
    if (pct >= 100) {
        return 100;
    }
    if (pct <= 0) {
        return 0;
    }
    const rounded = Math.round(pct);
    if (rounded >= 100) {
        return 99;
    }
    if (rounded <= 0) {
        return 1;
    }
    return rounded;
}

/**
 * 根据用量百分比返回 ANSI 颜色转义序列
 *
 * @param {number} pct 百分比 0-100
 * @returns {string} ANSI 颜色转义序列，0-59% 绿，60-79% 黄，80-99% Claude 橙(#D97757)，100% 红
 */
export function pctColorCode(pct) {
    // 按展示值分档，保证「显示 99%」与「橙色」一致，不会出现显示 99% 却标红
    const shown = formatPct(pct);
    if (shown >= 100) {
        return COLORS.RED;
    }
    if (shown >= 80) {
        return COLORS.ORANGE;
    }
    if (shown >= 60) {
        return COLORS.YELLOW;
    }
    return COLORS.GREEN;
}

/**
 * 渲染用量百分比段（带按用量分档的 ANSI 颜色）
 *
 * @param {number} pct 百分比 0-100
 * @returns {string} 形如 "<color>42%<reset>" 的着色百分比
 */
export function pctSegment(pct) {
    const color = pctColorCode(pct);
    return `${color}${formatPct(pct)}%${COLORS.RESET}`;
}

/**
 * 秒数 → 人类可读倒计时
 *
 * @param {number} sec      距重置的剩余秒数
 * @param {"long" | "short"} [display=DISPLAY.LONG] 展示档位
 * @returns {string} long: "3天6小时"/"4小时47分钟"/"12分钟"
 *                   short: "3d6h"/"4h47m"/"12m"
 */
export function toCountdown(sec, display = DISPLAY.LONG) {
    // 脏数据防御：非有限数字（NaN / undefined / Infinity）一律归零，避免渲染出 NaN分钟
    if (typeof sec !== "number" || !Number.isFinite(sec)) {
        sec = 0;
    }
    if (sec < 0) sec = 0;
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (display === DISPLAY.SHORT) {
        if (d > 0) {
            return h > 0 ? `${d}d${h}h` : `${d}d`;
        }
        if (h > 0) {
            return m > 0 ? `${h}h${m}m` : `${h}h`;
        }
        return `${m}m`;
    }
    if (d > 0) {
        return h > 0 ? `${d}天${h}小时` : `${d}天`;
    }
    if (h > 0) {
        return m > 0 ? `${h}小时${m}分钟` : `${h}小时`;
    }
    return `${m}分钟`;
}

/**
 * 获取终端宽度（列数）
 *
 * 优先级：stdout → stderr → 环境变量 COLUMNS → 0（未知）
 * @returns {number}
 */
function getTermWidth() {
    return (
        process.stdout.columns ||
        process.stderr.columns ||
        (process.env.COLUMNS ? parseInt(process.env.COLUMNS, 10) : 0)
    );
}

/**
 * 字符串的终端可见列宽（CJK 字符按 2 列计）
 *
 * @param {string} s 已去掉 ANSI 转义的纯文本
 * @returns {number}
 */
function getVisibleWidth(s) {
    let w = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (
            (c >= 0x1100 && c <= 0x11ff) || // 韩文字母
            (c >= 0x3000 && c <= 0x30ff) || // CJK 符号与标点 / 平假名 / 片假名
            (c >= 0x3130 && c <= 0x318f) || // 韩文兼容字母
            (c >= 0x3400 && c <= 0x4dbf) || // CJK 统一汉字扩展 A
            (c >= 0x4e00 && c <= 0x9fff) || // CJK 统一汉字
            (c >= 0xac00 && c <= 0xd7af) || // 韩文音节
            (c >= 0xff00 && c <= 0xffef) // 全角形式
        ) {
            w += 2;
        } else {
            w += 1;
        }
    }
    return w;
}

/**
 * 渲染用量窗口的完整行（不含前缀），或带前缀的完整行
 *
 * AUTO 档位：渲染长版并测量实际可见长度，放得下用长版否则用短版
 *
 * 按 WINDOW 定义顺序遍历 usage 中存在的窗口：不含某键则不输出（平台无此窗口）；
 * 键存在但值为 null 时显示 "标签:--"（数据缺失）；非 null 时渲染百分比段和倒计时
 * 窗口标签用白色（#E0E0E0），百分比按 pct 分档着色（绿/黄/橙/红）；null 窗口标签同样用白；
 * 倒计时用浅灰（#B0B0B0），与标签区分又不至于抢过数据焦点；分隔符 | 用灰（#808080）降噪，凸显数据
 * 百分比经 formatPct 归一到 0–100 整数（两端做端点保护，见 formatPct），秒数限制为 ≥0
 *
 * @param {Object<string, ({ pct: number, sec: number } | null)>} usage 用量窗口数据，键为 WINDOW 常量值
 * @param {"auto" | "long" | "short"} display 展示档位
 * @param {{ long: string, short: string }} [prefixes] 可选，提供时返回 "前缀 | 窗口文本"
 * @param {boolean} [hideOnMonthlyExhausted=false]
 * @param {boolean} [_plain=false] 内部：返回无 ANSI 颜色码的纯文本，仅供 AUTO 档估算宽度
 * @returns {string}
 */
export function renderWindows(
    usage,
    display,
    prefixes,
    hideOnMonthlyExhausted = false,
    _plain = false,
) {
    // 月用量用尽时整体隐藏（monthly 不存在或为 null 时无月度数据，不隐藏）
    // 用 formatPct 判定，避免 99.6% 被四舍五入成 100% 而整行凭空消失
    if (
        hideOnMonthlyExhausted &&
        usage.monthly != null &&
        formatPct(usage.monthly.pct) >= 100
    ) {
        return "";
    }

    if (display === DISPLAY.AUTO) {
        const width = getTermWidth();
        if (width) {
            // 用纯文本估算长版宽度，避免先渲染完整 ANSI 再丢弃
            const longPlain = renderWindows(
                usage,
                DISPLAY.LONG,
                prefixes,
                hideOnMonthlyExhausted,
                true,
            );
            // 给前后留出 5 字符的间距
            const measured = getVisibleWidth(longPlain) + 5;
            if (measured <= width) {
                return renderWindows(
                    usage,
                    DISPLAY.LONG,
                    prefixes,
                    hideOnMonthlyExhausted,
                );
            }
        }
        return renderWindows(
            usage,
            DISPLAY.SHORT,
            prefixes,
            hideOnMonthlyExhausted,
        );
    }

    const mode = display === DISPLAY.SHORT ? "short" : "long";
    // _plain 模式省略 ANSI 颜色码，用于 AUTO 档宽度估算
    const W = _plain ? "" : COLORS.WHITE;
    const R = _plain ? "" : COLORS.RESET;
    const G = _plain ? "" : COLORS.GRAY;
    const LG = _plain ? "" : COLORS.LIGHT_GRAY;
    const P = _plain ? "" : COLORS.PREFIX;
    const segs = Object.values(WINDOW)
        .filter((key) => key in usage)
        .map((key) => {
            const item = usage[key];
            // 整窗口缺失（item 为 null）→ 无百分比也无倒计时，显示 标签:--
            if (item == null) {
                return `${W}${WINDOW_LABELS[key][mode]}:${R}--`;
            }
            const pct = formatPct(item.pct);
            const label = `${W}${WINDOW_LABELS[key][mode]}:${R}`;
            const pctSeg = _plain ? `${pct}%` : pctSegment(pct);
            // 秒数归一：null/undefined → null，数字字符串（如 "3600"）→ 3600
            const sec = item.sec == null ? null : Number(item.sec);
            // 无有效倒计时（null / NaN / Infinity / 负数 / 非数字）→ 倒计时位显示 --
            // 负数表示「重置时间已过或不可用」，不再被钳成 0 分钟误导
            if (!Number.isFinite(sec) || sec < 0) {
                return `${label}${pctSeg} ${G}↻ ${LG}--${R}`;
            }
            return `${label}${pctSeg} ${G}↻ ${LG}${toCountdown(Math.round(sec), display)}${R}`;
        });
    const sep = `${G} | ${R}`;
    const windowsText = segs.join(sep);

    if (prefixes) {
        const prefix =
            display === DISPLAY.SHORT ? prefixes.short : prefixes.long;
        return `${P}${prefix}${R}${sep}${windowsText}`;
    }
    return windowsText;
}

/**
 * 把常见异常转为用户友好的中文提示
 *
 * 只转换能识别的场景（请求超时），其余原样透传，避免掩盖真实错误
 *
 * @param {unknown} err 异常
 * @returns {string} 友好错误消息
 */
export function friendlyError(err) {
    // 只认客户端 AbortSignal.timeout 触发的超时（DOMException name=TimeoutError），
    // 不靠消息文本匹配，避免把上游错误消息中含 "timeout" 字样的业务错误误判为请求超时
    if (err?.name === "TimeoutError") {
        return `请求超时（超过 ${REQUEST_TIMEOUT_MS / 1000}s），请稍后重试`;
    }
    return err?.message || String(err);
}

/**
 * 渲染错误行："前缀 | ❌ 消息"（前缀薰衣草蓝）
 *
 * @param {{ long: string, short: string }} labels 长/短标签
 * @param {"auto" | "long" | "short"} display 展示档位（auto 按 long 处理）
 * @param {string} message 错误消息
 * @returns {string}
 */
export function renderErrorLine(labels, display, message) {
    const mode = display === DISPLAY.SHORT ? DISPLAY.SHORT : DISPLAY.LONG;
    return `${COLORS.PREFIX}${labels[mode]}${COLORS.RESET} | ${ERROR_MARK}${message}`;
}

// #endregion 渲染 --------------------------------

// #region 配置文件 ----------------

/**
 * 读取项目根 config/config.json
 *
 * 文件不存在、权限不足或 JSON 语法错误时抛出 Error
 * 同时轻量校验顶层字段类型，误配时给出明确提示
 * @returns {object}
 */
export function loadConfig() {
    let cfg;
    try {
        cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    } catch (err) {
        if (err.code === "ENOENT") {
            throw new Error(
                "config.json 不存在，请将 config.example.json 复制为 config.json",
            );
        }
        throw new Error(`读取 config.json 失败: ${err.message}`);
    }

    // 轻量类型校验：ark/opencode 若存在则须为数组
    for (const key of Object.values(KEYS)) {
        if (key in cfg && !Array.isArray(cfg[key])) {
            throw new Error(
                `config.json 格式错误: "${key}" 应为数组，实际为 ${typeof cfg[key]}`,
            );
        }
    }

    return cfg;
}

// #endregion 配置文件 --------------------------------

// #region 默认标签 ----------------

/**
 * 解析长/短标签前缀
 *
 * 优先级：账号 longLabel/shortLabel > 默认标签
 *
 * @param {object} [account]   账号对象，取 longLabel/shortLabel
 * @param {{ long: string, short: string }} defaultLabels 默认标签
 * @returns {{ long: string, short: string }}
 */
export function resolvePrefixes(account, defaultLabels) {
    return {
        long: account?.longLabel || defaultLabels.long,
        short: account?.shortLabel || defaultLabels.short,
    };
}

// #endregion 默认标签 --------------------------------

// #region 账号匹配 ----------------

/**
 * 在 accounts 数组中按 index 取账号，无参时取 accounts[0]
 *
 * @param {Array} accounts 账号数组（如 cfg.ark 或 cfg.opencode）
 * @param {number} [position=0] 位置索引（0 开始），默认为 0
 * @returns {object} 账号对象
 */
export function findAccount(accounts, position = 0) {
    if (!Array.isArray(accounts) || accounts.length === 0) {
        throw new Error("无可用账号");
    }

    if (position >= 0 && position < accounts.length) {
        return accounts[position];
    }
    throw new Error(
        `position ${position} 越界（共 ${accounts.length} 个账号）`,
    );
}

/**
 * 在 config 各账号数组中按 apiKey 查找账号
 *
 * 按 KEYS 顺序遍历（与 QUERY_FNS 的 key 顺序一致），命中第一个含该 apiKey 的账号即返回；
 * apiKey 为空或所有账号均不匹配时返回 null。纯函数，便于单测
 *
 * @param {object} cfg loadConfig() 的结果
 * @param {string} apiKey 待匹配的 API Key
 * @returns {{ key: string, index: number, account: object } | null}
 */
export function matchAccountByApiKey(cfg, apiKey) {
    if (!apiKey) {
        return null;
    }
    for (const key of Object.values(KEYS)) {
        const accounts = cfg[key];
        if (!Array.isArray(accounts)) {
            continue;
        }
        const index = accounts.findIndex(
            (a) => a && a.apiKey && a.apiKey === apiKey,
        );
        if (index >= 0) {
            return { key, index, account: accounts[index] };
        }
    }
    return null;
}

/**
 * 解析当前供应商对应的套餐账号
 *
 * 拿 CC-Switch 当前供应商的 API Key，在 config 中匹配账号
 * 未传入 config 时内部 loadConfig()；apiKey 有效但匹配不到账号返回 null；
 * config 读取或 getAPIKey 异常（CC-Switch 配置损坏 / db 不可读 / 供应商未配 key 等
 * 真实配置故障）直接抛出，由调用方诊断——这些不是「匹配不到」，不应静默降级
 *
 * @param {object} [cfg] loadConfig() 的结果；缺省时自动 loadConfig
 * @returns {Promise<{ key: string, index: number, account: object } | null>}
 * @throws {Error} config 读取或 getAPIKey 失败时抛出
 */
export async function matchProviderAccount(cfg) {
    const accountConfig = cfg || loadConfig();
    const apiKey = await getAPIKey();
    return matchAccountByApiKey(accountConfig, apiKey);
}

// #endregion 账号匹配 --------------------------------
