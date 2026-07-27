/**
 * @file colorful-tokens 着色与格式化单元测试
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    colorForTokens,
    formatTokens,
    renderFromRaw,
} from "../src/tools/colorful-tokens.mjs";
import { COLORS } from "../src/utils/utils-query-usage.mjs";

// #region colorForTokens ----------------

test("colorForTokens: 四档阈值与边界", () => {
    // [0, 256k) 绿
    assert.equal(colorForTokens(0), COLORS.GREEN);
    assert.equal(colorForTokens(255999), COLORS.GREEN);
    // [256k, 384k) 黄
    assert.equal(colorForTokens(256000), COLORS.YELLOW);
    assert.equal(colorForTokens(383999), COLORS.YELLOW);
    // [384k, 512k) 橙
    assert.equal(colorForTokens(384000), COLORS.ORANGE);
    assert.equal(colorForTokens(511999), COLORS.ORANGE);
    // [512k, +∞) 红
    assert.equal(colorForTokens(512000), COLORS.RED);
    assert.equal(colorForTokens(1000000), COLORS.RED);
});

// #endregion colorForTokens --------------------------------

// #region formatTokens ----------------

test("formatTokens: <1000 原样输出", () => {
    assert.equal(formatTokens(0), "0");
    assert.equal(formatTokens(999), "999");
});

test("formatTokens: >=1000 转 k 单位并四舍五入", () => {
    assert.equal(formatTokens(1000), "1k");
    assert.equal(formatTokens(123456), "123k"); // round(123.456)=123
    assert.equal(formatTokens(1500), "2k"); // round(1.5)=2
    assert.equal(formatTokens(999499), "999k"); // round(999.499)=999
});

// #endregion formatTokens --------------------------------

// #region renderFromRaw ----------------

test("renderFromRaw: input+output 求和后着色", () => {
    const raw = JSON.stringify({
        context_window: {
            total_input_tokens: 100000,
            total_output_tokens: 50000,
        },
    });
    const out = renderFromRaw(raw);
    // 150k 落在 [0,256k) 绿档
    assert.ok(out.startsWith(COLORS.GREEN));
    assert.ok(out.includes("150k"));
    assert.ok(out.endsWith(COLORS.RESET));
});

test("renderFromRaw: 高用量落入红档", () => {
    const raw = JSON.stringify({
        context_window: {
            total_input_tokens: 300000,
            total_output_tokens: 250000,
        },
    });
    const out = renderFromRaw(raw);
    // 550k 落在 [512k,+∞) 红档
    assert.ok(out.startsWith(COLORS.RED));
    assert.ok(out.includes("550k"));
});

test("renderFromRaw: 缺失 context_window 视为 0，绿色 0", () => {
    const out = renderFromRaw(JSON.stringify({}));
    assert.ok(out.startsWith(COLORS.GREEN));
    assert.ok(out.includes("0"));
});

test("renderFromRaw: 缺失 token 字段视为 0", () => {
    const out = renderFromRaw(JSON.stringify({ context_window: {} }));
    assert.ok(out.startsWith(COLORS.GREEN));
    assert.ok(out.includes("0"));
});

test("renderFromRaw: 非法 JSON 返回亮白问号", () => {
    assert.equal(
        renderFromRaw("{not json"),
        `${COLORS.LABEL}?${COLORS.RESET}`,
    );
});

test("renderFromRaw: 空字符串返回亮白问号", () => {
    assert.equal(renderFromRaw(""), `${COLORS.LABEL}?${COLORS.RESET}`);
});

// #endregion renderFromRaw --------------------------------
