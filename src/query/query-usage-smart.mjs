/**
 * @file 根据 CC-Switch 当前供应商智能路由到对应用量查询函数
 *
 * 从 CC-Switch 读取当前供应商的 API Key，在 config 中匹配账号位置，调用对应查询函数
 * 检测到免费模型时显示全部账号用量
 * 查询结果带短时缓存，减少高频刷新下的重复请求
 *
 * 用法:
 *   node query-usage-smart.mjs
 *
 * 参数:
 *   --display / -d    显示模式：auto(a,默认) | long(l) | short(s)
 */

import { readFileSync } from "fs";
import { loadConfig, parseArgs, isMainModule } from "../utils/utils-query-usage.mjs";
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

// #region 脚本入口 ----------------

async function main() {
    const { display } = parseArgs(process.argv);

    // 使用免费模型时查询全部账号，强制隐藏月度用完的账号
    if (isFreeModel()) {
        process.stdout.write(
            await queryAll({
                display,
                hideOnMonthlyExhausted: true,
                cache: true,
            }),
        );
        return;
    }

    const apiKey = await getAPIKey();
    const cfg = loadConfig();

    let matched = null;
    for (const [key, queryFn] of Object.entries(QUERY_FNS)) {
        const accounts = cfg[key];
        if (!Array.isArray(accounts)) {
            continue;
        }
        const idx = accounts.findIndex((a) => a.apiKey && a.apiKey === apiKey);
        if (idx >= 0) {
            matched = { queryFn, index: idx, account: accounts[idx] };
            break;
        }
    }

    // 匹配不到账号时静默退出
    if (!matched) {
        process.exit(0);
    }

    // hide 走默认 false，保留用完账号的显示；type 由查询函数回退到账号配置
    process.stdout.write(
        await matched.queryFn({
            position: matched.index,
            display,
            cache: true,
        }),
    );
}

if (isMainModule(import.meta.url)) {
    main().catch((err) => {
        process.stdout.write(`❌ ${err.message}\n`);
    });
}

// #endregion 脚本入口 --------------------------------
