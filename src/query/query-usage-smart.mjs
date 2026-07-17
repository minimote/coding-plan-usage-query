/**
 * @file 根据 CC-Switch 当前供应商智能路由到对应用量查询脚本
 *
 * 从 CC-Switch 读取当前供应商的 API Key，在 config 中匹配账号位置，调用对应子脚本
 * 检测到免费模型时显示全部账号用量
 *
 * 用法:
 *   node query-usage-smart.mjs
 *
 * 参数:
 *   --display / -d    显示模式：auto(a,默认) | long(l) | short(s)
 */

import { readFileSync } from "fs";
import {
    ARGS,
    SCRIPTS,
    HELPER,
    TOOLS_DIR,
    loadConfig,
    safeExec,
    parseArgs,
} from "../utils/utils-query-usage.mjs";
import { getAPIKey } from "../utils/utils-cc-switch.mjs";

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
    const result = safeExec(HELPER.actualModel, { input: raw, dir: TOOLS_DIR });
    return result.toLowerCase().includes("free");
}

// #endregion 免费模型判断 --------------------------------

// #region 脚本入口 ----------------

async function main() {
    const { display } = parseArgs(process.argv);

    // 使用免费模型时查询全部账号，强制隐藏月度用完的账号
    if (isFreeModel()) {
        const args = [
            ARGS.DISPLAY,
            display,
            ARGS.HIDE_ON_MONTHLY_EXHAUSTED,
            "true",
        ];
        process.stdout.write(safeExec(HELPER.all, { args }));
        return;
    }

    const apiKey = await getAPIKey();
    const cfg = loadConfig();

    let matched = null;
    for (const [key, file] of Object.entries(SCRIPTS)) {
        const accounts = cfg[key];
        if (!Array.isArray(accounts)) {
            continue;
        }
        const idx = accounts.findIndex((a) => a.apiKey && a.apiKey === apiKey);
        if (idx >= 0) {
            matched = { file, index: idx, account: accounts[idx] };
            break;
        }
    }

    // 匹配不到账号时静默退出
    if (!matched) {
        process.exit(0);
    }

    // 只传必要参数（hide 走子脚本默认 false，保留用完账号的显示）
    const childArgs = [
        ARGS.POSITION,
        String(matched.index),
        ARGS.DISPLAY,
        display,
    ];
    // ark 账号透传 type，opencode 无 type 字段
    if (matched.account.type) {
        childArgs.push(ARGS.TYPE, matched.account.type);
    }
    process.stdout.write(safeExec(matched.file, { args: childArgs }));
}

main().catch((err) => {
    console.log(`❌ ${err.message}`);
});

// #endregion 脚本入口 --------------------------------
