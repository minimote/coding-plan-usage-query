/**
 * @file ark 响应解析器单元测试
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    parseCodingPlanResponse,
    parseAfpResponse,
} from "../src/query/query-usage-ark.mjs";

test("parseCodingPlanResponse: 解析三窗口百分比与重置时间戳", () => {
    const data = {
        Result: {
            QuotaUsage: [
                { Level: "session", Percent: "12.5", ResetTimestamp: 1700000000 },
                { Level: "weekly", Percent: "45", ResetTimestamp: 1700600000 },
                { Level: "monthly", Percent: "80.9", ResetTimestamp: -1 },
            ],
        },
    };
    const tiers = parseCodingPlanResponse(data);
    assert.equal(tiers.length, 3);
    assert.deepEqual(tiers[0], {
        label: "session",
        percent: 12.5,
        resetTimestamp: 1700000000,
    });
    assert.equal(tiers[2].label, "monthly");
    assert.equal(tiers[2].resetTimestamp, -1);
});

test("parseCodingPlanResponse: Level 大写转小写", () => {
    const data = {
        Result: {
            QuotaUsage: [{ Level: "SESSION", Percent: "0", ResetTimestamp: null }],
        },
    };
    assert.equal(parseCodingPlanResponse(data)[0].label, "session");
});

test("parseCodingPlanResponse: 缺少 QuotaUsage 返回空数组", () => {
    assert.deepEqual(parseCodingPlanResponse({ Result: {} }), []);
    assert.deepEqual(parseCodingPlanResponse({}), []);
});

test("parseCodingPlanResponse: Percent 缺失按 0 处理", () => {
    const data = {
        Result: {
            QuotaUsage: [{ Level: "session", ResetTimestamp: 0 }],
        },
    };
    assert.equal(parseCodingPlanResponse(data)[0].percent, 0);
});

test("parseAfpResponse: Quota/Used 转百分比，跳过 quota<=0", () => {
    const data = {
        Result: {
            PlanType: "AFP",
            AFPFiveHour: { Quota: "100", Used: "30", ResetTime: 1700000000 },
            AFPWeekly: { Quota: "200", Used: "100", ResetTime: 1700600000 },
            AFPMonthly: { Quota: "0", Used: "0", ResetTime: null },
        },
    };
    const { planType, tiers } = parseAfpResponse(data);
    assert.equal(planType, "AFP");
    assert.equal(tiers.length, 2);
    assert.equal(tiers[0].label, "session");
    assert.equal(tiers[0].percent, 30);
    assert.equal(tiers[1].label, "weekly");
    assert.equal(tiers[1].percent, 50);
});

test("parseAfpResponse: 用量超 Quota 钳制为 100", () => {
    const data = {
        Result: {
            AFPFiveHour: { Quota: "100", Used: "150", ResetTime: 0 },
        },
    };
    assert.equal(parseAfpResponse(data).tiers[0].percent, 100);
});

test("parseAfpResponse: 缺少字段全部跳过，tiers 为空", () => {
    const { planType, tiers } = parseAfpResponse({ Result: {} });
    assert.equal(planType, null);
    assert.equal(tiers.length, 0);
});
