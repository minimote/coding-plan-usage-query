/**
 * @file Command Code GOAT 响应解析器单元测试
 *
 * parseUsageResponse 纯解析 + queryUsage 请求层错误分支
 * （通过 stub globalThis.fetch 返回固定响应，不依赖真实网络）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseUsageResponse,
    queryUsage,
} from "../src/query/query-usage-commandcode.mjs";

/** 实测返回结构的同构样本（GOAT：月上限 $70，5h $14，周 $35） */
const CREDITS = {
    credits: {
        belowThreshold: false,
        creditThreshold: 0,
        monthlyCredits: 69.7985699445,
        purchasedCredits: 0,
        freeCredits: 0,
    },
    windowLimits: {
        limited: true,
        exceeded: null,
        fiveHour: { used: 0.2014300555, cap: 14, exceeded: false, resetAt: 1788277141327 },
        weekly: { used: 0.2014300555, cap: 35, exceeded: false, resetAt: 1788863941327 },
    },
};

const SUBS = {
    success: true,
    data: {
        id: "sub_xxx",
        status: "active",
        planId: "individual-goat",
        currentPeriodStart: "2026-09-01T10:04:09.000Z",
        currentPeriodEnd: "2026-10-01T10:04:09.000Z",
    },
};

const NOW = 1788273600000; // 固定 now 保证倒计时断言确定

test("parseUsageResponse: 三窗口完整解析", () => {
    const usage = parseUsageResponse(CREDITS, SUBS, NOW);
    // 5h: 0.2014300555 / 14
    assert.ok(Math.abs(usage.rolling.pct - 1.438786) < 1e-4);
    assert.equal(usage.rolling.sec, Math.round((1788277141327 - NOW) / 1000));
    // 周: 0.2014300555 / 35
    assert.ok(Math.abs(usage.weekly.pct - 0.575516) < 1e-4);
    assert.equal(usage.weekly.sec, Math.round((1788863941327 - NOW) / 1000));
    // 月: (70 - 69.7985699445) / 70
    assert.ok(Math.abs(usage.monthly.pct - 0.287757) < 1e-4);
    assert.equal(
        usage.monthly.sec,
        Math.round((new Date("2026-10-01T10:04:09.000Z").getTime() - NOW) / 1000),
    );
});

test("parseUsageResponse: monthlyCredits 是月剩余而非月上限", () => {
    // 若误把 monthlyCredits 当上限，monthly.pct 会是 (69.8-69.8)/69.8 = 0 而非 0.29%
    const usage = parseUsageResponse(CREDITS, SUBS, NOW);
    assert.ok(usage.monthly.pct > 0);
});

test("parseUsageResponse: 非 GOAT 套餐按表换算月上限", () => {
    const subs = { data: { planId: "individual-go", currentPeriodEnd: "2026-10-01T00:00:00.000Z" } };
    const credits = { credits: { monthlyCredits: 9.5 }, windowLimits: {} };
    const usage = parseUsageResponse(credits, subs, NOW);
    assert.ok(Math.abs(usage.monthly.pct - 5) < 1e-9); // (10-9.5)/10
});

test("parseUsageResponse: monthlyCredits 为 null/\"\"/false 时 monthly 为 null，不误显 100%", () => {
    // 后端对无月度额度的套餐可能返回 monthlyCredits: null；Number(null)===0，
    // 若误用 Number() 强转会把「无额度」算成「已用尽 100%」，开启 hideOnMonthlyExhausted 时还会隐藏整行
    for (const bad of [null, "", false, undefined]) {
        const credits = { credits: { monthlyCredits: bad }, windowLimits: {} };
        const usage = parseUsageResponse(credits, SUBS, NOW);
        assert.equal(usage.monthly, null, `monthlyCredits=${JSON.stringify(bad)}`);
    }
});

test("parseUsageResponse: window used 为 null/\"\"/false 时窗口为 null，不误显 0%", () => {
    // cap 合法但 used 缺失时，窗口应丢弃（显示 --）而非显示 0%（未使用）
    for (const bad of [null, "", false, undefined]) {
        const credits = {
            windowLimits: { fiveHour: { cap: 14, used: bad, resetAt: 1 } },
        };
        const usage = parseUsageResponse(credits, SUBS, NOW);
        assert.equal(usage.rolling, null, `used=${JSON.stringify(bad)}`);
    }
});

test("parseUsageResponse: planId 不在表中时 monthly 为 null，窗口不受影响", () => {
    const subs = { data: { planId: "individual-unknown" } };
    const usage = parseUsageResponse(CREDITS, subs, NOW);
    assert.equal(usage.monthly, null);
    assert.ok(usage.rolling);
    assert.ok(usage.weekly);
});

test("parseUsageResponse: 缺 subscriptions 时 monthly 为 null", () => {
    const usage = parseUsageResponse(CREDITS, {}, NOW);
    assert.equal(usage.monthly, null);
});

test("parseUsageResponse: 缺 windowLimits 时窗口为 null", () => {
    const usage = parseUsageResponse({ credits: { monthlyCredits: 70 } }, SUBS, NOW);
    assert.equal(usage.rolling, null);
    assert.equal(usage.weekly, null);
    assert.ok(usage.monthly);
});

test("parseUsageResponse: cap 非法（0/负数/非数字）的窗口为 null", () => {
    const credits = {
        windowLimits: {
            fiveHour: { used: 1, cap: 0, resetAt: 1 },
            weekly: { used: 1, cap: -5, resetAt: 1 },
        },
    };
    const usage = parseUsageResponse(credits, SUBS, NOW);
    assert.equal(usage.rolling, null);
    assert.equal(usage.weekly, null);
});

test("parseUsageResponse: resetAt 缺失或已过 → sec null/负数原样透传", () => {
    const credits = {
        windowLimits: {
            fiveHour: { used: 1, cap: 14 },
            weekly: { used: 1, cap: 35, resetAt: 1000 },
        },
    };
    const usage = parseUsageResponse(credits, SUBS, NOW);
    assert.equal(usage.rolling.sec, null);
    assert.equal(usage.weekly.sec, Math.round((1000 - NOW) / 1000));
});

// #region queryUsage 请求层错误分支 ----------------

/** 构造 JSON fetch Response 的最小 stub */
function makeJsonResp(body, status = 200) {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

/** 按请求 URL 分发固定 Response stub fetch，结束后还原 */
async function withFetch(handler, fn) {
    const orig = globalThis.fetch;
    globalThis.fetch = async (url) => handler(String(url));
    try {
        return await fn();
    } finally {
        globalThis.fetch = orig;
    }
}

test("queryUsage: 正常返回渲染三窗口", async () => {
    const out = await withFetch(
        (url) =>
            makeJsonResp(url.includes("/alpha/billing/credits") ? CREDITS : SUBS),
        () =>
            queryUsage({
                position: 0,
                cache: false,
                _config: { commandcode: [{ apiKey: "test" }] },
            }),
    );
    assert.ok(out.includes("五:"), "应包含 5h 窗口");
    assert.ok(out.includes("周:"), "应包含周窗口");
    assert.ok(out.includes("月:"), "应包含月窗口");
});

test("queryUsage: 401/403 → 显示无活跃套餐", async () => {
    const out = await withFetch(
        () => makeJsonResp({}, 401),
        () =>
            queryUsage({
                position: 0,
                cache: false,
                _config: { commandcode: [{ apiKey: "bad" }] },
            }),
    );
    assert.ok(out.includes("无活跃套餐"));
});

test("queryUsage: 500 → 显示 HTTP 错误", async () => {
    const out = await withFetch(
        () => makeJsonResp({}, 500),
        () =>
            queryUsage({
                position: 0,
                cache: false,
                _config: { commandcode: [{ apiKey: "test" }] },
            }),
    );
    assert.ok(out.includes("HTTP 500"));
});

test("queryUsage: 三窗口全解析失败 → 显示结构异常", async () => {
    const out = await withFetch(
        () => makeJsonResp({}),
        () =>
            queryUsage({
                position: 0,
                cache: false,
                _config: { commandcode: [{ apiKey: "test" }] },
            }),
    );
    assert.ok(out.includes("响应结构异常"));
});

// #endregion queryUsage 请求层错误分支 --------------------------------
