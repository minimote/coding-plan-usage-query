/**
 * @file opencode Go 用量接口解析单元测试
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseUsageResponse,
    queryUsage,
} from "../src/query/query-usage-opencode-go.mjs";
import {
    makeResp,
    withFetch,
} from "./fetch-stub.mjs";

/** ISO 字符串按固定 now 构造，保证倒计时断言稳定 */
const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const iso = (msFromNow) =>
    new Date(NOW + msFromNow).toISOString();

/**
 * 构造一段模拟 /zen/go/v1/usage 的响应体
 *
 * 真实响应形如 usage:{rolling:{status,percent,resetsAt},weekly:{...},monthly:{...}}
 * 本测试构造同构对象验证解析逻辑
 */
function makePayload(windows) {
    const usage = {};
    windows.forEach(([name, pct, resetsAt]) => {
        usage[name] = { status: "ok", percent: pct, resetsAt };
    });
    return { usage };
}

test("parseUsageResponse: 解析三窗口百分比与倒计时", () => {
    const usage = parseUsageResponse(
        makePayload([
            ["rolling", 12.5, iso(1800 * 1000)],
            ["weekly", 45, iso(500000 * 1000)],
            ["monthly", 100, iso(2000000 * 1000)],
        ]),
        NOW,
    );
    assert.equal(usage.rolling.pct, 12.5);
    assert.equal(usage.rolling.sec, 1800);
    assert.equal(usage.weekly.pct, 45);
    assert.equal(usage.weekly.sec, 500000);
    assert.equal(usage.monthly.pct, 100);
    assert.equal(usage.monthly.sec, 2000000);
});

test("parseUsageResponse: 缺少某窗口时该窗口为 null", () => {
    const usage = parseUsageResponse(
        makePayload([
            ["rolling", 10, iso(1800 * 1000)],
            ["weekly", 20, iso(3600 * 1000)],
        ]),
        NOW,
    );
    assert.ok(usage.rolling);
    assert.ok(usage.weekly);
    assert.equal(usage.monthly, null);
});

test("parseUsageResponse: percent 非 number 时该窗口为 null", () => {
    // 后端对缺失字段返回 null：Number() 会强转为 0 而被误算成未使用，必须丢弃
    const payload = {
        usage: {
            rolling: { status: "ok", percent: null, resetsAt: iso(1800 * 1000) },
            weekly: { status: "ok", percent: 50, resetsAt: iso(3600 * 1000) },
        },
    };
    const usage = parseUsageResponse(payload, NOW);
    assert.equal(usage.rolling, null);
    assert.ok(usage.weekly);
});

test("parseUsageResponse: resetsAt 缺失或非法返回 null 秒（由渲染层显示 ↻ --）", () => {
    const usage = parseUsageResponse(
        {
            usage: {
                rolling: { status: "ok", percent: 10 },
                weekly: { status: "ok", percent: 20, resetsAt: "not-a-date" },
                monthly: { status: "ok", percent: 30, resetsAt: iso(3600 * 1000) },
            },
        },
        NOW,
    );
    assert.equal(usage.rolling.sec, null);
    assert.equal(usage.weekly.sec, null);
    assert.equal(usage.monthly.sec, 3600);
});

test("parseUsageResponse: 响应无 usage 字段时三窗口全 null", () => {
    const usage = parseUsageResponse({}, NOW);
    assert.equal(usage.rolling, null);
    assert.equal(usage.weekly, null);
    assert.equal(usage.monthly, null);
});

test("parseUsageResponse: 百分比支持小数与负数（原样解析）", () => {
    const usage = parseUsageResponse(
        makePayload([["rolling", -5.5, iso(0)]]),
        NOW,
    );
    assert.equal(usage.rolling.pct, -5.5);
});

// #region queryUsage 请求层错误分支 ----------------

/** 本文件 queryUsage 用例反复用到的调用参数 */
const OC = { position: 0, cache: false, _config: { opencode: [{ apiKey: "test" }] } };

/** 构造带 error.type 的错误响应体（makeResp 的 body 走 JSON.parse） */
const errBody = (type) => JSON.stringify({ error: { type, message: "x" } });

/** 构造三窗口完整的正常用量 payload */
const okBody = JSON.stringify(
    makePayload([
        ["rolling", 10, iso(1800 * 1000)],
        ["weekly", 20, iso(3600 * 1000)],
        ["monthly", 30, iso(7200 * 1000)],
    ]),
);

test("queryUsage: 401 + AuthError → apiKey 无效", async () => {
    const out = await withFetch(makeResp({ status: 401, body: errBody("AuthError") }), () => queryUsage(OC));
    assert.ok(out.includes("apiKey 无效"), "401 AuthError 应提示 key 无效");
});

test("queryUsage: 401 无 error.type → 仍判 apiKey 无效（状态码兜底）", async () => {
    const out = await withFetch(makeResp({ status: 401, body: "{}" }), () => queryUsage(OC));
    assert.ok(out.includes("apiKey 无效"), "401 应由状态码兜底为 key 无效");
});

test("queryUsage: 403 + EntitlementError → 无活跃套餐", async () => {
    const out = await withFetch(makeResp({ status: 403, body: errBody("EntitlementError") }), () => queryUsage(OC));
    assert.ok(out.includes("无活跃套餐"), "EntitlementError 应判无订阅");
    assert.ok(!out.includes("apiKey 无效"), "不应误判 key 无效");
});

test("queryUsage: 403 + AuthError → apiKey 无效（不被 EntitlementError 吞掉）", async () => {
    const out = await withFetch(makeResp({ status: 403, body: errBody("AuthError") }), () => queryUsage(OC));
    assert.ok(out.includes("apiKey 无效"), "403 AuthError 应判 key 无效");
});

test("queryUsage: 3xx + Location → apiKey 无效(重定向到 ...)", async () => {
    const out = await withFetch(
        makeResp({ status: 302, location: "https://auth.opencode.ai/authorize", body: "" }),
        () => queryUsage(OC),
    );
    assert.ok(out.includes("apiKey 无效"), "3xx 跟到登录页应判 key 无效");
    assert.ok(out.includes("auth.opencode.ai"), "应在消息里带上重定向目标");
});

test("queryUsage: 200 + 三窗口全 null → 响应结构异常", async () => {
    const out = await withFetch(
        makeResp({ status: 200, body: JSON.stringify({ usage: {} }) }),
        () => queryUsage(OC),
    );
    assert.ok(out.includes("响应结构异常"), "200 但窗口全空应报结构异常");
});

test("queryUsage: 200 + 三窗口完整 → 渲染输出", async () => {
    const out = await withFetch(
        makeResp({ status: 200, body: okBody }),
        () => queryUsage(OC),
    );
    assert.ok(out.includes("五:"), "应渲染 5h 窗口");
    assert.ok(out.includes("周:"), "应渲染周窗口");
    assert.ok(out.includes("月:"), "应渲染月窗口");
});

// #endregion queryUsage 请求层错误分支 --------------------------------
