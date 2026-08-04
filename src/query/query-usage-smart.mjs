/**
 * @file 根据 CC-Switch 当前供应商智能路由到对应用量查询函数
 *
 * 从 CC-Switch 读取当前供应商的 API Key，在 config 中匹配账号位置，调用对应查询函数
 * 检测到免费模型或匹配不到账号时显示全部账号用量
 * 查询结果带短时缓存，减少高频刷新下的重复请求
 *
 * 用法:
 *   node query-usage-smart.mjs
 *
 * 参数:
 *   --display / -d    显示模式：auto(a,默认) | long(l) | short(s)
 */

import { readFileSync } from "fs";
import {
    loadConfig,
    parseArgs,
    isMainModule,
    ERROR_MARK,
} from "../utils/utils-query-usage.mjs";
import { getAPIKey } from "../utils/utils-cc-switch.mjs";
import { getActualModel } from "../tools/get-actual-model.mjs";
import { queryAll, QUERY_FNS } from "./query-usage-all.mjs";

// #region 免费模型判断 ----------------

/**
 * 检测当前模型名称是否包含 "free"
 *
 * @returns {boolean}
 */
function isFreeModel() {
    // 终端直接运行时 stdin 无管道输入，readFileSync(0) 会阻塞，直接跳过
    if (process.stdin.isTTY) {
        return false;
    }
    let raw;
    // 非 TTY 时读取 ccstatusline 传入的 JSON，管道断开等异常情况也视为非免费模型
    try {
        raw = readFileSync(0, "utf-8");
    } catch {
        return false;
    }
    if (!raw || raw.trim() === "") {
        return false;
    }
    return getActualModel(raw).toLowerCase().includes("free");
}

// #endregion 免费模型判断 --------------------------------

// #region 账号匹配 ----------------

/**
 * 在 config 各账号数组中按 apiKey 查找账号
 *
 * 按 QUERY_FNS 的 key 顺序遍历，命中第一个含该 apiKey 的账号即返回；
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
    for (const key of Object.keys(QUERY_FNS)) {
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

// #endregion 账号匹配 --------------------------------

// #region 脚本入口 ----------------

/**
 * 查询并输出全部账号用量（兜底场景共用参数）
 *
 * 免费模型与匹配不到账号两种兜底场景共用：强制隐藏月度用完与无活跃套餐的账号，
 * 保证两处显示效果一致
 *
 * @param {"auto" | "long" | "short"} display 展示档位
 * @returns {Promise<void>}
 */
async function queryAllFallback(display) {
    process.stdout.write(
        await queryAll({
            display,
            hideOnMonthlyExhausted: true,
            hideOnNoActivePlan: true,
            cache: true,
        }),
    );
}

async function main() {
    const { display } = parseArgs(process.argv);

    // 使用免费模型时查询全部账号
    if (isFreeModel()) {
        await queryAllFallback(display);
        return;
    }

    const apiKey = await getAPIKey();
    const cfg = loadConfig();

    const matched = matchAccountByApiKey(cfg, apiKey);

    // 匹配不到账号时也查询全部账号
    if (!matched) {
        await queryAllFallback(display);
        return;
    }

    // hide 走默认 false，保留用完账号的显示；type 由查询函数回退到账号配置
    process.stdout.write(
        await QUERY_FNS[matched.key]({
            position: matched.index,
            display,
            cache: true,
        }),
    );
}

if (isMainModule(import.meta.url)) {
    main().catch((err) => {
        process.stdout.write(`${ERROR_MARK}${err.message}\n`);
    });
}

// #endregion 脚本入口 --------------------------------
