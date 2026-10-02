/**
 * @file ollama HTML 解析单元测试
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseUsageWindows,
    parseDurationString,
    parsePlanType,
    queryUsage,
} from "../src/query/query-usage-ollama.mjs";
import { makeResp, withFetch } from "./fetch-stub.mjs";

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
 * 构造模拟 ollama.com/settings 的 SSR HTML 片段（local-time 在各自窗口块内）
 *
 * @param {object} opts
 * @param {{pct: number, reset: string, time?: string} | null} [opts.session] session 窗口；time 为块内 local-time 的 data-time
 * @param {{pct: number, reset: string, time?: string} | null} [opts.weekly] weekly 窗口；time 为块内 local-time 的 data-time
 * @returns {string}
 */
function makeHtml({ session, weekly }) {
    const block = (title, data) => {
        if (!data) {
            return "";
        }
        // 贴近真实结构：窗口标题 + 用量百分比 + 块内 local-time div（data-time 为 ISO 时间戳）
        const timeAttr = data.time ? ` data-time="${data.time}"` : "";
        return (
            `<div><h2>${title}</h2><p>${data.pct}% used</p>` +
            `<div class="text-xs text-neutral-500 mt-1 local-time"${timeAttr}>` +
            `Resets in ${data.reset}.</div></div>`
        );
    };
    return (
        `<html><body>${block("Session usage", session)}` +
        `${block("Weekly usage", weekly)}</body></html>`
    );
}

test("parseUsageWindows: 两窗口齐全，data-time 优先于文本时长", () => {
    const now = Date.parse("2026-07-27T10:00:00Z");
    const html = makeHtml({
        session: { pct: 12.5, reset: "4 hours", time: "2026-07-27T14:00:00Z" },
        weekly: { pct: 45, reset: "6 days", time: "2026-08-02T10:00:00Z" },
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

test("parseUsageWindows: reset 文本无法识别时 sec 为 null（↻ --）", () => {
    // 无 data-time 且 "Resets in" 后是无法识别的文本（如本地化/模糊措辞）：
    // parseDurationString 返回 0 视为无效，归 null，不再误显「0 分钟」
    const html = makeHtml({
        session: { pct: 30, reset: "a while" },
    });
    const usage = parseUsageWindows(html, Date.now());
    assert.equal(usage.rolling.pct, 30);
    assert.equal(usage.rolling.sec, null);
});

test("parseUsageWindows: data-time 非法时回退到文本时长", () => {
    const html = makeHtml({
        session: { pct: 10, reset: "4 hours", time: "not-a-date" },
    });
    const usage = parseUsageWindows(html, Date.now());
    assert.equal(usage.rolling.sec, 4 * 3600);
});

test("parseUsageWindows: data-time 已过期 sec 为负数，不钳 0", () => {
    const now = Date.parse("2026-07-27T10:00:00Z");
    const html = makeHtml({
        session: { pct: 10, reset: "4 hours", time: "2026-07-27T08:00:00Z" }, // 2h 前
    });
    const usage = parseUsageWindows(html, now);
    // 原样透传负数，由 renderWindows 显示 ↻ --
    assert.equal(usage.rolling.sec, -2 * 3600);
});

test("parseUsageWindows: 只有 session 时 weekly 为 null", () => {
    const html = makeHtml({
        session: { pct: 10, reset: "1 hour" },
    });
    const usage = parseUsageWindows(html, Date.now());
    assert.ok(usage.rolling);
    assert.equal(usage.weekly, null);
});

test("parseUsageWindows: 窗口区间外的其他 local-time 不干扰关联", () => {
    const now = Date.parse("2026-07-27T10:00:00Z");
    // 窗口块前插入干扰 local-time（模拟注册时间等），不应影响各窗口取自己块内的 data-time
    const html =
        `<html><body>` +
        `<div class="text-xs text-neutral-500 mt-1 local-time" ` +
        `data-time="2026-07-01T00:00:00Z">Account created</div>` +
        makeHtml({
            session: {
                pct: 12.5,
                reset: "4 hours",
                time: "2026-07-27T14:00:00Z",
            },
            weekly: {
                pct: 45,
                reset: "6 days",
                time: "2026-08-02T10:00:00Z",
            },
        }) +
        `</body></html>`;
    const usage = parseUsageWindows(html, now);
    assert.equal(usage.rolling.sec, 4 * 3600);
    assert.equal(usage.weekly.sec, 6 * 86400);
});

test("parseUsageWindows: 重置文本措辞变化不影响百分比解析（解耦）", () => {
    // "Resets in" 被改成别的措辞（模拟上游改版）：百分比仍应解析出，倒计时仍来自 data-time
    const html =
        `<html><body>` +
        `<div><h2>Session usage</h2><p>12.5% used</p>` +
        `<div class="text-xs text-neutral-500 mt-1 local-time" ` +
        `data-time="2026-07-27T14:00:00Z">Next reset at 14:00</div>` +
        `</div></body></html>`;
    const now = Date.parse("2026-07-27T10:00:00Z");
    const usage = parseUsageWindows(html, now);
    assert.equal(usage.rolling.pct, 12.5);
    assert.equal(usage.rolling.sec, 4 * 3600);
});

test("parseUsageWindows: 无用量数据时两窗口均 null", () => {
    const html = "<html><body>no usage data</body></html>";
    const usage = parseUsageWindows(html, Date.now());
    assert.equal(usage.rolling, null);
    assert.equal(usage.weekly, null);
});

test("parseUsageWindows: 标题大小写变体仍能解析", () => {
    // 标题定位用大小写不敏感搜索（与正则 /i 一致），避免 "SESSION USAGE" 等变体整窗丢数据
    const now = Date.parse("2026-07-27T10:00:00Z");
    const html = makeHtml({
        session: { pct: 12.5, reset: "4 hours", time: "2026-07-27T14:00:00Z" },
    }).replace("Session usage", "SESSION USAGE");
    const usage = parseUsageWindows(html, now);
    assert.equal(usage.rolling.pct, 12.5);
    assert.equal(usage.rolling.sec, 4 * 3600);
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

// #region queryUsage 请求层 ----------------

test("queryUsage: free 套餐判定无活跃套餐而非结构异常", async () => {
    // 套餐类型为 free（未订阅/已过期降级）时必须走 NO_ACTIVE_PLAN：这条分支
    // 依赖 utils 的 NO_ACTIVE_PLAN，一旦漏 import 就是 ReferenceError 而非友好提示
    const html =
        makePlanHtml("free") +
        `<div><h2>Session usage</h2><p>10% used</p>` +
        `<div class="local-time" data-time="2026-08-13T00:00:00Z">Resets in 6 days</div></div>`;
    const out = await withFetch(
        makeResp({ status: 200, body: html }),
        () =>
            queryUsage({
                position: 0,
                cache: false,
                _config: { ollama: [{ cookie: "test" }] },
            }),
    );
    assert.ok(out.includes("无活跃套餐"), "应判定无活跃套餐");
    assert.ok(out.includes("free"), "应带上当前套餐类型");
    assert.ok(!out.includes("is not defined"), "不应是 ReferenceError");
});

// #endregion queryUsage 请求层 --------------------------------
