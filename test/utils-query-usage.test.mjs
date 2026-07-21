/**
 * @file utils-query-usage 纯函数单元测试
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DISPLAY,
    TYPE,
    bar,
    pctColorCode,
    pctSegment,
    toCountdown,
    renderWindows,
    renderErrorLine,
    normalizeDisplay,
    normalizeType,
    parseArgs,
    findAccount,
    resolvePrefixes,
    COLORS,
} from "../src/utils/utils-query-usage.mjs";

// #region 渲染 ----------------

test("bar: 10 格进度条，按百分比填充", () => {
    assert.equal(bar(0), "░░░░░░░░░░");
    assert.equal(bar(50), "█████░░░░░");
    assert.equal(bar(100), "██████████");
    // 四舍五入：14% -> 1 格，15% -> 2 格
    assert.equal(bar(14), "█░░░░░░░░░");
    assert.equal(bar(15), "██░░░░░░░░");
    // 超出上限钳制为 10 格
    assert.equal(bar(150), "██████████");
});

test("pctColorCode: 按用量分档着色", () => {
    assert.equal(pctColorCode(0), COLORS.GREEN);
    assert.equal(pctColorCode(59), COLORS.GREEN);
    assert.equal(pctColorCode(60), COLORS.YELLOW);
    assert.equal(pctColorCode(79), COLORS.YELLOW);
    assert.equal(pctColorCode(80), COLORS.ORANGE);
    assert.equal(pctColorCode(99), COLORS.ORANGE);
    assert.equal(pctColorCode(100), COLORS.RED);
    assert.equal(pctColorCode(150), COLORS.RED);
});

test("pctSegment: short 档仅百分比，long 档含进度条", () => {
    const shortSeg = pctSegment(50, DISPLAY.SHORT);
    assert.ok(shortSeg.includes("50%"));
    assert.ok(!shortSeg.includes("█"));

    const longSeg = pctSegment(50, DISPLAY.LONG);
    assert.ok(longSeg.includes("█████░░░░░"));
    assert.ok(longSeg.includes("50%"));
});

test("pctSegment: 百分比四舍五入到整数", () => {
    const seg = pctSegment(12.6, DISPLAY.SHORT);
    assert.ok(seg.includes("13%"));
});

test("toCountdown: long 档中文倒计时", () => {
    assert.equal(toCountdown(45 * 60, DISPLAY.LONG), "45分钟");
    assert.equal(toCountdown(3600, DISPLAY.LONG), "1小时");
    assert.equal(toCountdown(2 * 3600 + 5 * 60, DISPLAY.LONG), "2小时5分钟");
    assert.equal(toCountdown(86400, DISPLAY.LONG), "1天");
    assert.equal(toCountdown(90000, DISPLAY.LONG), "1天1小时");
});

test("toCountdown: short 档英文倒计时", () => {
    assert.equal(toCountdown(45 * 60, DISPLAY.SHORT), "45m");
    assert.equal(toCountdown(3600, DISPLAY.SHORT), "1h");
    assert.equal(toCountdown(2 * 3600 + 5 * 60, DISPLAY.SHORT), "2h5m");
    assert.equal(toCountdown(86400, DISPLAY.SHORT), "1d");
    assert.equal(toCountdown(90000, DISPLAY.SHORT), "1d1h");
});

test("toCountdown: 负数钳制为 0", () => {
    assert.equal(toCountdown(-100, DISPLAY.LONG), "0分钟");
    assert.equal(toCountdown(-100, DISPLAY.SHORT), "0m");
});

test("toCountdown: 默认 long 档", () => {
    assert.equal(toCountdown(45 * 60), "45分钟");
});

test("renderWindows: 三窗口齐全带前缀", () => {
    const usage = {
        rolling: { pct: 10, sec: 1800 },
        weekly: { pct: 50, sec: 500000 },
        monthly: { pct: 100, sec: 2000000 },
    };
    const out = renderWindows(usage, DISPLAY.SHORT, {
        long: "长标签",
        short: "短",
    });
    // 前缀 + 三窗口百分比 + 倒计时
    assert.ok(out.includes(COLORS.PREFIX + "短"));
    assert.ok(out.includes("10%"));
    assert.ok(out.includes("100%"));
    assert.ok(out.includes("30m"));
});

test("renderWindows: 窗口数据为 null 显示 标签:—（em dash）", () => {
    const usage = {
        rolling: null,
        weekly: null,
        monthly: null,
    };
    const out = renderWindows(usage, DISPLAY.SHORT);
    // 标签后跟 ANSI reset 码，去掉后再断言；null 窗口用 em dash (U+2014)
    const plain = out.replace(/\x1b\[[\d;]*m/g, "");
    const dash = String.fromCodePoint(0x2014);
    assert.ok(plain.includes(`五:${dash}`));
    assert.ok(plain.includes(`周:${dash}`));
    assert.ok(plain.includes(`月:${dash}`));
});

test("renderWindows: hideOnMonthlyExhausted 月度用尽时返回空串", () => {
    const usage = {
        rolling: { pct: 10, sec: 1800 },
        weekly: { pct: 50, sec: 500000 },
        monthly: { pct: 100, sec: 2000000 },
    };
    assert.equal(
        renderWindows(usage, DISPLAY.SHORT, undefined, true),
        "",
    );
});

test("renderWindows: monthly 为 null 时不触发隐藏", () => {
    const usage = {
        rolling: { pct: 10, sec: 1800 },
        weekly: { pct: 50, sec: 500000 },
        monthly: null,
    };
    const out = renderWindows(usage, DISPLAY.SHORT, undefined, true);
    assert.notEqual(out, "");
});

test("renderWindows: AUTO 档窄终端回退 SHORT", () => {
    const usage = {
        rolling: { pct: 10, sec: 1800 },
        weekly: { pct: 50, sec: 500000 },
        monthly: { pct: 100, sec: 2000000 },
    };
    process.env.COLUMNS = "20";
    try {
        const out = renderWindows(usage, DISPLAY.AUTO, {
            long: "长标签",
            short: "短",
        });
        // 窄终端应回退 short 档（用 short 前缀）
        assert.ok(out.includes(COLORS.PREFIX + "短"));
    } finally {
        delete process.env.COLUMNS;
    }
});

test("renderErrorLine: 格式为 前缀 | ❌ 消息", () => {
    const out = renderErrorLine(
        { long: "火山CodingPlan", short: "Coding" },
        DISPLAY.LONG,
        "测试错误",
    );
    assert.ok(out.includes(COLORS.PREFIX + "火山CodingPlan"));
    assert.ok(out.includes("❌ 测试错误"));
});

test("renderErrorLine: short 档用 short 标签", () => {
    const out = renderErrorLine(
        { long: "火山CodingPlan", short: "Coding" },
        DISPLAY.SHORT,
        "err",
    );
    assert.ok(out.includes(COLORS.PREFIX + "Coding"));
});

// #endregion 渲染 --------------------------------

// #region 参数解析 ----------------

test("normalizeDisplay: 支持缩写和全称", () => {
    assert.equal(normalizeDisplay("l"), DISPLAY.LONG);
    assert.equal(normalizeDisplay("s"), DISPLAY.SHORT);
    assert.equal(normalizeDisplay("a"), DISPLAY.AUTO);
    assert.equal(normalizeDisplay("long"), DISPLAY.LONG);
});

test("normalizeDisplay: 非法值抛错，提供 fallback 时回退", () => {
    assert.throws(() => normalizeDisplay("xyz"));
    assert.equal(
        normalizeDisplay("xyz", { fallback: DISPLAY.AUTO }),
        DISPLAY.AUTO,
    );
});

test("normalizeType: 支持缩写和全称", () => {
    assert.equal(normalizeType("c"), TYPE.CODING);
    assert.equal(normalizeType("a"), TYPE.AGENT);
    assert.equal(normalizeType("coding"), TYPE.CODING);
});

test("normalizeType: 非法值抛错，提供 fallback 时回退", () => {
    assert.throws(() => normalizeType("xyz"));
    assert.equal(normalizeType("xyz", { fallback: TYPE.CODING }), TYPE.CODING);
});

test("parseArgs: 全默认值（type 为 undefined，由调用方回退）", () => {
    const parsed = parseArgs(["node", "script.mjs"]);
    assert.equal(parsed.display, DISPLAY.AUTO);
    assert.equal(parsed.type, undefined);
    assert.equal(parsed.position, 0);
    assert.equal(parsed.hideOnMonthlyExhausted, false);
});

test("parseArgs: 显式传参", () => {
    const parsed = parseArgs([
        "node",
        "script.mjs",
        "--type",
        "agent",
        "--display",
        "short",
        "--position",
        "2",
        "--hide-on-monthly-exhausted",
        "true",
    ]);
    assert.equal(parsed.type, TYPE.AGENT);
    assert.equal(parsed.display, DISPLAY.SHORT);
    assert.equal(parsed.position, 2);
    assert.equal(parsed.hideOnMonthlyExhausted, true);
});

test("parseArgs: 缩写参数", () => {
    const parsed = parseArgs([
        "node",
        "script.mjs",
        "-t",
        "a",
        "-d",
        "s",
        "-p",
        "1",
    ]);
    assert.equal(parsed.type, TYPE.AGENT);
    assert.equal(parsed.display, DISPLAY.SHORT);
    assert.equal(parsed.position, 1);
});

test("parseArgs: 非法 type 抛错", () => {
    assert.throws(() =>
        parseArgs(["node", "script.mjs", "--type", "xyz"]),
    );
});

test("parseArgs: 非法 position 抛错", () => {
    assert.throws(() =>
        parseArgs(["node", "script.mjs", "--position", "-1"]),
    );
    assert.throws(() =>
        parseArgs(["node", "script.mjs", "--position", "abc"]),
    );
});

// #endregion 参数解析 --------------------------------

// #region 账号匹配 ----------------

test("findAccount: 按 index 取账号", () => {
    const accounts = [{ name: "a" }, { name: "b" }, { name: "c" }];
    assert.equal(findAccount(accounts, 0).name, "a");
    assert.equal(findAccount(accounts, 2).name, "c");
    assert.equal(findAccount(accounts).name, "a");
});

test("findAccount: 越界或空数组抛错", () => {
    assert.throws(() => findAccount([], 0), /无可用账号/);
    assert.throws(() => findAccount([{ a: 1 }], 1), /越界/);
});

test("resolvePrefixes: 账号标签优先于默认标签", () => {
    const account = { longLabel: "自定义长", shortLabel: "自短" };
    const defaults = { long: "默认长", short: "默认短" };
    assert.deepEqual(resolvePrefixes(account, defaults), {
        long: "自定义长",
        short: "自短",
    });
});

test("resolvePrefixes: 账号无标签时用默认", () => {
    const defaults = { long: "默认长", short: "默认短" };
    assert.deepEqual(resolvePrefixes({}, defaults), {
        long: "默认长",
        short: "默认短",
    });
    assert.deepEqual(resolvePrefixes(undefined, defaults), {
        long: "默认长",
        short: "默认短",
    });
});

// #endregion 账号匹配 --------------------------------
