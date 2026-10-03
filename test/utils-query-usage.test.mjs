/**
 * @file utils-query-usage 纯函数单元测试
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DISPLAY,
    TYPE,
    KEYS,
    pctColorCode,
    pctSegment,
    bar,
    formatPct,
    toCountdown,
    renderWindows,
    renderErrorLine,
    friendlyError,
    normalizeDisplay,
    normalizeType,
    parseArgs,
    findAccount,
    resolvePrefixes,
    matchAccountByApiKey,
    matchProviderAccount,
    isTransientError,
    toResetSec,
    ensureAnyWindow,
    NO_ACTIVE_PLAN,
    COLORS,
} from "../src/utils/utils-query-usage.mjs";

// #region 渲染 ----------------

/**
 * 临时覆盖 process.stdout.columns（getTermWidth 优先读它），返回恢复函数
 *
 * 真实 TTY 下 process.stdout.columns 有实际值，设 COLUMNS 环境变量不生效，
 * 宽度相关测试会随终端宽度忽绿忽红；显式 stub 可让测试结果可移植
 *
 * @param {number} width 模拟的终端宽度（列数）
 * @returns {() => void} 恢复原状的函数
 */
function stubTermWidth(width) {
    const desc = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    Object.defineProperty(process.stdout, "columns", {
        value: width,
        configurable: true,
    });
    return () => {
        if (desc) {
            Object.defineProperty(process.stdout, "columns", desc);
        } else {
            delete process.stdout.columns;
        }
    };
}

test("formatPct: 中间区间正常四舍五入", () => {
    assert.equal(formatPct(0), 0);
    assert.equal(formatPct(1), 1);
    assert.equal(formatPct(42.4), 42);
    assert.equal(formatPct(42.6), 43);
    assert.equal(formatPct(100), 100);
});

test("formatPct: 上端点保护，未真正用尽不显示 100%", () => {
    assert.equal(formatPct(99.5), 99);
    assert.equal(formatPct(99.7), 99);
    assert.equal(formatPct(99.999), 99);
    assert.equal(formatPct(100.4), 100);
    assert.equal(formatPct(150), 100);
});

test("formatPct: 下端点保护，已开始使用不显示 0%", () => {
    assert.equal(formatPct(0.01), 1);
    assert.equal(formatPct(0.4), 1);
    assert.equal(formatPct(-5), 0);
});

test("formatPct: 脏数据回退为 0，越界钳制，且幂等", () => {
    assert.equal(formatPct(NaN), 0);
    assert.equal(formatPct(undefined), 0);
    assert.equal(formatPct(Infinity), 100);
    assert.equal(formatPct(-Infinity), 0);
    for (const v of [0, 0.3, 42.6, 99.7, 100]) {
        assert.equal(formatPct(formatPct(v)), formatPct(v));
    }
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

test("pctColorCode: 颜色跟随展示值，99.7% 显示 99% 仍为橙", () => {
    assert.equal(pctColorCode(99.7), COLORS.ORANGE);
    assert.equal(pctColorCode(59.6), COLORS.YELLOW);
});

test("pctSegment: 渲染着色百分比，四舍五入到整数", () => {
    const seg = pctSegment(12.6);
    assert.ok(seg.includes("13%"));
});

test("pctSegment: 99.7% 渲染为 99% 而非 100%", () => {
    assert.ok(pctSegment(99.7).includes("99%"));
    assert.ok(pctSegment(100).includes("100%"));
});

/** 去掉 ANSI 颜色码，便于断言条的字符形态 */
const stripAnsi = (s) => s.replace(/\x1b\[[\d;]*m/g, "");

test("bar: 6 格宽，按 1/8 分格填充", () => {
    assert.equal(stripAnsi(bar(0)), "      ");
    assert.equal(stripAnsi(bar(25)), "█▌    "); // 12/48 档 = 1 整格 + 4/8
    assert.equal(stripAnsi(bar(50)), "███   "); // 24/48 档 = 3 整格
    assert.equal(stripAnsi(bar(100)), "██████");
});

test("bar: 端点保护，只有真正未用 / 用尽才全空全满", () => {
    assert.equal(stripAnsi(bar(0.1)), "▏     ");
    assert.equal(stripAnsi(bar(0.4)), "▏     ");
    assert.equal(stripAnsi(bar(99.6)), "█████▉");
    assert.equal(stripAnsi(bar(99.9)), "█████▉");
    assert.equal(stripAnsi(bar(0)), "      ");
    assert.equal(stripAnsi(bar(-5)), "      ");
    assert.equal(stripAnsi(bar(100)), "██████");
    assert.equal(stripAnsi(bar(150)), "██████");
});

test("bar: 脏数据按 0% 处理，不渲染出 undefined", () => {
    for (const v of [NaN, undefined, null, "abc", {}]) {
        assert.equal(stripAnsi(bar(v)), "      ");
    }
});

test("bar: 前景色与百分比数字同色", () => {
    const fgOf = (seq) => seq.match(/\x1b\[([\d;]+)m/)[1];
    for (const p of [0, 0.4, 42.4, 59.6, 60, 79.6, 80, 99.6, 100, 150]) {
        // bar 的 SGR 是「前景;背景」合成，取背景前的部分与数字比
        const barFg = fgOf(bar(p)).split(";48;2;")[0];
        assert.equal(barFg, fgOf(pctSegment(p)), `pct=${p} 条与数字应同色`);
    }
});

test("bar: plain 模式无 ANSI，恒为 6 列", () => {
    assert.equal(bar(50, true), "███···");
    assert.equal(bar(0, true), "······");
    assert.equal(bar(100, true), "██████");
    assert.ok(!bar(50, true).includes("\x1b"));
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

test("toCountdown: NaN / undefined / Infinity 归零，不渲染 NaN分钟", () => {
    assert.equal(toCountdown(NaN, DISPLAY.LONG), "0分钟");
    assert.equal(toCountdown(NaN, DISPLAY.SHORT), "0m");
    assert.equal(toCountdown(undefined, DISPLAY.LONG), "0分钟");
    assert.equal(toCountdown(Infinity, DISPLAY.LONG), "0分钟");
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

test("renderWindows: 窗口数据为 null 显示 标签:--", () => {
    const usage = {
        rolling: null,
        weekly: null,
        monthly: null,
    };
    const out = renderWindows(usage, DISPLAY.SHORT);
    // 标签后跟 ANSI reset 码，去掉后再断言；null 窗口用两个普通连字符
    const plain = out.replace(/\x1b\[[\d;]*m/g, "");
    const dash = "--";
    assert.ok(plain.includes(`五:${dash}`));
    assert.ok(plain.includes(`周:${dash}`));
    assert.ok(plain.includes(`月:${dash}`));
});

test("renderWindows: 秒数无效（null / NaN / 负数）倒计时位显示 --", () => {
    const usage = {
        rolling: { pct: 10, sec: null },
        weekly: { pct: 50, sec: NaN },
        monthly: { pct: 90, sec: -7200 },
    };
    const out = renderWindows(usage, DISPLAY.SHORT);
    const plain = out.replace(/\x1b\[[\d;]*m/g, "");
    // 百分比仍显示，倒计时位统一为 --
    assert.ok(plain.includes(`五:10% ↻ --`));
    assert.ok(plain.includes(`周:50% ↻ --`));
    assert.ok(plain.includes(`月:90% ↻ --`));
});

test("renderWindows: 秒数有效（0 / 数字字符串）正常渲染倒计时", () => {
    const usage = {
        rolling: { pct: 10, sec: 1800 },
        weekly: { pct: 50, sec: "3600" },
        monthly: { pct: 90, sec: 0 },
    };
    const out = renderWindows(usage, DISPLAY.SHORT);
    const plain = out.replace(/\x1b\[[\d;]*m/g, "");
    assert.ok(plain.includes(`五:10% ↻ 30m`));
    assert.ok(plain.includes(`周:50% ↻ 1h`));
    assert.ok(plain.includes(`月:90% ↻ 0m`));
});

test("renderWindows: 数字字符串秒数归一后正常渲染，不误判为缺失", () => {
    const usage = {
        rolling: { pct: 10, sec: "1800" },
        weekly: { pct: 50, sec: 500000 },
        monthly: { pct: 90, sec: "2000000" },
    };
    const out = renderWindows(usage, DISPLAY.SHORT);
    assert.ok(out.includes("30m"));
    assert.ok(!out.includes("--"));
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

test("renderWindows: hideOnMonthlyExhausted 未真正用尽时不隐藏", () => {
    const usage = {
        rolling: { pct: 10, sec: 1800 },
        weekly: { pct: 50, sec: 500000 },
        monthly: { pct: 99.6, sec: 2000000 },
    };
    const out = renderWindows(usage, DISPLAY.SHORT, undefined, true);
    assert.notEqual(out, "");
    assert.ok(out.includes("99%"));
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

test("renderWindows: usage 缺少某窗口键时不输出该窗口", () => {
    const usage = {
        rolling: { pct: 10, sec: 1800 },
        weekly: { pct: 50, sec: 500000 },
        // 不含 monthly -- 平台无此窗口
    };
    const out = renderWindows(usage, DISPLAY.SHORT);
    assert.ok(out.includes("五:"));
    assert.ok(out.includes("周:"));
    assert.ok(!out.includes("月:"));
});

test("renderWindows: note 作为行尾预警输出，不进窗口段", () => {
    const usage = {
        rolling: { pct: 10, sec: 1800 },
        weekly: { pct: 50, sec: 500000 },
        monthly: null,
        note: "月剩余 $5.50，当前为「individual-goat-v2」套餐",
    };
    // 标签后跟 ANSI reset 码，去掉后再断言
    const plain = renderWindows(usage, DISPLAY.SHORT).replace(
        /\x1b\[[\d;]*m/g,
        "",
    );
    assert.ok(plain.includes("⚠ 月剩余 $5.50"), "应输出预警");
    assert.ok(plain.includes("月:--"), "月窗口仍显示横线");
    assert.ok(plain.includes("| ⚠ "), "预警应是独立的 ' | ' 段");
    assert.ok(!plain.includes("月:--⚠"), "预警不应粘在窗口后");
});

test("renderWindows: note 不影响 hideOnMonthlyExhausted 的隐藏", () => {
    const usage = {
        rolling: { pct: 10, sec: 1800 },
        weekly: { pct: 50, sec: 500000 },
        monthly: { pct: 100, sec: 2000000 },
        note: "不该出现",
    };
    assert.equal(renderWindows(usage, DISPLAY.SHORT, null, true), "");
});

test("renderWindows: long 档在百分比前插进度条，short 档不带", () => {
    const usage = {
        rolling: { pct: 50, sec: 1800 },
        weekly: { pct: 100, sec: 500000 },
    };
    const prefixes = { long: "长标签", short: "短" };
    const longOut = stripAnsi(renderWindows(usage, DISPLAY.LONG, prefixes));
    assert.ok(longOut.includes("五小时:███    50%"));
    assert.ok(longOut.includes("每周:██████ 100%"));
    const shortOut = stripAnsi(renderWindows(usage, DISPLAY.SHORT, prefixes));
    assert.ok(shortOut.includes("五:50%"));
    assert.ok(!shortOut.includes("█"));
});

test("renderWindows: 窗口数据为 null 时不画条", () => {
    const out = stripAnsi(renderWindows({ rolling: null }, DISPLAY.LONG));
    assert.ok(out.includes("五小时:--"));
    assert.ok(!out.includes("█"));
});

test("renderWindows: 倒计时位为 -- 时仍带条", () => {
    const out = stripAnsi(
        renderWindows({ rolling: { pct: 50, sec: null } }, DISPLAY.LONG),
    );
    assert.ok(out.includes("五小时:███    50% ↻ --"));
});

test("renderWindows: AUTO 档测宽计入进度条", () => {
    const usage = {
        rolling: { pct: 50, sec: 1800 },
        weekly: { pct: 100, sec: 500000 },
        monthly: { pct: 30, sec: 2000000 },
    };
    const prefixes = { long: "长标签", short: "短" };
    // 90 列放得下无条的 long，放不下带条的 long（带条测宽 96 + 5 间距）
    const restore = stubTermWidth(90);
    try {
        const out = stripAnsi(renderWindows(usage, DISPLAY.AUTO, prefixes));
        assert.ok(out.includes("五:50%"));
        assert.ok(!out.includes("█"));
    } finally {
        restore();
    }
});

test("renderWindows: AUTO 档窄终端回退 SHORT", () => {
    const usage = {
        rolling: { pct: 10, sec: 1800 },
        weekly: { pct: 50, sec: 500000 },
        monthly: { pct: 100, sec: 2000000 },
    };
    const restore = stubTermWidth(20);
    try {
        const out = renderWindows(usage, DISPLAY.AUTO, {
            long: "长标签",
            short: "短",
        });
        // 窄终端应回退 short 档（用 short 前缀）
        assert.ok(out.includes(COLORS.PREFIX + "短"));
    } finally {
        restore();
    }
});

test("renderWindows: AUTO 档宽终端保留 LONG", () => {
    const usage = {
        rolling: { pct: 10, sec: 1800 },
        weekly: { pct: 50, sec: 500000 },
        monthly: { pct: 100, sec: 2000000 },
    };
    const restore = stubTermWidth(200);
    try {
        const out = renderWindows(usage, DISPLAY.AUTO, {
            long: "长标签",
            short: "短",
        });
        // 宽终端应保留 long 档（用 long 前缀 + 长窗口标签）
        assert.ok(out.includes(COLORS.PREFIX + "长标签"));
        assert.ok(out.includes("五小时"));
    } finally {
        restore();
    }
});

/**
 * 模拟终端宽度完全未知（stdout/stderr.columns 均为 0 且无 COLUMNS 环境变量）
 *
 * getTermWidth 优先级为 stdout → stderr → COLUMNS，三处都取不到时返回 0，
 * AUTO 档应回退 SHORT。真实 TTY 下取不到宽度（如管道）即为此场景。
 *
 * @returns {() => void} 恢复原状的函数
 */
function stubNoTermWidth() {
    const restoreOut = stubTermWidth(0);
    const descErr = Object.getOwnPropertyDescriptor(process.stderr, "columns");
    Object.defineProperty(process.stderr, "columns", {
        value: 0,
        configurable: true,
    });
    const prevColumns = process.env.COLUMNS;
    delete process.env.COLUMNS;
    return () => {
        restoreOut();
        if (descErr) {
            Object.defineProperty(process.stderr, "columns", descErr);
        } else {
            delete process.stderr.columns;
        }
        if (prevColumns === undefined) {
            delete process.env.COLUMNS;
        } else {
            process.env.COLUMNS = prevColumns;
        }
    };
}

test("renderWindows: AUTO 档终端宽度未知（0）时回退 SHORT", () => {
    const usage = {
        rolling: { pct: 10, sec: 1800 },
        weekly: { pct: 50, sec: 500000 },
        monthly: { pct: 100, sec: 2000000 },
    };
    const restore = stubNoTermWidth();
    try {
        const out = renderWindows(usage, DISPLAY.AUTO, {
            long: "长标签",
            short: "短",
        });
        // 宽度未知时不测宽，直接回退 short 档（用 short 前缀 + 短窗口标签）
        assert.ok(out.includes(COLORS.PREFIX + "短"));
        assert.ok(!out.includes("五小时"));
    } finally {
        restore();
    }
});

test("renderErrorLine: 格式为 前缀 | ❌ 消息", () => {
    const out = renderErrorLine(
        { long: "火山Coding", short: "Coding" },
        DISPLAY.LONG,
        "测试错误",
    );
    assert.ok(out.includes(COLORS.PREFIX + "火山Coding"));
    assert.ok(out.includes("❌ 测试错误"));
});

test("renderErrorLine: short 档用 short 标签", () => {
    const out = renderErrorLine(
        { long: "火山Coding", short: "Coding" },
        DISPLAY.SHORT,
        "err",
    );
    assert.ok(out.includes(COLORS.PREFIX + "Coding"));
});

test("friendlyError: timeout 错误转中文提示", () => {
    // AbortSignal.timeout 超时抛 DOMException name=TimeoutError
    assert.equal(
        friendlyError({
            name: "TimeoutError",
            message: "The operation was aborted due to timeout",
        }),
        "请求超时（超过 10s），请稍后重试",
    );
});

test("friendlyError: message 含 timeout 但非 TimeoutError 原样透传（不误判）", () => {
    // 上游业务错误消息里恰好含 "timeout" 字样，不应被误判为客户端请求超时
    assert.equal(
        friendlyError(new Error("RequestTimeout: upstream busy")),
        "RequestTimeout: upstream busy",
    );
});

test("friendlyError: 普通错误原样透传", () => {
    assert.equal(friendlyError(new Error("cookie 已过期")), "cookie 已过期");
    assert.equal(friendlyError({ message: "配置错误" }), "配置错误");
});

test("friendlyError: 非 Error 输入兜底转字符串", () => {
    assert.equal(friendlyError("原始字符串"), "原始字符串");
    assert.equal(friendlyError(undefined), "undefined");
    assert.equal(friendlyError(null), "null");
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

test("normalizeDisplay: 非字符串值（undefined/null/数字）不抛 TypeError", () => {
    assert.throws(() => normalizeDisplay(undefined));
    assert.throws(() => normalizeDisplay(null));
    assert.throws(() => normalizeDisplay(42));
    assert.equal(
        normalizeDisplay(undefined, { fallback: DISPLAY.AUTO }),
        DISPLAY.AUTO,
    );
});

test("normalizeType: 支持缩写和全称", () => {
    assert.equal(normalizeType("c"), TYPE.CODING);
    assert.equal(normalizeType("a"), TYPE.AGENT);
    assert.equal(normalizeType("coding"), TYPE.CODING);
    assert.equal(normalizeType("agent"), TYPE.AGENT);
    // 大小写不敏感：配置写 "Agent"/"CODING" 也能归一（ark 账号 type 不再静默回退 coding）
    assert.equal(normalizeType("Agent"), TYPE.AGENT);
    assert.equal(normalizeType("CODING"), TYPE.CODING);
});

test("normalizeType: 非法值抛错，提供 fallback 时回退", () => {
    assert.throws(() => normalizeType("xyz"));
    assert.equal(normalizeType("xyz", { fallback: TYPE.CODING }), TYPE.CODING);
});

test("normalizeType: 非字符串值（undefined/null/数字）不抛 TypeError", () => {
    assert.throws(() => normalizeType(undefined));
    assert.throws(() => normalizeType(null));
    assert.throws(() => normalizeType(42));
    assert.equal(
        normalizeType(undefined, { fallback: TYPE.CODING }),
        TYPE.CODING,
    );
});

test("parseArgs: 全默认值（type 为 undefined，由调用方回退）", () => {
    const parsed = parseArgs(["node", "script.mjs"]);
    assert.equal(parsed.display, DISPLAY.AUTO);
    assert.equal(parsed.type, undefined);
    assert.equal(parsed.position, 0);
    assert.equal(parsed.hideOnMonthlyExhausted, false);
    assert.equal(parsed.hideOnNoActivePlan, false);
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
        "--hide-on-no-active-plan",
        "true",
    ]);
    assert.equal(parsed.type, TYPE.AGENT);
    assert.equal(parsed.display, DISPLAY.SHORT);
    assert.equal(parsed.position, 2);
    assert.equal(parsed.hideOnMonthlyExhausted, true);
    assert.equal(parsed.hideOnNoActivePlan, true);
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

test("parseArgs: hide 参数大小写不敏感", () => {
    const parsed = parseArgs([
        "node",
        "script.mjs",
        "--hide-on-monthly-exhausted",
        "TRUE",
        "--hide-on-no-active-plan",
        "True",
    ]);
    assert.equal(parsed.hideOnMonthlyExhausted, true);
    assert.equal(parsed.hideOnNoActivePlan, true);
    // 非 true 语义的值仍为 false
    const parsed2 = parseArgs([
        "node",
        "script.mjs",
        "--hide-on-monthly-exhausted",
        "yes",
    ]);
    assert.equal(parsed2.hideOnMonthlyExhausted, false);
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

/**
 * 构造 config 对象
 *
 * @param {object} byKey 各 key 的账号数组
 * @returns {object}
 */
function cfg(byKey) {
    return { [KEYS.ARK]: byKey.ark, [KEYS.OLLAMA]: byKey.ollama, [KEYS.OPENCODE]: byKey.opencode, [KEYS.QWEN]: byKey.qwen };
}

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

test("matchAccountByApiKey: 命中 ark 第一个账号", () => {
    const c = cfg({
        ark: [
            { apiKey: "sk-ark-1", accessKeyId: "a1" },
            { apiKey: "sk-ark-2", accessKeyId: "a2" },
        ],
    });
    const m = matchAccountByApiKey(c, "sk-ark-1");
    assert.deepEqual(m, { key: KEYS.ARK, index: 0, account: c.ark[0] });
});

test("matchAccountByApiKey: 同 key 多账号命中正确 index", () => {
    const c = cfg({
        ark: [{ apiKey: "sk-ark-1" }, { apiKey: "sk-ark-2" }],
    });
    const m = matchAccountByApiKey(c, "sk-ark-2");
    assert.equal(m.index, 1);
    assert.equal(m.account.apiKey, "sk-ark-2");
});

test("matchAccountByApiKey: 命中靠后的 key（qwen）", () => {
    const c = cfg({
        ark: [{ apiKey: "sk-ark-1" }],
        qwen: [{ apiKey: "sk-qwen-1", cookie: "c" }],
    });
    const m = matchAccountByApiKey(c, "sk-qwen-1");
    assert.equal(m.key, KEYS.QWEN);
    assert.equal(m.index, 0);
});

test("matchAccountByApiKey: 按 key 顺序取第一个命中（ark 优先于 qwen）", () => {
    // 两个 key 都有相同 apiKey，应返回顺序在前的 ark
    const c = cfg({
        ark: [{ apiKey: "same-key" }],
        qwen: [{ apiKey: "same-key" }],
    });
    const m = matchAccountByApiKey(c, "same-key");
    assert.equal(m.key, KEYS.ARK);
});

test("matchAccountByApiKey: 未匹配返回 null", () => {
    const c = cfg({ ark: [{ apiKey: "sk-ark-1" }] });
    assert.equal(matchAccountByApiKey(c, "not-exist"), null);
});

test("matchAccountByApiKey: apiKey 为空/null/undefined 返回 null", () => {
    const c = cfg({ ark: [{ apiKey: "sk-ark-1" }] });
    assert.equal(matchAccountByApiKey(c, ""), null);
    assert.equal(matchAccountByApiKey(c, null), null);
    assert.equal(matchAccountByApiKey(c, undefined), null);
});

test("matchAccountByApiKey: 账号 apiKey 为空字符串的条目不被匹配", () => {
    // 即使传入空串，也不应匹配到 apiKey 为空的账号（a.apiKey falsy 短路）
    const c = cfg({ ark: [{ apiKey: "" }, { apiKey: "sk-ark-2" }] });
    assert.equal(matchAccountByApiKey(c, ""), null);
    // 但能匹配到第二个
    assert.equal(matchAccountByApiKey(c, "sk-ark-2").index, 1);
});

test("matchAccountByApiKey: 某 key 不是数组（undefined）时跳过不报错", () => {
    const c = cfg({ qwen: [{ apiKey: "sk-qwen-1" }] });
    // ark/ollama/opencode 均为 undefined
    const m = matchAccountByApiKey(c, "sk-qwen-1");
    assert.equal(m.key, KEYS.QWEN);
});

test("matchAccountByApiKey: 空配置返回 null", () => {
    assert.equal(matchAccountByApiKey({}, "sk-any"), null);
});

test("matchAccountByApiKey: 账号对象为 null 的槽位被跳过", () => {
    const c = cfg({ ark: [null, { apiKey: "sk-ark-2" }] });
    const m = matchAccountByApiKey(c, "sk-ark-2");
    assert.equal(m.index, 1);
});

// #region matchProviderAccount ----------------

test("matchProviderAccount: 正常匹配当前供应商 key 返回账号", async () => {
    // 环境变量 key 优先于 db（见 utils-cc-switch getAPIKey）
    const prev = process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_AUTH_TOKEN = "sk-match";
    try {
        const m = await matchProviderAccount({
            qwen: [{ apiKey: "sk-match", shortLabel: "千问" }],
        });
        assert.ok(m);
        assert.equal(m.key, KEYS.QWEN);
        assert.equal(m.index, 0);
        assert.equal(m.account.shortLabel, "千问");
    } finally {
        if (prev === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
        else process.env.ANTHROPIC_AUTH_TOKEN = prev;
    }
});

test("matchProviderAccount: 匹配不到返回 null", async () => {
    const prev = process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_AUTH_TOKEN = "sk-nomatch";
    try {
        const m = await matchProviderAccount({
            qwen: [{ apiKey: "sk-other" }],
        });
        assert.equal(m, null);
    } finally {
        if (prev === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
        else process.env.ANTHROPIC_AUTH_TOKEN = prev;
    }
});

test("matchProviderAccount: getAPIKey 抛错（settings 缺失）时异常冒泡", async () => {
    // 真实配置故障（CC-Switch 配置损坏 / db 不可读 / 供应商未配 key）不应静默降级为
    // 查全部账号，需冒泡由 smart 的 main().catch 打印 ❌ 诊断；免费路径已由 isFreeModel 先判
    const prevAuth = process.env.ANTHROPIC_AUTH_TOKEN;
    const prevSettings = process.env.CC_SWITCH_SETTINGS_PATH;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.CC_SWITCH_SETTINGS_PATH = "__nonexistent_settings__";
    try {
        await assert.rejects(
            matchProviderAccount({ qwen: [{ apiKey: "x" }] }),
            (err) => err instanceof Error,
        );
    } finally {
        if (prevAuth === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
        else process.env.ANTHROPIC_AUTH_TOKEN = prevAuth;
        if (prevSettings === undefined) delete process.env.CC_SWITCH_SETTINGS_PATH;
        else process.env.CC_SWITCH_SETTINGS_PATH = prevSettings;
    }
});

// #endregion matchProviderAccount ----------------

// #endregion 账号匹配 --------------------------------

// #region isTransientError ----------------

test("isTransientError: 超时视为瞬时故障（写负缓存）", () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    assert.equal(isTransientError(err), true);
});

test("isTransientError: 5xx 等未知网络错误视为瞬时故障", () => {
    assert.equal(isTransientError(new Error("请求失败(HTTP 500)")), true);
    assert.equal(isTransientError(new Error("fetch failed")), true);
});

test("isTransientError: 无活跃套餐 / apiKey 无效不是瞬时故障", () => {
    // 都要用户改配置/订阅才解：写负缓存会让修好后仍被旧错误挡满 30s
    assert.equal(isTransientError(new Error(NO_ACTIVE_PLAN)), false);
    assert.equal(isTransientError(new Error("apiKey 无效")), false);
    assert.equal(isTransientError(new Error("apiKey 无效(重定向到 ...)")), false);
});

test("isTransientError: cookie 失效/过期不是瞬时故障", () => {
    // 需用户重新登录才解，写负缓存会让用户重登后 30s 内仍看到旧「cookie 失效」
    assert.equal(isTransientError(new Error("cookie 失效，请运行 login-qwen.cmd 重新登录")), false);
    assert.equal(isTransientError(new Error("cookie 已过期或无效(重定向到 https://ollama.com/login)")), false);
});

// #endregion isTransientError ----------------

// #region ensureAnyWindow ----------------

test("ensureAnyWindow: 三窗口全空且无 note 抛响应结构异常", () => {
    assert.throws(
        () => ensureAnyWindow({ rolling: null, weekly: null, monthly: null, note: null }),
        /响应结构异常/,
    );
});

test("ensureAnyWindow: 三窗口全空但有降级 note 不抛（保留诊断说明）", () => {
    // commandcode 命中未知 planId 时只能给出 note，不应被当成结构异常吞掉
    const usage = { rolling: null, weekly: null, monthly: null, note: "月剩余 $5.50，当前为「x」套餐" };
    assert.doesNotThrow(() => ensureAnyWindow(usage));
});

// #endregion ensureAnyWindow ----------------

// #region toResetSec ----------------

const NOW_MS = 1784800000000;

test("toResetSec: 毫秒时间戳 → 秒倒计时", () => {
    assert.equal(toResetSec(NOW_MS + 3600e3, NOW_MS), 3600);
    assert.equal(toResetSec(NOW_MS, NOW_MS), 0);
});

test("toResetSec: 数字字符串可用（上游偶发序列化成字符串）", () => {
    assert.equal(toResetSec(String(NOW_MS + 60e3), NOW_MS), 60);
});

test("toResetSec: 缺失/非数字/非正值 → null，不当成 1970 年", () => {
    // 上游对「无重置时间」有 null / undefined / 空串 / 0 多种形态：
    // 按 1970 年算会得出巨大负倒计时，并让 ollama 的文本时长回退分支失效
    for (const ts of [null, undefined, "", 0, -1, "not-a-time", NaN, Infinity]) {
        assert.equal(toResetSec(ts, NOW_MS), null, `ts=${String(ts)}`);
    }
});

test("toResetSec: 过去时间戳给负数，不钳 0", () => {
    assert.equal(toResetSec(NOW_MS - 60e3, NOW_MS), -60);
});

// #endregion toResetSec ----------------
