/**
 * @file 用量预览脚本
 *
 * 构造假用量数据调用 renderWindows 输出，用于预览状态栏显示效果
 * 无需真实账号或网络
 */

import {
    renderWindows,
    DISPLAY,
    DEFAULT_LABELS,
    KEYS,
    WINDOW,
} from "../utils/utils-query-usage.mjs";

// 假数据：覆盖不同 provider / 窗口组合 / 百分比档位
const samples = [
    {
        prefixes: DEFAULT_LABELS[KEYS.ARK].coding,
        usage: {
            [WINDOW.ROLLING]: { pct: 32, sec: 3600 },
            [WINDOW.WEEKLY]: { pct: 62, sec: 500000 },
            [WINDOW.MONTHLY]: { pct: 82, sec: 2000000 },
        },
    },
    {
        prefixes: DEFAULT_LABELS[KEYS.ARK].agent,
        usage: {
            [WINDOW.ROLLING]: { pct: 100, sec: 1800 },
            [WINDOW.WEEKLY]: { pct: 52, sec: 300000 },
            [WINDOW.MONTHLY]: { pct: 64, sec: 1000000 },
        },
    },
    {
        prefixes: DEFAULT_LABELS[KEYS.OPENCODE],
        usage: {
            [WINDOW.ROLLING]: { pct: 64, sec: 7200 },
            [WINDOW.WEEKLY]: { pct: 100, sec: 400000 },
            [WINDOW.MONTHLY]: { pct: 52, sec: 2500000 },
        },
    },
    {
        prefixes: DEFAULT_LABELS[KEYS.QWEN],
        usage: {
            [WINDOW.ROLLING]: { pct: 22, sec: 1800 },
            [WINDOW.WEEKLY]: { pct: 72, sec: 200000 },
        },
    },
];

process.stdout.write("\n");

for (const s of samples) {
    process.stdout.write(
        renderWindows(s.usage, DISPLAY.LONG, s.prefixes) + "\n",
    );
}
