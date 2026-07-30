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
import { queryUsage as queryOpencode } from "./query-usage-opencode-go.mjs";
import { queryUsage as queryArk } from "./query-usage-ark.mjs";
import { queryUsage as queryOllama } from "./query-usage-ollama.mjs";
import { queryUsage as queryQwen } from "./query-usage-qwen.mjs";

// #region 查询入口 ----------------

/**
 * 套餐 key 到查询函数的映射
 *
 * key 顺序即输出顺序（smart 的匹配顺序与此一致）
 */
export const QUERY_FNS = Object.freeze({
    [KEYS.ARK]: queryArk,
    [KEYS.OLLAMA]: queryOllama,
    [KEYS.OPENCODE]: queryOpencode,
    [KEYS.QWEN]: queryQwen,
});

/**
 * 并行查询全部账号用量，返回拼接后的多行输出
 *
 * 不抛出异常：单账号出错时该行为错误字符串（由子查询函数保证），
 * 配置读取失败等整体错误返回 "❌ ..." 单行
 *
 * @param {object} [options] 透传给各查询函数（display/hideOnMonthlyExhausted/hideOnNoActivePlan/cache）
 * @param {boolean} [options.hideOnNoActivePlan=false] 无活跃套餐时隐藏该行
 * @returns {Promise<string>} 多行输出（空行已过滤，无换行结尾）
 */
export async function queryAll(options = {}) {
    const { hideOnNoActivePlan = false } = options;
    let cfg;
    try {
        cfg = loadConfig();
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

    const outputs = (await Promise.all(tasks)).filter(
        (s) => s !== "" && !(hideOnNoActivePlan && s.includes(ERROR_MARK + NO_ACTIVE_PLAN)),
    );
    return outputs.join("\n");
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
