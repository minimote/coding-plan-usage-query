/**
 * @file ollama HTML 解析单元测试
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseUsageWindows,
    parseDurationString,
    parsePlanType,
} from "../src/query/query-usage-ollama.mjs";

// #region parseDurationString ----------------

test("parseDurationString: 单单位解析（day/hour/minute/second）", () => {
    assert.equal(parseDurationString("4 hours"), 4 * 3600);
    assert.equal(parseDurationString("6 days"), 6 * 86400);
    assert.equal(parseDurationString("30 minutes"), 30 * 60);
    assert.equal(parseDurationString("5 seconds"), 5);
});

test("parseDurationString: 复合单位累加", () => {
    assert.equal(
        parseDurationString("3 hours 12 minutes"),
        3 * 3600 + 12 * 60,
    );
    assert.equal(
        parseDurationString("2 days 1 hour 30 minutes"),
        2 * 86400 + 3600 + 30 * 60,
    );
});

test("parseDurationString: 带句点、单数形式、大小写不敏感", () => {
    assert.equal(parseDurationString("4 hours."), 4 * 3600);
    assert.equal(parseDurationString("1 hour"), 3600);
    assert.equal(parseDurationString("1 DAY"), 86400);
});

test("parseDurationString: 无法识别返回 0", () => {
    assert.equal(parseDurationString(""), 0);
    assert.equal(parseDurationString("unknown"), 0);
});

// #endregion parseDurationString --------------------------------

// #region parseUsageWindows ----------------

/**
 * 构造模拟 ollama.com/settings 的 SSR HTML 片段
 *
 * @param {object} opts
 * @param {{pct: number, reset: string} | null} [opts.session]
 * @param {{pct: number, reset: string} | null} [opts.weekly]
 * @param {string[]} [opts.resetTimes] local-time 元素的 data-time ISO 时间戳，按 session/weekly 顺序
 * @returns {string}
 */
function makeHtml({ session, weekly, resetTimes = [] }) {
    const blocks = [];
    if (session) {
        blocks.push(
            `<section><h2>Session usage</h2><p>${session.pct}% used</p><p>Resets in ${session.reset}.</p></section>`,
        );
    }
    if (weekly) {
        blocks.push(
            `<section><h2>Weekly usage</h2><p>${weekly.pct}% used</p><p>Resets in ${weekly.reset}.</p></section>`,
        );
    }
    const timeEls = resetTimes
        .map((t) => `<time class="local-time" data-time="${t}">x</time>`)
        .join("");
    return `<html><body>${blocks.join("")}${timeEls}</body></html>`;
}

test("parseUsageWindows: 两窗口齐全，data-time 优先于文本时长", () => {
    const now = Date.parse("2026-07-27T10:00:00Z");
    const html = makeHtml({
        session: { pct: 12.5, reset: "4 hours" },
        weekly: { pct: 45, reset: "6 days" },
        resetTimes: [
            "2026-07-27T14:00:00Z", // session 4h 后
            "2026-08-02T10:00:00Z", // weekly 6d 后
        ],
    });
    const usage = parseUsageWindows(html, now);
    assert.equal(usage.rolling.pct, 12.5);
    assert.equal(usage.rolling.sec, 4 * 3600);
    assert.equal(usage.weekly.pct, 45);
    assert.equal(usage.weekly.sec, 6 * 86400);
    // ollama 无月度窗口，不应凭空造出 monthly 键
    assert.equal("monthly" in usage, false);
});

test("parseUsageWindows: 无 data-time 时回退到文本时长解析", () => {
    const html = makeHtml({
        session: { pct: 30, reset: "3 hours 12 minutes" },
        weekly: { pct: 60, reset: "2 days" },
    });
    const usage = parseUsageWindows(html, Date.now());
    assert.equal(usage.rolling.sec, 3 * 3600 + 12 * 60);
    assert.equal(usage.weekly.sec, 2 * 86400);
});

test("parseUsageWindows: data-time 非法时回退到文本时长", () => {
    const html = makeHtml({
        session: { pct: 10, reset: "4 hours" },
        resetTimes: ["not-a-date"],
    });
    const usage = parseUsageWindows(html, Date.now());
    assert.equal(usage.rolling.sec, 4 * 3600);
});

test("parseUsageWindows: data-time 已过期 sec 钳制为 0", () => {
    const now = Date.parse("2026-07-27T10:00:00Z");
    const html = makeHtml({
        session: { pct: 10, reset: "4 hours" },
        resetTimes: ["2026-07-27T08:00:00Z"], // 2h 前
    });
    const usage = parseUsageWindows(html, now);
    assert.equal(usage.rolling.sec, 0);
});

test("parseUsageWindows: 只有 session 时 weekly 为 null", () => {
    const html = makeHtml({
        session: { pct: 10, reset: "1 hour" },
    });
    const usage = parseUsageWindows(html, Date.now());
    assert.ok(usage.rolling);
    assert.equal(usage.weekly, null);
});

test("parseUsageWindows: 无用量数据时两窗口均 null", () => {
    const html = "<html><body>no usage data</body></html>";
    const usage = parseUsageWindows(html, Date.now());
    assert.equal(usage.rolling, null);
    assert.equal(usage.weekly, null);
});

// #endregion parseUsageWindows --------------------------------

// #region parsePlanType ----------------

/**
 * 构造 Cloud usage 标题 + 套餐类型 span 的 HTML 片段
 *
 * 真实页面：h2 内紧邻 "Cloud usage" span 后跟带 capitalize class 的套餐类型 span
 */
function makePlanHtml(plan) {
    return (
        `<h2 class="text-xl font-medium flex items-center space-x-2">` +
        `<span>Cloud usage</span>` +
        `<span class="text-xs font-normal px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 capitalize">${plan}</span>` +
        `</h2>`
    );
}

test("parsePlanType: pro 账号返回 pro", () => {
    assert.equal(parsePlanType(makePlanHtml("pro")), "pro");
});

test("parsePlanType: free 账号返回 free", () => {
    assert.equal(parsePlanType(makePlanHtml("free")), "free");
});

test("parsePlanType: 文本带空格/大写 → trim 后小写", () => {
    assert.equal(parsePlanType(makePlanHtml("  Free  ")), "free");
});

test("parsePlanType: 无 capitalize span 返回 null", () => {
    assert.equal(parsePlanType("<h2><span>Cloud usage</span></h2>"), null);
});

test("parsePlanType: 无 Cloud usage 区块返回 null", () => {
    assert.equal(parsePlanType("<html>no usage here</html>"), null);
});

// #endregion parsePlanType --------------------------------
