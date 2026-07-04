/**
 * @file 查询所有套餐用量
 *
 * 依次执行所有子脚本，按子脚本数组定义的顺序拼接输出
 *
 * 用法: node query-usage-all.mjs
 */

import { safeExec } from "./query-usage-utils.mjs";

// ── 子脚本清单 ────────────────────────────
// 按顺序依次执行，拼接输出信息

const SUB_SCRIPTS = [
    "query-usage-opencode-go.mjs",
    "query-usage-ark.mjs",
];

// ── 入口 ─────────────────────────────────

function main() {
    const outputs = SUB_SCRIPTS.map((name) => safeExec(name));
    process.stdout.write(outputs.join("\n"));
}

main();
