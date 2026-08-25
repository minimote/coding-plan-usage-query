/**
 * @file 千问 Token Plan 响应解析器单元测试
 *
 * parseUsageResponse 纯解析 + queryUsage 请求层错误分支
 * （通过 stub globalThis.fetch 返回固定响应，不依赖真实网络）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseUsageResponse,
    queryUsage,
} from "../src/query/query-usage-qwen.mjs";

/**
 * 构造 JSON fetch Response 的最小 stub（callUsageApi 用 resp.json()）
 *
 * @param {object} body 响应体对象
 * @param {number} [status=200]
 */
function makeJsonResp(body, status = 200) {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

/** 用固定 Response stub fetch，执行 fn，结束后还原 */
async function withFetch(resp, fn) {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => resp;
    try {
        return await fn();
    } finally {
        globalThis.fetch = orig;
    }
}

test("parseUsageResponse: 解析 5 小时/1 周窗口百分比与重置时间", () => {
    const data = {
        per5HourPercentage: 0.5532,
        per1WeekPercentage: 0.1549,
        per5HourResetTime: 1784875560000,
        per1WeekResetTime: 1785462360000,
    };
    const now = 1784800000000;
    const usage = parseUsageResponse(data, now);
    assert.equal(usage.rolling.pct, 55.32);
    assert.equal(usage.weekly.pct, 15.49);
    assert.equal(
        usage.rolling.sec,
        Math.round((1784875560000 - now) / 1000),
    );
    assert.equal(
        usage.weekly.sec,
        Math.round((1785462360000 - now) / 1000),
    );
    assert.equal("monthly" in usage, false);
});

test("parseUsageResponse: 百分比 ×100，边界 0 与 1", () => {
    const usage = parseUsageResponse(
        {
            per5HourPercentage: 0,
            per1WeekPercentage: 1,
            per5HourResetTime: 0,
            per1WeekResetTime: 0,
        },
        0,
    );
    assert.equal(usage.rolling.pct, 0);
    assert.equal(usage.weekly.pct, 100);
});

test("parseUsageResponse: 缺失字段返回 null，不含 monthly 键", () => {
    const usage = parseUsageResponse({}, 1000);
    assert.equal(usage.rolling, null);
    assert.equal(usage.weekly, null);
    assert.equal("monthly" in usage, false);
});

test("parseUsageResponse: 单字段缺失返回 null，另一窗口正常解析", () => {
    const usage = parseUsageResponse(
        { per5HourPercentage: 0.5, per5HourResetTime: 0 },
        1000,
    );
    assert.equal(usage.rolling.pct, 50);
    assert.equal(usage.weekly, null);
    assert.equal("monthly" in usage, false);
});

test("parseUsageResponse: 重置时间已过 / 无重置（0）则 sec 为负数，不钳 0", () => {
    const usage = parseUsageResponse(
        {
            per5HourPercentage: 0.5,
            per5HourResetTime: 0,
            per1WeekPercentage: 0,
            per1WeekResetTime: 0,
        },
        1000,
    );
    // 原样透传负数，由 renderWindows 显示 ↻ --，不再显示「0 分钟后重置」
    assert.equal(usage.rolling.sec, -1);
    assert.equal(usage.weekly.sec, -1);
});

test("parseUsageResponse: 重置时间缺失（undefined / 非数字）→ sec null，由渲染层显示 ↻ --", () => {
    const usage = parseUsageResponse(
        {
            per5HourPercentage: 0.5,
            per5HourResetTime: undefined,
            per1WeekPercentage: 0.2,
            per1WeekResetTime: "not-a-time",
        },
        1000,
    );
    assert.equal(usage.rolling.sec, null);
    assert.equal(usage.weekly.sec, null);
});

// #region queryUsage 请求层错误分支 ----------------

test("queryUsage: 套餐过期（SUCCESS 但内层 data 缺失）→ 显示无活跃套餐", async () => {
    // 套餐过期 / 未订阅时接口返回 SUCCESS，但 data.DataV2.data 只有元信息无数据体，
    // 应抛出 NO_ACTIVE_PLAN 而非「响应结构异常」，供 all / smart 正确隐藏
    const body = {
        code: "200",
        data: {
            DataV2: {
                ret: ["SUCCESS::接口调用成功"],
                data: {
                    msg: "Success.",
                    code: "SUCCESS",
                    requestId: "test",
                    success: true,
                },
            },
            success: true,
        },
    };
    const out = await withFetch(makeJsonResp(body), () =>
        queryUsage({
            position: 0,
            cache: false,
            _config: { qwen: [{ cookie: "test" }] },
        }),
    );
    assert.ok(out.includes("无活跃套餐"), "应显示无活跃套餐");
    assert.ok(!out.includes("响应结构异常"), "不应再误报结构异常");
});

test("queryUsage: 数据体存在但用量字段全缺失 → 仍报响应结构异常", async () => {
    // 字段改名 / 接口更新的保护分支不应受无活跃套餐判定影响：
    // inner 存在但 per5HourPercentage / per1WeekPercentage 都不是数字时
    // 仍报「响应结构异常」，避免静默渲染 0% 用量误导
    const body = {
        data: {
            success: true,
            DataV2: { data: { data: { unknownField: 1 } } },
        },
    };
    const out = await withFetch(makeJsonResp(body), () =>
        queryUsage({
            position: 0,
            cache: false,
            _config: { qwen: [{ cookie: "test" }] },
        }),
    );
    assert.ok(out.includes("响应结构异常"), "应报结构异常");
    assert.ok(!out.includes("无活跃套餐"), "不应误判为无活跃套餐");
});

// #endregion queryUsage 请求层错误分支 --------------------------------
