/**
 * @file 用量查询工具函数
 *
 * 包含 safeExec、进度条渲染、倒计时格式、百分比着色四个函数
 */

import { execFileSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * 同步执行子脚本并返回其 stdout
 *
 * 子进程失败（超时、崩溃、非零退出）时不抛错，返回错误信息字符串，
 * 便于调用方保持退出码 0
 *
 * @param {string} scriptFile 子脚本文件名（与调用脚本同目录）
 * @param {string} [input] 可选，传递给子进程 stdin 的数据
 * @param {number} timeout 超时毫秒数，默认 4000
 * @returns {string} 子进程 stdout 去除首尾空白；出错时返回 "文件名 | 查询失败: 原因"
 */
export function safeExec(scriptFile, input, timeout = 4000) {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const absPath = join(__dirname, scriptFile);
    const opts = {
        timeout,
        encoding: "utf8",
    };
    if (input !== undefined) opts.input = input;
    try {
        return execFileSync("node", [absPath], opts).trim();
    } catch (err) {
        return `${scriptFile} | 查询失败: ${err.message}`;
    }
}

/**
 * 渲染 10 格进度条
 *
 * @param {number} pct 百分比 0-100
 * @returns {string} 形如 "█████░░░░░" 的 10 格字符串
 */
export function bar(pct) {
    const n = Math.round(pct / 10);
    return "█".repeat(Math.min(n, 10)).padEnd(10, "░");
}

/**
 * 根据用量百分比返回 ANSI 颜色代码
 *
 * @param {number} pct 百分比 0-100
 * @returns {string} ANSI 颜色代码，0-59% 绿(32)，60-89% 黄(33)，90+% 红(31)
 */
export function pctColorCode(pct) {
    if (pct >= 90) return "31";
    if (pct >= 60) return "33";
    return "32";
}

/**
 * 秒数 → 人类可读倒计时
 *
 * @param {number} sec 距重置的剩余秒数
 * @returns {string} 形如 "3天6小时" / "4小时47分" / "12分" / "即将"
 */
export function toCountdown(sec) {
    if (sec <= 0) return "即将重置";
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return h > 0 ? `${d}天${h}小时` : `${d}天`;
    if (h > 0) return m > 0 ? `${h}小时${m}分钟` : `${h}小时`;
    return `${m}分钟`;
}
