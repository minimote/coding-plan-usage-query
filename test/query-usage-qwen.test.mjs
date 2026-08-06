/**
 * @file 千问 Token Plan 响应解析器单元测试
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUsageResponse } from "../src/query/query-usage-qwen.mjs";

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
