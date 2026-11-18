/**
 * @file CommandCode 响应解析器单元测试
 *
 * parseUsageResponse 纯解析 + queryUsage 请求层错误分支
 * （通过 stub globalThis.fetch 返回固定响应，不依赖真实网络）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import "./no-active-env.mjs";
import {
  parseUsageResponse,
  queryUsage,
} from "../src/query/query-usage-commandcode.mjs";
import {
  makeJsonResp,
  withFetch,
  withFetchByUrl,
} from "./fetch-stub.mjs";

/** 实测返回结构的同构样本（GOAT：月额度 $70，5h $14，周 $35） */
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

/** 本周期已花金额：与 69.7986 相加约为套餐上限 70 */
const SUMMARY = { totalCost: 0.2014300555, totalMonthlyCredits: 0.2014300555 };

const NOW = 1788273600000; // 固定 now 保证倒计时断言确定

test("parseUsageResponse: 三窗口完整解析", () => {
  const usage = parseUsageResponse(CREDITS, SUBS, SUMMARY, NOW);
  // 5h: 0.2014300555 / 14
  assert.ok(Math.abs(usage.rolling.pct - 1.438786) < 1e-4);
  assert.equal(usage.rolling.sec, Math.round((1788277141327 - NOW) / 1000));
  // 周: 0.2014300555 / 35
  assert.ok(Math.abs(usage.weekly.pct - 0.575516) < 1e-4);
  assert.equal(usage.weekly.sec, Math.round((1788863941327 - NOW) / 1000));
  // 月: 0.2014300555 / (0.2014300555 + 69.7985699445) = 0.287757%
  assert.ok(Math.abs(usage.monthly.pct - 0.287757) < 1e-4);
  assert.equal(
    usage.monthly.sec,
    Math.round((new Date("2026-10-01T10:04:09.000Z").getTime() - NOW) / 1000),
  );
});

test("parseUsageResponse: 月度百分比不依赖 planId", () => {
  // 不查表后，planId 未收录/改名/缺失都不影响月度计算
  for (const planId of [undefined, null, "", "individual-goat", "brand-new-plan", "toString"]) {
    const usage = parseUsageResponse(CREDITS, { data: { planId } }, SUMMARY, NOW);
    assert.ok(Math.abs(usage.monthly.pct - 0.287757) < 1e-4, `planId=${JSON.stringify(planId)}`);
    assert.equal(usage.note, null, `planId=${JSON.stringify(planId)} 不应有降级说明`);
  }
});

test("parseUsageResponse: freeCredits 不计入月度分母", () => {
  // 免费额度是否已并入 monthlyCredits 未验证，保守排除，避免重复计数
  const credits = { credits: { monthlyCredits: 69.8, freeCredits: 30 }, windowLimits: {} };
  const usage = parseUsageResponse(credits, SUBS, { totalCost: 0.2 }, NOW);
  assert.ok(Math.abs(usage.monthly.pct - 0.285714) < 1e-4); // 0.2 / 70
});

test("parseUsageResponse: purchasedCredits 不计入月度分母", () => {
  // 购买额度已被上游并入 monthlyCredits，再加一次会让分母虚高
  const credits = { credits: { monthlyCredits: 69.8, purchasedCredits: 500 }, windowLimits: {} };
  const usage = parseUsageResponse(credits, SUBS, { totalCost: 0.2 }, NOW);
  assert.ok(Math.abs(usage.monthly.pct - 0.285714) < 1e-4); // 0.2 / 70
});

test("parseUsageResponse: totalCost 缺失时月窗口为 null 并附说明，5h/周不受影响", () => {
  const usage = parseUsageResponse(CREDITS, SUBS, {}, NOW);
  assert.equal(usage.monthly, null);
  assert.match(usage.note, /月已花金额获取失败/);
  assert.ok(usage.rolling);
  assert.ok(usage.weekly);
});

test("parseUsageResponse: totalCost 为脏数据时月窗口为 null", () => {
  for (const bad of [null, "", false, undefined, "0.2", NaN, Infinity]) {
    const usage = parseUsageResponse(CREDITS, SUBS, { totalCost: bad }, NOW);
    assert.equal(usage.monthly, null, `totalCost=${JSON.stringify(bad)}`);
  }
});

test("parseUsageResponse: monthlyCredits/freeCredits 为脏数据时按 0 计", () => {
  // null/""/false 若被当成 100% 已耗，hideOnMonthlyExhausted 会整行隐藏
  for (const bad of [null, "", false, undefined]) {
    const credits = { credits: { monthlyCredits: bad, freeCredits: bad }, windowLimits: {} };
    const usage = parseUsageResponse(credits, SUBS, { totalCost: 0 }, NOW);
    assert.equal(usage.monthly, null, `monthlyCredits=${JSON.stringify(bad)} 分母为 0`);
  }
});

test("parseUsageResponse: 剩余额度缺失时月窗口为 null，不误报 100%", () => {
  // 剩余缺失时若按 0 计，分母只剩 totalCost，百分比恒为 100%，
  // 开启 hideOnMonthlyExhausted 会让整行消失
  for (const bad of [null, "", false, undefined, "69.8", -1]) {
    const credits = { credits: { monthlyCredits: bad }, windowLimits: {} };
    const usage = parseUsageResponse(credits, SUBS, { totalCost: 0.2 }, NOW);
    assert.equal(usage.monthly, null, `monthlyCredits=${JSON.stringify(bad)}`);
    assert.match(usage.note, /月剩余额度获取失败/);
  }
});

test("parseUsageResponse: 分母为 0（没花也没剩余）时月窗口为 null", () => {
  const credits = { credits: { monthlyCredits: 0, freeCredits: 0 }, windowLimits: {} };
  const usage = parseUsageResponse(credits, SUBS, { totalCost: 0 }, NOW);
  assert.equal(usage.monthly, null);
});

test("parseUsageResponse: window used 为脏数据时窗口为 null", () => {
  // cap 合法但 used 缺失时显示 --，而非 0%（未使用）
  for (const bad of [null, "", false, undefined]) {
    const credits = {
      windowLimits: { fiveHour: { cap: 14, used: bad, resetAt: 1 } },
    };
    const usage = parseUsageResponse(credits, SUBS, SUMMARY, NOW);
    assert.equal(usage.rolling, null, `used=${JSON.stringify(bad)}`);
  }
});

test("parseUsageResponse: windowLimits.limited 为 false 时不写 5h/周键", () => {
  // 缺键=平台无此窗口，渲染层不输出；置 null 会显示成 五:-- 误导用户
  const credits = { ...CREDITS, windowLimits: { ...CREDITS.windowLimits, limited: false } };
  const usage = parseUsageResponse(credits, SUBS, SUMMARY, NOW);
  assert.ok(!("rolling" in usage), "不应有 rolling 键");
  assert.ok(!("weekly" in usage), "不应有 weekly 键");
  assert.ok(usage.monthly, "月窗口不受 limited 影响");
});

test("queryUsage: limited 为 false 时输出不含 5h/周标签", async () => {
  // 端到端确认缺键而非 null：null 会渲染出 五:-- 周:--
  const credits = { ...CREDITS, windowLimits: { ...CREDITS.windowLimits, limited: false } };
  const out = await withFetchByUrl(
    byEndpoint({ credits }),
    () => queryUsage(CC),
  );
  assert.ok(!out.includes("五:"), "不应输出 5h 标签");
  assert.ok(!out.includes("周:"), "不应输出周标签");
  assert.ok(out.includes("月:"), "月窗口照常输出");
});

test("parseUsageResponse: limited 字段缺失时照常展示 5h/周", () => {
  // 上游改字段名不应让窗口静默消失
  const { limited: _limited, ...rest } = CREDITS.windowLimits;
  const usage = parseUsageResponse({ ...CREDITS, windowLimits: rest }, SUBS, SUMMARY, NOW);
  assert.ok(usage.rolling);
  assert.ok(usage.weekly);
});

test("parseUsageResponse: cap 为字符串时窗口为 null", () => {
  // cap 与 used 必须同策略，强转会救活一根丢另一根
  const credits = { windowLimits: { fiveHour: { used: "1", cap: "14", resetAt: 1 } } };
  const usage = parseUsageResponse(credits, SUBS, SUMMARY, NOW);
  assert.equal(usage.rolling, null);
});

test("parseUsageResponse: 缺 subscriptions 时月度周期倒计时为 null", () => {
  const usage = parseUsageResponse(CREDITS, {}, SUMMARY, NOW);
  assert.ok(usage.monthly, "月百分比仍可算");
  assert.equal(usage.monthly.sec, null);
});

test("parseUsageResponse: 缺 windowLimits 时窗口为 null", () => {
  const usage = parseUsageResponse({ credits: { monthlyCredits: 70 } }, SUBS, SUMMARY, NOW);
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
  const usage = parseUsageResponse(credits, SUBS, SUMMARY, NOW);
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
  const usage = parseUsageResponse(credits, SUBS, SUMMARY, NOW);
  assert.equal(usage.rolling.sec, null);
  assert.equal(usage.weekly.sec, Math.round((1000 - NOW) / 1000));
});

// #region queryUsage 请求层错误分支 ----------------

/** 本文件 queryUsage 用例反复用到的调用参数 */
const CC = { position: 0, cache: false, _config: { commandcode: [{ apiKey: "test" }] } };

/** 按路径分发三个端点的响应 */
const byEndpoint = (overrides = {}) => (url) => {
  if (url.includes("/alpha/billing/credits")) {
    return makeJsonResp(overrides.credits ?? CREDITS);
  }
  if (url.includes("/alpha/billing/subscriptions")) {
    return makeJsonResp(overrides.subs ?? SUBS);
  }
  if (url.includes("/alpha/usage/summary")) {
    return makeJsonResp(overrides.summary ?? SUMMARY);
  }
  return makeJsonResp({}, 404);
};

test("queryUsage: 正常返回渲染三窗口", async () => {
  const out = await withFetchByUrl(byEndpoint(), () => queryUsage(CC));
  assert.ok(out.includes("五:"), "应包含 5h 窗口");
  assert.ok(out.includes("周:"), "应包含周窗口");
  assert.ok(out.includes("月:"), "应包含月窗口");
});

test("queryUsage: summary 请求失败 → 月显示 --，5h/周照常", async () => {
  const out = await withFetchByUrl(
    (url) => {
      if (url.includes("/alpha/usage/summary")) {
        return makeJsonResp({}, 500);
      }
      return byEndpoint()(url);
    },
    () => queryUsage(CC),
  );
  assert.ok(out.includes("五:"), "5h 不受影响");
  assert.ok(out.includes("周:"), "周不受影响");
  assert.ok(out.includes("月:"), "月标签仍应出现");
  assert.ok(out.includes("--"), "月应显示 --");
  assert.match(out, /⚠/, "应附降级说明");
});

test("queryUsage: 401 → 显示 apiKey 无效，而非无活跃套餐", async () => {
  // 密钥问题要提示用户改配置，不能被 hideOnNoActivePlan 静默隐藏
  const out = await withFetch(makeJsonResp({}, 401), () => queryUsage(CC));
  assert.ok(out.includes("apiKey 无效"), "401 应提示 apiKey 无效");
  assert.ok(!out.includes("无活跃套餐"), "401 不应报成无活跃套餐");
});

test("queryUsage: 403 → 显示 apiKey 无效，而非无活跃套餐", async () => {
  // 实测套餐过期是 200 + 字段全空，403 只可能是 key 权限或限流
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
    // subscriptions 必须给出 data，否则会先命中「无活跃套餐」分支
    byEndpoint({ credits: {}, summary: {} }),
    () => queryUsage(CC),
  );
  assert.ok(out.includes("响应结构异常"));
});

test("queryUsage: subscriptions.data 为 null → 无活跃套餐而非结构异常", async () => {
  // 套餐过期返回 200 + data:null，不先判定会误报成接口问题
  const out = await withFetchByUrl(
    byEndpoint({
      subs: { success: true, data: null },
      credits: {
        credits: { monthlyCredits: 0 },
        windowLimits: { limited: false, fiveHour: null, weekly: null },
      },
    }),
    () => queryUsage(CC),
  );
  assert.ok(out.includes("无活跃套餐"), "应判定无活跃套餐");
  assert.ok(!out.includes("响应结构异常"), "不应误报结构异常");
});

// #endregion queryUsage 请求层错误分支 --------------------------------
