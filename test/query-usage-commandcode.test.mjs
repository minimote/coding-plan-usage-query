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
import {
    makeJsonResp,
    withFetch,
    withFetchByUrl,
} from "./fetch-stub.mjs";

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

test("parseUsageResponse: planId 未收录时降级月窗口并说明，窗口不受影响", () => {
    // 查不到表说明上游改了套餐命名。但 5h/周窗口仍然有效，
    // 整行报错会让用户连其他窗口都看不到，故只降级月窗口 + 把已知信息说出来
    const subs = { data: { planId: "individual-goat-v2" } };
    const usage = parseUsageResponse(CREDITS, subs, NOW);
    assert.equal(usage.monthly, null, "月窗口应降级为 null");
    assert.ok(usage.rolling, "5h 窗口不受影响");
    assert.ok(usage.weekly, "周窗口不受影响");
    assert.match(usage.note, /individual-goat-v2/, "说明应带上当前套餐名");
    assert.match(usage.note, /月剩余 \$/, "说明应带上唯一能拿到的月剩余");
});

test("parseUsageResponse: planId 缺失/为空时 monthly 为 null，窗口不受影响", () => {
    // 无套餐名（未订阅/字段缺失）时无从换算，也不能凭空报错
    for (const planId of [undefined, null, ""]) {
        const subs = { data: { planId } };
        const usage = parseUsageResponse(CREDITS, subs, NOW);
        assert.equal(usage.monthly, null, `planId=${JSON.stringify(planId)}`);
        assert.equal(usage.note, null, `planId=${JSON.stringify(planId)} 无说明`);
        assert.ok(usage.rolling);
        assert.ok(usage.weekly);
    }
});

test("parseUsageResponse: planId 未收录且月剩余也缺失时说明不含月剩余", () => {
    const credits = { credits: { monthlyCredits: null }, windowLimits: {} };
    const usage = parseUsageResponse(credits, { data: { planId: "teams-max" } }, NOW);
    assert.equal(usage.monthly, null);
    assert.match(usage.note, /teams-max/);
    assert.ok(!usage.note.includes("月剩余"), "拿不到剩余时不应编造");
});
test("parseUsageResponse: 超额购买致月剩余大于上限时 monthly 不显示绿色 0%", () => {
    // monthlyCredits 含 purchasedCredits，可能大于套餐上限：算出的负百分比
    // 不可信，须丢弃窗口显示 月:-- 而非钳成 0% 让用户以为月额度没用过
    const credits = { credits: { monthlyCredits: 55 }, windowLimits: {} };
    const subs = { data: { planId: "individual-go" } };
    const usage = parseUsageResponse(credits, subs, NOW);
    assert.equal(usage.monthly, null);
});

test("parseUsageResponse: cap 为字符串时窗口为 null（不 Number() 强转）", () => {
    // cap 与 used 必须同策略：强转会同时救活 cap:"14" 与丢掉 used:"1"，
    // 同一份脏数据在相邻两个字段上行为相反
    const credits = { windowLimits: { fiveHour: { used: "1", cap: "14", resetAt: 1 } } };
    const usage = parseUsageResponse(credits, SUBS, NOW);
    assert.equal(usage.rolling, null);
});

test("parseUsageResponse: planId 撞上 Object.prototype 键名时不渲染 NaN 的 0%", () => {
    // 下标取值会从原型链解析出函数而非 undefined，漏过 undefined 判定后
    // (fn - monthlyCredits)/fn 得 NaN，被渲染层归成绿色的 月:0%
    for (const planId of ["toString", "constructor", "valueOf", "hasOwnProperty"]) {
        const usage = parseUsageResponse(CREDITS, { data: { planId } }, NOW);
        assert.equal(usage.monthly, null, `planId=${planId} 月窗口应为 null`);
        assert.match(usage.note, new RegExp(planId), `planId=${planId} 应报未收录`);
    }
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

/** 本文件 queryUsage 用例反复用到的调用参数 */
const CC = { position: 0, cache: false, _config: { commandcode: [{ apiKey: "test" }] } };

test("queryUsage: 正常返回渲染三窗口", async () => {
    const out = await withFetchByUrl(
        (url) =>
            makeJsonResp(url.includes("/alpha/billing/credits") ? CREDITS : SUBS),
        () => queryUsage(CC),
    );
    assert.ok(out.includes("五:"), "应包含 5h 窗口");
    assert.ok(out.includes("周:"), "应包含周窗口");
    assert.ok(out.includes("月:"), "应包含月窗口");
});

test("queryUsage: 401 → 显示 apiKey 无效，而非无活跃套餐", async () => {
    // 密钥填错/被吊销必须与订阅过期区分：前者提示用户修配置，
    // 后者才会被 query-usage-smart 的 hideOnNoActivePlan 静默隐藏整行
    const out = await withFetch(makeJsonResp({}, 401), () => queryUsage(CC));
    assert.ok(out.includes("apiKey 无效"), "401 应提示 apiKey 无效");
    assert.ok(!out.includes("无活跃套餐"), "401 不应报成无活跃套餐");
});

test("queryUsage: 403 → 显示 apiKey 无效，而非无活跃套餐", async () => {
    // 实测证实套餐过期是 200 + 字段全空，403 剩下的可能只有 key 权限与 WAF/限流。
    // 判成「无活跃套餐」会被 hideOnNoActivePlan 静默吞掉整行，用户看不到任何痕迹
    const out = await withFetch(makeJsonResp({}, 403), () => queryUsage(CC));
    assert.ok(out.includes("apiKey 无效"), "403 应提示 key 无效");
    assert.ok(!out.includes("无活跃套餐"), "403 不应报成无活跃套餐");
});

test("queryUsage: 500 → 显示 HTTP 错误", async () => {
    const out = await withFetch(makeJsonResp({}, 500), () => queryUsage(CC));
    assert.ok(out.includes("HTTP 500"));
});

test("queryUsage: 三窗口全解析失败 → 显示结构异常", async () => {
    const out = await withFetchByUrl(
        // subscriptions 必须给出 data，否则会先命中「无活跃套餐」分支而到不了解析
        (url) => makeJsonResp(url.includes("/subscriptions") ? SUBS : {}),
        () => queryUsage(CC),
    );
    assert.ok(out.includes("响应结构异常"));
});

test("queryUsage: subscriptions.data 为 null → 无活跃套餐而非结构异常", async () => {
    // 套餐过期时上游返回 200 + data:null（不是 401/403），三个窗口会全为 null；
    // 若不先判定 data 会误报「响应结构异常」，把凭据问题当成接口问题
    const out = await withFetchByUrl(
        (url) =>
            makeJsonResp(
                url.includes("/subscriptions")
                    ? { success: true, data: null }
                    : {
                          credits: { monthlyCredits: 0 },
                          windowLimits: {
                              limited: false,
                              fiveHour: null,
                              weekly: null,
                          },
                      },
            ),
        () =>
            queryUsage(CC),
    );
    assert.ok(out.includes("无活跃套餐"), "应判定无活跃套餐");
    assert.ok(!out.includes("响应结构异常"), "不应误报结构异常");
});

test("queryUsage: planId 未收录时 note 经 renderWindows 端到端渲染为 ⚠ 说明", async () => {
    // 上游新增/改名套餐时月上限查表失败，但 5h/周窗口仍有效，整行不该失败；
    // ensureAnyWindow 要认 note，renderWindows 要把 note 拼到行尾的 ⚠ 后
    const subs = { success: true, data: { planId: "individual-goat-v2" } };
    const out = await withFetchByUrl(
        (url) => makeJsonResp(url.includes("/credits") ? CREDITS : subs),
        () => queryUsage(CC),
    );
    assert.ok(out.includes("五:"), "5h 窗口应正常渲染");
    assert.ok(out.includes("⚠"), "应输出 ⚠ 预警标记");
    assert.match(out, /individual-goat-v2/, "note 里的套餐名应进入输出");
});

// #endregion queryUsage 请求层错误分支 --------------------------------
