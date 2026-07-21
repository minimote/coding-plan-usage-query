/**
 * @file 用量查询工具函数
 *
 * 包含枚举常量、参数校验、结果缓存、进度条渲染、终端宽度适配、
 * 倒计时格式、百分比着色、窗口渲染、配置文件、标签解析、账号匹配、
 * 参数解析等公共工具
 */

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { parseArgs as nodeParseArgs } from "util";

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
    OPENCODE: "opencode",
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
});

/**
 * ANSI 颜色转义序列
 * @enum {string}
 */
export const COLORS = Object.freeze({
    RESET: "\x1b[0m",
    GREEN: "\x1b[32m",
    YELLOW: "\x1b[33m",
    RED: "\x1b[31m",
    /** Claude 橙 #DE7356，80-99% 档 */
    ORANGE: "\x1b[38;2;222;115;86m",
    /** 亮白，窗口标签 */
    LABEL: "\x1b[97m",
    /** 薰衣草蓝，行前缀 */
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
 *     opencode: { long: string, short: string }
 * }}
 */
export const DEFAULT_LABELS = deepFreeze({
    ark: {
        coding: {
            long: "火山CodingPlan",
            short: "Coding",
        },
        agent: {
            long: "火山AgentPlan",
            short: "Agent",
        },
    },
    opencode: {
        long: "OpenCodeGo",
        short: "Go",
    },
});

// #endregion 枚举常量 --------------------------------

// #region 参数解析 ----------------

/**
 * 命令行参数解析
 *
 * 返回 { display, type, position, hideOnMonthlyExhausted }
 * --type 未传时返回 undefined，由调用方回退到账号 type / 默认 coding
 * 参数非法时抛出 Error，由调用方的 catch 处理
 *
 * @param {string[]} argv process.argv
 * @returns {{
 *     display: "auto" | "long" | "short",
 *     type: "coding" | "agent" | undefined,
 *     position: number,
 *     hideOnMonthlyExhausted: boolean,
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
    const hideOnMonthlyExhausted = hide === "true";

    return { display, type, position, hideOnMonthlyExhausted };
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
    const map = { l: DISPLAY.LONG, s: DISPLAY.SHORT, a: DISPLAY.AUTO };
    const result = map[val.toLowerCase()] || val.toLowerCase();
    const valid = new Set([DISPLAY.LONG, DISPLAY.SHORT, DISPLAY.AUTO]);
    if (!valid.has(result)) {
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
    const map = { c: TYPE.CODING, a: TYPE.AGENT };
    const result = map[val.toLowerCase()] || val.toLowerCase();
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
 * 缓存目录与文件绝对路径（项目根目录下 tmp/，单文件存全部缓存键）
 */
const CACHE_DIR = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "tmp",
);
const CACHE_PATH = join(CACHE_DIR, "usage-cache.json");

/**
 * 缓存有效期（毫秒）
 *
 * 高频调用时减少上游 API 请求，且远快于用量数据的实际变化速度
 */
export const CACHE_TTL_MS = 5000;

/**
 * 读取缓存条目
 *
 * 缓存文件不存在、JSON 损坏、键不存在或已过期均返回 null（视为无缓存，自愈）
 * usage 数据的 sec 倒计时会减去已流逝秒数，保证显示无偏差
 *
 * @param {string} key 缓存键（如 "ark:0:coding"）
 * @returns {{ output: string } | { usage: object } | null}
 *          output 为缓存的错误字符串；usage 为三窗口用量数据
 */
export function readCache(key) {
    let entry;
    try {
        entry = JSON.parse(readFileSync(CACHE_PATH, "utf-8"))[key];
    } catch {
        return null;
    }
    if (!entry || typeof entry.ts !== "number") {
        return null;
    }
    const elapsedMs = Date.now() - entry.ts;
    if (elapsedMs < 0 || elapsedMs >= CACHE_TTL_MS) {
        return null;
    }

    // 错误负缓存：TTL 内直接复用错误输出，避免故障时高频重试轰炸上游
    if (typeof entry.output === "string") {
        return { output: entry.output };
    }
    if (!entry.usage || typeof entry.usage !== "object") {
        return null;
    }

    // 倒计时扣除已流逝秒数
    const elapsedSec = elapsedMs / 1000;
    const shift = (w) =>
        w == null ? null : { pct: w.pct, sec: Math.max(0, w.sec - elapsedSec) };
    return {
        usage: {
            rolling: shift(entry.usage.rolling),
            weekly: shift(entry.usage.weekly),
            monthly: shift(entry.usage.monthly),
        },
    };
}

/**
 * 写入缓存条目
 *
 * 读-改-写整个缓存文件；写入失败静默忽略（缓存只是优化，不影响主流程）
 *
 * @param {string} key 缓存键
 * @param {{ output?: string, usage?: object }} data
 *        output 为错误字符串（负缓存）；usage 为三窗口用量数据
 */
export function writeCache(key, data) {
    let all = {};
    try {
        all = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
        if (typeof all !== "object" || all === null) {
            all = {};
        }
    } catch {
        /* 文件不存在或损坏，重建 */
    }
    all[key] = { ts: Date.now(), ...data };
    try {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(CACHE_PATH, JSON.stringify(all));
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
 * @param {() => Promise<object>} fetchFn 实际查询函数，返回三窗口 usage
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
 * 渲染 10 格进度条
 *
 * @param {number} pct 百分比 0-100
 * @returns {string} 形如 "█████░░░░░" 的 10 格字符串
 */
export function bar(pct) {
    const n = Math.round(pct / 10);
    return "█".repeat(Math.min(n, 10)).padEnd(10, "░");
}

/**
 * 根据用量百分比返回 ANSI 颜色转义序列
 *
 * @param {number} pct 百分比 0-100
 * @returns {string} ANSI 颜色转义序列，0-59% 绿，60-79% 黄，80-99% Claude 橙(#DE7356)，100% 红
 */
export function pctColorCode(pct) {
    if (pct >= 100) {
        return COLORS.RED;
    }
    if (pct >= 80) {
        return COLORS.ORANGE;
    }
    if (pct >= 60) {
        return COLORS.YELLOW;
    }
    return COLORS.GREEN;
}

/**
 * 渲染用量百分比段（带按用量分档的 ANSI 颜色）
 *
 * @param {number} pct       百分比 0-100
 * @param {"long" | "short"} display 展示档位
 * @returns {string} long=进度条+百分比，short=仅百分比
 */
export function pctSegment(pct, display) {
    const color = pctColorCode(pct);
    const pctStr = `${color}${Math.round(pct)}%${COLORS.RESET}`;
    if (display === DISPLAY.SHORT) {
        return pctStr;
    }
    return `${bar(pct)} ${pctStr}`;
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
            (c >= 0x4e00 && c <= 0x9fff) || // CJK Unified Ideographs
            (c >= 0x3000 && c <= 0x303f) || // CJK Symbols & Punctuation
            (c >= 0xff00 && c <= 0xffef) // Fullwidth Forms
        ) {
            w += 2;
        } else {
            w += 1;
        }
    }
    return w;
}

/**
 * 渲染三个用量窗口的完整行（不含前缀），或带前缀的完整行
 *
 * AUTO 档位：渲染长版并测量实际可见长度，放得下用长版否则用短版
 *
 * 各窗口数据为 null 时显示 "标签:—"；非 null 时渲染百分比段和倒计时
 * 标签+冒号用亮白（97）高亮，百分比按用量分档着色（绿/黄/橙/红），倒计时保持默认色
 * 百分比限制在 0–100，秒数限制为 ≥0
 *
 * @param {{
 *     rolling: ({ pct: number, sec: number } | null),
 *     weekly: ({ pct: number, sec: number } | null),
 *     monthly: ({ pct: number, sec: number } | null)
 * }} usage 三个用量窗口数据对象
 * @param {"auto" | "long" | "short"} display 展示档位
 * @param {{ long: string, short: string }} [prefixes] 可选，提供时返回 "前缀 | 窗口文本"
 * @returns {string}
 */
export function renderWindows(
    usage,
    display,
    prefixes,
    hideOnMonthlyExhausted = false,
) {
    // 月用量用尽时整体隐藏（monthly 为 null 时无月度数据，不隐藏）
    if (
        hideOnMonthlyExhausted &&
        usage.monthly !== null &&
        Math.round(usage.monthly.pct) >= 100
    ) {
        return "";
    }

    if (display === DISPLAY.AUTO) {
        const width = getTermWidth();
        if (width) {
            const longText = renderWindows(
                {
                    rolling: usage.rolling,
                    weekly: usage.weekly,
                    monthly: usage.monthly,
                },
                DISPLAY.LONG,
                prefixes,
                hideOnMonthlyExhausted,
            );
            const plain = longText.replace(/\x1b\[[\d;]*m/g, "");
            // 给前后留出 5 字符的间距
            const measured = getVisibleWidth(plain) + 5;
            if (measured <= width) {
                return longText;
            }
        }
        return renderWindows(
            usage,
            DISPLAY.SHORT,
            prefixes,
            hideOnMonthlyExhausted,
        );
    }

    const labels =
        display === DISPLAY.SHORT
            ? ["五", "周", "月"]
            : ["五小时", "每周", "每月"];
    const windows = [usage.rolling, usage.weekly, usage.monthly];
    const segs = windows.map((item, i) => {
        // 标签+冒号用亮白高亮
        const label = `${COLORS.LABEL}${labels[i]}:${COLORS.RESET}`;
        if (item === null) {
            return `${label}—`;
        }
        const pct = Math.max(0, Math.min(Math.round(item.pct), 100));
        const sec = Math.max(0, Math.round(item.sec));
        return `${label}${pctSegment(pct, display)} ↻ ${toCountdown(sec, display)}`;
    });
    const windowsText = segs.join(" | ");

    if (prefixes) {
        const prefix =
            display === DISPLAY.SHORT ? prefixes.short : prefixes.long;
        return `${COLORS.PREFIX}${prefix}${COLORS.RESET} | ${windowsText}`;
    }
    return windowsText;
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
    return `${COLORS.PREFIX}${labels[mode]}${COLORS.RESET} | ❌ ${message}`;
}

// #endregion 渲染 --------------------------------

// #region 配置文件 ----------------

/**
 * 读取同目录 config.json
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

// #endregion 账号匹配 --------------------------------
