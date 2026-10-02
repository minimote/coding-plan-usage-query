/**
 * @file ark 响应解析器单元测试
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import {
    parseCodingPlanResponse,
    parseAfpResponse,
    queryUsage,
    uriEncode,
    buildCanonicalQuery,
    signVolcengine,
} from "../src/query/query-usage-ark.mjs";
import { makeResp, withFetch } from "./fetch-stub.mjs";

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

// #region 签名工具 ----------------

test("uriEncode: unreserved 字符原样保留", () => {
    assert.equal(uriEncode("AZaz09-_.~"), "AZaz09-_.~");
});

test("uriEncode: 保留字符与空格百分号编码（大写 hex）", () => {
    assert.equal(uriEncode(" "), "%20");
    assert.equal(uriEncode("/"), "%2F");
    assert.equal(uriEncode("="), "%3D");
    assert.equal(uriEncode("&"), "%26");
    assert.equal(uriEncode("a b=c&d"), "a%20b%3Dc%26d");
});

test("uriEncode: 非 ASCII 字符按 UTF-8 字节序列编码", () => {
    // "火" 的 UTF-8 字节为 E7 81 AB；修复前错误输出 %706B（把 UTF-16 码元当数字）
    assert.equal(uriEncode("火"), "%E7%81%AB");
    // BMP 外字符（emoji 代理对）也按 UTF-8 字节编码，不再产生 surrogate 乱码
    assert.equal(uriEncode("😀"), "%F0%9F%98%80");
});

test("buildCanonicalQuery: 参数按 key 字母序拼接", () => {
    assert.equal(
        buildCanonicalQuery("GetCodingPlanUsage"),
        "Action=GetCodingPlanUsage&Region=cn-beijing&Version=2024-01-01",
    );
    assert.equal(
        buildCanonicalQuery("GetAFPUsage"),
        "Action=GetAFPUsage&Region=cn-beijing&Version=2024-01-01",
    );
});

test("signVolcengine: xDate 格式与空 body 的 xContentSha256", () => {
    const now = new Date("2026-07-25T07:02:03.123Z");
    const { xDate, xContentSha256 } = signVolcengine(
        "AK",
        "SK",
        "cn-beijing",
        "Action=X",
        "",
        now,
    );
    assert.equal(xDate, "20260725T070203Z");
    assert.equal(xContentSha256, createHash("sha256").update("").digest("hex"));
});

test("signVolcengine: authorization 结构、credential scope 与 64 位 hex 签名", () => {
    const now = new Date("2026-07-25T07:02:03.123Z");
    const { authorization } = signVolcengine(
        "AKTEST",
        "SKTEST",
        "cn-beijing",
        "Action=X",
        "",
        now,
    );
    assert.ok(
        authorization.startsWith(
            "HMAC-SHA256 Credential=AKTEST/20260725/cn-beijing/ark/request, " +
                "SignedHeaders=host;x-date;x-content-sha256;content-type, Signature=",
        ),
    );
    const signature = authorization.split("Signature=")[1];
    assert.match(signature, /^[0-9a-f]{64}$/);
});

test("signVolcengine: 相同输入确定性输出，时间不同则签名不同", () => {
    const t1 = new Date("2026-07-25T07:02:03.123Z");
    const t2 = new Date("2026-07-25T08:00:00.000Z");
    const a = signVolcengine("AK", "SK", "cn-beijing", "Action=X", "", t1);
    const b = signVolcengine("AK", "SK", "cn-beijing", "Action=X", "", t1);
    const c = signVolcengine("AK", "SK", "cn-beijing", "Action=X", "", t2);
    assert.equal(a.authorization, b.authorization);
    assert.notEqual(a.authorization, c.authorization);
});

test("signVolcengine: body 变化影响 xContentSha256", () => {
    const now = new Date("2026-07-25T07:02:03.123Z");
    const empty = signVolcengine("AK", "SK", "cn-beijing", "Action=X", "", now);
    const withBody = signVolcengine(
        "AK",
        "SK",
        "cn-beijing",
        "Action=X",
        "{}",
        now,
    );
    assert.notEqual(empty.xContentSha256, withBody.xContentSha256);
    assert.equal(
        withBody.xContentSha256,
        createHash("sha256").update("{}").digest("hex"),
    );
});

// #endregion 签名工具 --------------------------------

// #region queryUsage 请求层集成 ----------------

/** 本文件 queryUsage 用例反复用到的调用参数（coding 套餐） */
const ARK = {
    position: 0,
    cache: false,
    _config: { ark: [{ accessKeyId: "ak", secretAccessKey: "sk" }] },
};

/** 构造方舟 OpenAPI 响应体（makeResp 的 body 走 JSON.parse） */
const arkBody = (result) =>
    JSON.stringify({ ResponseMetadata: {}, Result: result });

test("queryUsage: coding 正常响应 → 渲染三窗口", async () => {
    const out = await withFetch(
        makeResp({
            status: 200,
            body: arkBody({
                QuotaUsage: [
                    { Level: "session", Percent: "10", ResetTimestamp: 1784803600 },
                    { Level: "weekly", Percent: "20", ResetTimestamp: 1784803600 },
                    { Level: "monthly", Percent: "30", ResetTimestamp: 1784803600 },
                ],
            }),
        }),
        () => queryUsage(ARK),
    );
    // display auto 在非交互输出走短标签「五/周/月」
    assert.ok(out.includes("五:"), "应渲染 5h 窗口");
    assert.ok(out.includes("周:"), "应渲染周窗口");
    assert.ok(out.includes("月:"), "应渲染月窗口");
});

test("queryUsage: QuotaUsage 为空 → 无活跃套餐", async () => {
    const out = await withFetch(
        makeResp({ status: 200, body: arkBody({ QuotaUsage: [] }) }),
        () => queryUsage(ARK),
    );
    assert.ok(out.includes("无活跃套餐"), "空 tiers 应判无活跃套餐");
});

test("queryUsage: 三窗口字段全缺失 → 响应结构异常", async () => {
    // QuotaUsage 有数据但 Level 都不命中 session/weekly/monthly → 三窗口全 null
    // → ensureAnyWindow 抛「响应结构异常」（区分于空 tiers 的「无活跃套餐」）
    const out = await withFetch(
        makeResp({
            status: 200,
            body: arkBody({
                QuotaUsage: [{ Level: "unknown", Percent: "10", ResetTimestamp: 0 }],
            }),
        }),
        () => queryUsage(ARK),
    );
    assert.ok(out.includes("响应结构异常"), "三窗口全空应报结构异常");
});

test("queryUsage: HTTP 500 → 显示 HTTP 错误", async () => {
    const out = await withFetch(
        makeResp({ status: 500, body: "internal error" }),
        () => queryUsage(ARK),
    );
    assert.ok(out.includes("HTTP 500"), "5xx 应报 HTTP 状态");
});

test("queryUsage: ResponseMetadata.Error → 业务错误冒泡", async () => {
    const out = await withFetch(
        makeResp({
            status: 200,
            body: JSON.stringify({
                ResponseMetadata: { Error: { Code: "NotFound", Message: "no plan" } },
            }),
        }),
        () => queryUsage(ARK),
    );
    assert.ok(out.includes("NotFound"), "业务错误 Code 应进入输出");
});

// #endregion queryUsage 请求层集成 --------------------------------
