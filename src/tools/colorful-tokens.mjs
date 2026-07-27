/**
 * @file colorful-tokens.mjs
 *
 * 从 ccstatusline-zh 的标准输入接收 JSON，取 context 原始 token 数按阈值着色输出
 * 颜色复用 utils-query-usage.mjs 的 COLORS，与用量查询状态栏配色统一
 */

import { readFileSync } from "fs";
import { COLORS, isMainModule } from "../utils/utils-query-usage.mjs";

/**
 * 按 token 总数返回对应档位的 ANSI 颜色
 *
 * 阈值：[512k,+∞) 红，[384k,512k) 橙，[256k,384k) 黄，[0,256k) 绿
 *
 * @param {number} total 上下文 input + output token 总数
 * @returns {string} ANSI 颜色转义序列
 */
export function colorForTokens(total) {
    if (total >= 512_000) {
        return COLORS.RED;
    }
    if (total >= 384_000) {
        return COLORS.ORANGE;
    }
    if (total >= 256_000) {
        return COLORS.YELLOW;
    }
    return COLORS.GREEN;
}

/**
 * 格式化 token 数为显示字符串
 *
 * @param {number} total
 * @returns {string} >=1000 转 k 单位（四舍五入到整数），否则原样输出
 */
export function formatTokens(total) {
    return total >= 1000 ? `${Math.round(total / 1000)}k` : String(total);
}

/**
 * 从原始 JSON 字符串渲染着色后的 token 显示
 *
 * JSON 解析失败或字段缺失时返回亮白问号
 *
 * @param {string} raw ccstatusline 传入的 JSON
 * @returns {string} 着色后的显示串
 */
export function renderFromRaw(raw) {
    try {
        const data = JSON.parse(raw);
        const cw = data?.context_window;

        // 从 JSON 取总 token 数（输入 + 输出）
        const total =
            (cw?.total_input_tokens || 0) + (cw?.total_output_tokens || 0);

        return `${colorForTokens(total)}${formatTokens(total)}${COLORS.RESET}`;
    } catch {
        // 出现异常输出问号(亮白色)
        return `${COLORS.LABEL}?${COLORS.RESET}`;
    }
}

/**
 * 主函数：读 stdin -> 渲染着色 token 数 -> 输出
 */
function main() {
    // 终端直接运行时 stdin 为 TTY，readFileSync(0) 会阻塞，给出提示
    if (process.stdin.isTTY) {
        process.stdout.write(
            "请在 ccstatusline / ccstatusline-zh 中作为自定义命令调用",
        );
        return;
    }
    let raw;
    try {
        raw = readFileSync(0, "utf8");
    } catch {
        // stdin 读取失败（管道断开等）按异常处理
        raw = "";
    }
    process.stdout.write(renderFromRaw(raw));
}

if (isMainModule(import.meta.url)) {
    main();
}
