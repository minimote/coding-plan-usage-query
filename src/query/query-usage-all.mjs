/**
 * @file 查询所有套餐用量（并行执行）
 *
 * 读取 config.json 中所有账号，并行调用各查询函数，按顺序拼接输出
 *
 * 用法:
 *   node query-usage-all.mjs
 *
 * 参数:
 *   --display / -d    显示模式：auto(a,默认) | long(l) | short(s)
 *   --hide-on-monthly-exhausted  月度用量耗尽时隐藏该行（true|false，默认 false）
 *   --hide-on-no-active-plan     无活跃套餐时隐藏该行（true|false，默认 false）
 *
 * 各 ark 账号用自己的 type 配置，不接受 --type 覆盖
 *
 * 也可被 import 后调用 queryAll(options)
 */

import {
    KEYS,
    NO_ACTIVE_PLAN,
    ERROR_MARK,
    loadConfig,
    parseArgs,
    isMainModule,
} from "../utils/utils-query-usage.mjs";
import { queryUsage as queryArk } from "./query-usage-ark.mjs";
import { queryUsage as queryCommandcode } from "./query-usage-commandcode.mjs";
import { queryUsage as queryOllama } from "./query-usage-ollama.mjs";
import { queryUsage as queryOpencode } from "./query-usage-opencode-go.mjs";
import { queryUsage as queryQwen } from "./query-usage-qwen.mjs";

// #region 查询入口 ----------------

/**
 * 套餐 key 到查询函数的映射
 *
 * key 顺序即输出顺序（smart 的匹配顺序与此一致）
 */
export const QUERY_FNS = Object.freeze({
    [KEYS.ARK]: queryArk,
    [KEYS.COMMANDCODE]: queryCommandcode,
    [KEYS.OLLAMA]: queryOllama,
    [KEYS.OPENCODE]: queryOpencode,
    [KEYS.QWEN]: queryQwen,
});

/**
 * 将各账号的查询输出字符串分组拼接：有效行在前，无效行（含 ERROR_MARK）在后，
 * 两组都非空时中间插一个空行；过滤空串与（可选）无活跃套餐行
 *
 * 纯函数，不依赖任何外部 IO，便于单测
 *
 * @param {string[]} outputs 各账号的查询输出（含错误行）
 * @param {{ hideOnNoActivePlan?: boolean }} [opts]
 * @returns {string} 多行输出（无换行结尾）
 */
/**
 * 提取行内数据段（" | " 之后的部分）
 *
 * 输出行格式为 "<label> | <数据段>"（与 renderErrorLine / renderWindows 的
 * 分隔符保持一致）：label 是用户自定义账号名，可能包含任意字符；错误标记
 * （ERROR_MARK）与无活跃套餐标记只出现在数据段。判断某行是否为错误行 /
 * 无活跃套餐行时必须只匹配数据段，避免自定义标签含这些字样被误杀。
 *
 * @param {string} line 单行输出
 * @returns {string} 数据段（行内无 " | " 分隔符时返回整行）
 */
function msgPart(line) {
    const i = line.indexOf(" | ");
    return i === -1 ? line : line.slice(i + 3);
}

export function groupOutputs(outputs, { hideOnNoActivePlan = false } = {}) {
    const valid = [];
    const invalid = [];
    for (const s of outputs) {
        if (s === "") {
            continue;
        }
        const msg = msgPart(s);
        if (hideOnNoActivePlan && msg.includes(ERROR_MARK + NO_ACTIVE_PLAN)) {
            continue;
        }
        if (msg.includes(ERROR_MARK)) {
            invalid.push(s);
        } else {
            valid.push(s);
        }
    }
    // 两组都非空时在中间插一个空行分隔；只有一组时直接拼接，避免多余空行
    const parts = valid;
    if (invalid.length) {
        if (parts.length) parts.push("");
        parts.push(...invalid);
    }
    return parts.join("\n");
}

/**
 * 并行查询全部账号用量，返回拼接后的多行输出
 *
 * 不抛出异常：单账号出错时该行为错误字符串（由子查询函数保证），
 * 配置读取失败等整体错误返回 "❌ ..." 单行
 *
 * 输出分组：有效行（成功查到用量）在前，无效行（含 ❌ 错误标记）在后，
 * 组内保持账号顺序
 *
 * @param {object} [options] 透传给各查询函数（display/hideOnMonthlyExhausted/hideOnNoActivePlan/cache）
 * @param {boolean} [options.hideOnNoActivePlan=false] 无活跃套餐时隐藏该行
 * @param {object} [options._config] 内部：已解析的 config 对象，避免重复读取
 * @returns {Promise<string>} 多行输出（空行已过滤，无换行结尾）
 */
export async function queryAll(options = {}) {
    const { hideOnNoActivePlan = false } = options;
    let cfg;
    try {
        // 复用调用方已读的 config，避免重复 loadConfig；未提供时自行读取
        cfg = options._config || loadConfig();
    } catch (err) {
        return `${ERROR_MARK}${err.message}`;
    }

    /** @type {Promise<string>[]} */
    const tasks = [];

    for (const [key, queryFn] of Object.entries(QUERY_FNS)) {
        const accounts = cfg[key];
        if (!Array.isArray(accounts)) {
            continue;
        }

        for (let i = 0; i < accounts.length; i++) {
            tasks.push(queryFn({ ...options, _config: cfg, position: i }));
        }
    }

    if (tasks.length === 0) {
        return `${ERROR_MARK}未找到可查询的账号`;
    }

    return groupOutputs(await Promise.all(tasks), { hideOnNoActivePlan });
}

// #endregion 查询入口 --------------------------------

// #region CLI 壳 ----------------

async function main() {
    try {
        const { display, hideOnMonthlyExhausted, hideOnNoActivePlan } =
            parseArgs(process.argv);
        const output = await queryAll({
            display,
            hideOnMonthlyExhausted,
            hideOnNoActivePlan,
        });
        process.stdout.write(output);
    } catch (err) {
        process.stdout.write(`${ERROR_MARK}${err.message}\n`);
    }
}

if (isMainModule(import.meta.url)) {
    main();
}

// #endregion CLI 壳 --------------------------------
