/**
 * @file 凭据失效检测单元测试
 *
 * 覆盖 ollama / opencode 的凭据失效判定分支（用户最常踩的错误路径）：
 *   - ollama: 3xx 重定向到登录页（失效主路径）；cookie 过期但 HTTP 200 的登录页
 *     不再单独检测，统一落到「未找到用量数据」兜底分支
 *   - opencode: 401 key 无效 + 403 无 Go 订阅
 *
 * 通过 stub globalThis.fetch 返回固定响应，不依赖真实网络
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { queryUsage as queryOllama } from "../src/query/query-usage-ollama.mjs";
import { queryUsage as queryOpencode } from "../src/query/query-usage-opencode-go.mjs";
import { makeResp, withFetch, withFetchCapture } from "./fetch-stub.mjs";

/** 本文件 opencode 用例反复用到的调用参数 */
const OPENCODE = { position: 0, cache: false, _config: { opencode: [{ apiKey: "sk-x" }] } };
/** 本文件 ollama 用例反复用到的调用参数 */
const OLLAMA = { position: 0, cache: false, _config: { ollama: [{ cookie: "test" }] } };

// #region ollama cookie 失效 ----------------

test("ollama: 3xx 重定向判定 cookie 失效", async () => {
    const out = await withFetch(
        makeResp({ status: 302, location: "/login" }),
        () =>
            queryOllama(OLLAMA),
    );
    assert.ok(out.includes("cookie 已过期"), "应提示 cookie 过期");
    assert.ok(out.includes("重定向"), "应提及重定向");
});

test("ollama: 200 登录页不再误判，落到「未找到用量数据」兜底", async () => {
    // cookie 过期但 HTTP 200 的登录页（如 SSO 场景）不再做关键词检测：
    // parseUsageWindows 找不到用量窗口 → 抛「未找到用量数据」。
    // 代价是提示不如「cookie 已过期」精确，但避免可见文本促销字样误报 + 错误负缓存
    const out = await withFetch(
        makeResp({
            status: 200,
            body: `<html><body><a href="/login">Sign in to sync</a></body></html>`,
        }),
        () =>
            queryOllama(OLLAMA),
    );
    assert.ok(out.includes("未找到用量数据"), "应落到兜底分支");
    assert.ok(!out.includes("cookie 已过期"), "不再做登录关键词误判");
});

test("ollama: 200 正常用量页面不误判 cookie 失效", async () => {
    // 含用量数据但不含登录关键词，应正常解析而非误判失效
    const html =
        `<html><body>` +
        `<div><h2>Session usage</h2><p>12% used</p>` +
        `<div class="local-time" data-time="2026-08-07T00:00:00Z">Resets in 4 hours</div></div>` +
        `<div><h2>Weekly usage</h2><p>45% used</p>` +
        `<div class="local-time" data-time="2026-08-13T00:00:00Z">Resets in 6 days</div></div>` +
        `</body></html>`;
    const out = await withFetch(makeResp({ status: 200, body: html }), () =>
        queryOllama(OLLAMA),
    );
    assert.ok(!out.includes("❌"), "正常页面不应判失效");
    assert.ok(out.includes("12%"), "应解析出用量");
});

// #endregion ollama cookie 失效 --------------------------------

// #region opencode 凭据失效 ----------------

test("opencode: 401 AuthError 判定 apiKey 无效", async () => {
    const out = await withFetch(
        makeResp({
            status: 401,
            body: JSON.stringify({
                type: "error",
                error: { type: "AuthError", message: "Unauthorized" },
            }),
        }),
        () =>
            queryOpencode(OPENCODE),
    );
    assert.ok(out.includes("apiKey 无效"), "应提示 key 无效");
});

test("opencode: 401 无错误体时仍判定 apiKey 无效（状态码兜底）", async () => {
    // 与上一条的分工：上一条 401 本身就会产出「apiKey 无效」，单独断言它无法守护
    // AuthError → INVALID_API_KEY 这条映射；本条钉住 401 的兜底语义
    const out = await withFetch(makeResp({ status: 401 }), () =>
        queryOpencode(OPENCODE),
    );
    assert.ok(out.includes("apiKey 无效"), "401 兜底应提示 key 无效");
});

test("opencode: 403 AuthError 判定 apiKey 无效而非 HTTP 403", async () => {
    // 错误名优先于状态码的正向用例：AuthError 出现在非 401 状态上时，
    // 只有 readErrorType 这条路径能识别。删掉它本条会退化成「请求失败(HTTP 403)」
    const out = await withFetch(
        makeResp({
            status: 403,
            body: JSON.stringify({
                type: "error",
                error: { type: "AuthError", message: "Forbidden" },
            }),
        }),
        () =>
            queryOpencode(OPENCODE),
    );
    assert.ok(out.includes("apiKey 无效"), "错误名应优先于状态码");
    assert.ok(!out.includes("HTTP 403"), "不应退化成 HTTP 403");
});

test("opencode: 403 EntitlementError 判定无活跃套餐", async () => {
    // key 有效但该账号没绑 Go 订阅，必须与「key 无效」区分：
    // 前者允许 smart 兜底隐藏，后者提示用户修配置
    const out = await withFetch(
        makeResp({
            status: 403,
            body: JSON.stringify({
                type: "error",
                error: { type: "EntitlementError", message: "OpenCode Go subscription required." },
            }),
        }),
        () =>
            queryOpencode(OPENCODE),
    );
    assert.ok(out.includes("无活跃套餐"), "应判定无活跃套餐而非 key 无效");
});

test("opencode: 403 但错误名不是 EntitlementError 时报 HTTP 403", async () => {
    // 状态码不能单独定罪：限流/WAF/IP 封禁/key 无 scope 都是 403，
    // 归一成「无活跃套餐」会被 hideOnNoActivePlan 静默吞掉整行
    const out = await withFetch(
        makeResp({
            status: 403,
            body: JSON.stringify({
                type: "error",
                error: { type: "RateLimitError", message: "Too many requests" },
            }),
        }),
        () =>
            queryOpencode(OPENCODE),
    );
    assert.ok(out.includes("HTTP 403"), "403 限流应报 HTTP 错误");
    assert.ok(!out.includes("无活跃套餐"), "不应误判成无活跃套餐");
});

test("opencode: 500 + EntitlementError 仍按错误名判定无活跃套餐", async () => {
    // 错误名优先于状态码的正向用例：迁移账号的请求被代理到新 console，
    // 状态码归它管。没有这条，把 readErrorType 整个删掉测试依然全绿
    const out = await withFetch(
        makeResp({
            status: 500,
            body: JSON.stringify({
                type: "error",
                error: { type: "EntitlementError", message: "subscription required" },
            }),
        }),
        () =>
            queryOpencode(OPENCODE),
    );
    assert.ok(out.includes("无活跃套餐"), "应按 error.type 判定");
});

test("opencode: 401 + EntitlementError 判定无活跃套餐而非 apiKey 无效", async () => {
    // 401 分支不能抢在错误名之前，否则 key 有效但无订阅的账号会被骗去改配置
    const out = await withFetch(
        makeResp({
            status: 401,
            body: JSON.stringify({
                type: "error",
                error: { type: "EntitlementError", message: "subscription required" },
            }),
        }),
        () =>
            queryOpencode(OPENCODE),
    );
    assert.ok(out.includes("无活跃套餐"), "错误名应优先于 401");
});

test("opencode: 302 跳转登录页判定 apiKey 无效", async () => {
    // 未鉴权请求被跟到 auth.opencode.ai/authorize；不手动跟随就与
    // 「200 + 登录页」无法区分，用户会去排查上游接口而非修凭据
    const out = await withFetch(
        makeResp({
            status: 302,
            location: "https://auth.opencode.ai/authorize?client_id=x",
        }),
        () =>
            queryOpencode(OPENCODE),
    );
    assert.ok(out.includes("apiKey 无效"), "应判定 key 无效");
});

test("opencode: 请求带浏览器 UA", async () => {
    // 上游边缘策略对无 UA 的请求可能直接 403，那时会被误报成「无活跃套餐」
    const calls = await withFetchCapture(
        () =>
            makeResp({
                status: 500,
                body: JSON.stringify({ type: "error", error: { type: "Boom" } }),
            }),
        () => queryOpencode(OPENCODE),
    );
    assert.equal(calls.length, 1, "应只请求一次");
    assert.ok(
        calls[0].init.headers["user-agent"]?.includes("Chrome"),
        "应携带浏览器 UA",
    );
});

test("opencode: 3xx 无 Location 时不应渲染「重定向到 null」", async () => {
    // 304 等无 Location 的 3xx 不是鉴权语义，直接拼 null 会让用户无处下手
    const out = await withFetch(makeResp({ status: 304 }), () =>
        queryOpencode(OPENCODE),
    );
    assert.ok(!out.includes("null"), "不应把 null 拼进错误消息");
    assert.ok(out.includes("HTTP 304"), "应按 HTTP 状态报错");
});

// #endregion opencode 凭据失效 --------------------------------