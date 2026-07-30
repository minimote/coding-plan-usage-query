/**
 * @file 用量预览脚本
 *
 * 构造虚拟用量数据输出，用于预览显示效果
 */

import {
    renderWindows,
    DISPLAY,
    DEFAULT_LABELS,
    KEYS,
    WINDOW,
} from "../utils/utils-query-usage.mjs";

// 假数据：按阅读顺序（行内从左到右、行间从上到下）循环 绿→黄→橙→红 四档颜色
// 百分比用 1/2/8/9 结尾，五小时不超过周用量的 2 倍，周不超过月用量的 2 倍
const samples = [
    {
        prefixes: DEFAULT_LABELS[KEYS.ARK].agent,
        usage: {
            [WINDOW.ROLLING]: { pct: 11, sec: 16000 },
            [WINDOW.WEEKLY]: { pct: 62, sec: 230000 },
            [WINDOW.MONTHLY]: { pct: 88, sec: 320000 },
        },
    },
    {
        prefixes: DEFAULT_LABELS[KEYS.ARK].coding,
        usage: {
            [WINDOW.ROLLING]: { pct: 100, sec: 300 },
            [WINDOW.WEEKLY]: { pct: 51, sec: 300000 },
            [WINDOW.MONTHLY]: { pct: 71, sec: 760000 },
        },
    },
    {
        prefixes: DEFAULT_LABELS[KEYS.OLLAMA],
        usage: {
            [WINDOW.ROLLING]: { pct: 89, sec: 2000 },
            [WINDOW.WEEKLY]: { pct: 100, sec: 50000 },
        },
    },
    {
        prefixes: DEFAULT_LABELS[KEYS.OPENCODE],
        usage: {
            [WINDOW.ROLLING]: { pct: 18, sec: 14000 },
            [WINDOW.WEEKLY]: { pct: 79, sec: 130000 },
            [WINDOW.MONTHLY]: { pct: 91, sec: 240000 },
        },
    },
    {
        prefixes: DEFAULT_LABELS[KEYS.QWEN],
        usage: {
            [WINDOW.ROLLING]: { pct: 100, sec: 300 },
            [WINDOW.WEEKLY]: { pct: 52, sec: 290000 },
        },
    },
];

process.stdout.write("\n");

for (const s of samples) {
    process.stdout.write(
        renderWindows(s.usage, DISPLAY.LONG, s.prefixes) + "\n",
    );
}
