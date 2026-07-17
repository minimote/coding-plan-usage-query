/**
 * @file 查询所有套餐用量（并行执行）
 *
 * 读取 config.json 中所有账号，并行调用各子脚本查询，按顺序拼接输出
 *
 * 用法:
 *   node query-usage-all.mjs
 *
 * 参数:
 *   --display / -d    显示模式：auto(a,默认) | long(l) | short(s)
 *   --type / -t       套餐类型：coding(c,默认) | agent(a)
 *   --hide-on-monthly-exhausted  月度用量耗尽时隐藏该行（true|false，默认 false）
 */

import {
    safeExecAsync,
    SCRIPTS,
    ARGS,
    loadConfig,
} from "../utils/utils-query-usage.mjs";

// #region 脚本入口 ----------------

async function main() {
    const userArgs = process.argv.slice(2);
    const cfg = loadConfig();

    /** @type {Promise<string>[]} */
    const tasks = [];

    for (const [key, file] of Object.entries(SCRIPTS)) {
        const accounts = cfg[key];
        if (!Array.isArray(accounts)) {
            continue;
        }

        for (let i = 0; i < accounts.length; i++) {
            const args = [...userArgs, ARGS.POSITION, String(i)];
            tasks.push(safeExecAsync(file, { args }));
        }
    }

    if (tasks.length === 0) {
        process.stdout.write("❌ 未找到可查询的账号\n");
        return;
    }

    const outputs = (await Promise.all(tasks)).filter((s) => s !== "");
    process.stdout.write(outputs.join("\n"));
}

main().catch((err) => {
    process.stdout.write(`❌ ${err.message}\n`);
});

// #endregion 脚本入口 --------------------------------
