/**
 * @file 根据 CC-Switch 当前供应商智能路由到对应用量查询函数
 *
 * 从 CC-Switch 读取当前供应商的 API Key，在 config 中匹配账号位置，调用对应查询函数
 * 匹配不到账号（如免费模型）时显示全部账号用量
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
    matchProviderAccount,
} from "../utils/utils-query-usage.mjs";
import { queryAll, QUERY_FNS } from "./query-usage-all.mjs";
import { getActualModelName } from "../tools/get-actual-model-name.mjs";

// #region 免费模型判断 ----------------

/**
 * 判断模型名是否含 "free"（忽略大小写）
 *
 * 纯函数，供 isFreeModel 与单测使用；raw 为 ccstatusline 传入的 JSON 字符串
 *
 * @param {string} raw stdin 收到的 JSON 字符串
 * @returns {boolean}
 */
export function isFreeModelName(raw) {
    if (!raw || raw.trim() === "") {
        return false;
    }
    return getActualModelName(raw).toLowerCase().includes("free");
}

/**
 * 检测当前模型名称是否包含 "free"（忽略大小写）
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
    return isFreeModelName(raw);
}

// #endregion 免费模型判断 --------------------------------

// #region 脚本入口 ----------------

/**
 * 查询并输出全部账号用量（免费模型与匹配不到账号两种兜底场景共用）
 *
 * @param {"auto" | "long" | "short"} display 展示档位
 * @param {object} [cfg] 可选：调用方已读的 config，传入后 queryAll 不再重复 loadConfig
 * @returns {Promise<void>}
 */
async function queryAllFallback(display, cfg) {
    process.stdout.write(
        await queryAll({
            display,
            hideOnMonthlyExhausted: true,
            hideOnNoActivePlan: true,
            cache: true,
            _config: cfg,
        }),
    );
}

async function main() {
    const { display } = parseArgs(process.argv);

    // 首先判断模型名是否含 free（忽略大小写）：免费模型直接查询全部账号
    if (isFreeModel()) {
        await queryAllFallback(display);
        return;
    }

    // config 只读一次，匹配与子查询全程复用
    const cfg = loadConfig();
    const matched = await matchProviderAccount(cfg);

    // 匹配不到账号时也查询全部账号
    if (!matched) {
        await queryAllFallback(display, cfg);
        return;
    }

    // hide 走默认 false，保留用完账号的显示；type 由查询函数回退到账号配置
    // _config 复用上方已读的 cfg，避免子查询函数重复 loadConfig
    process.stdout.write(
        await QUERY_FNS[matched.key]({
            position: matched.index,
            display,
            cache: true,
            _config: cfg,
        }),
    );
}

if (isMainModule(import.meta.url)) {
    main().catch((err) => {
        process.stdout.write(`${ERROR_MARK}${err.message}\n`);
    });
}

// #endregion 脚本入口 --------------------------------
