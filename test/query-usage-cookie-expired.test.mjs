/**
 * @file cookie 失效检测单元测试
 *
 * 覆盖 ollama / opencode 的 cookie 失效判定分支（用户最常踩的错误路径）：
 *   - ollama: 3xx 重定向到登录页（失效主路径）；cookie 过期但 HTTP 200 的登录页
 *     不再单独检测，统一落到「未找到用量数据」兜底分支
 *   - opencode: 401/403 + OpenAuth 跳转 + 无活跃套餐（subscribe-button）
 *
 * 通过 stub globalThis.fetch 返回固定响应，不依赖真实网络
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { queryUsage as queryOllama } from "../src/query/query-usage-ollama.mjs";
import { queryUsage as queryOpencode } from "../src/query/query-usage-opencode-go.mjs";

/**
 * 构造 fetch Response 的最小 stub
 *
 * @param {object} opts
 * @param {number} [opts.status=200]
 * @param {string} [opts.url] 最终落地 URL（跟随重定向后）
 * @param {string|null} [opts.location] Location 响应头（3xx 用）
 * @param {string} [opts.body] 响应体
 */
function makeResp({ status = 200, url = "", location = null, body = "" }) {
    return {
        status,
        ok: status >= 200 && status < 300,
        url,
        headers: {
            get: (k) => (k.toLowerCase() === "location" ? location : null),
        },
        text: async () => body,
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

// #region ollama cookie 失效 ----------------

test("ollama: 3xx 重定向判定 cookie 失效", async () => {
    const out = await withFetch(
        makeResp({ status: 302, location: "/login" }),
        () =>
            queryOllama({
                position: 0,
                cache: false,
                _config: { ollama: [{ cookie: "test" }] },
            }),
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
            queryOllama({
                position: 0,
                cache: false,
                _config: { ollama: [{ cookie: "test" }] },
            }),
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
        queryOllama({
            position: 0,
            cache: false,
            _config: { ollama: [{ cookie: "test" }] },
        }),
    );
    assert.ok(!out.includes("❌"), "正常页面不应判失效");
    assert.ok(out.includes("12%"), "应解析出用量");
});

// #endregion ollama cookie 失效 --------------------------------

// #region opencode cookie 失效 ----------------

test("opencode: 401 判定 cookie 失效", async () => {
    const out = await withFetch(
        makeResp({ status: 401, url: "https://opencode.ai/workspace/wrk_x/go" }),
        () =>
            queryOpencode({
                position: 0,
                cache: false,
                _config: {
                    opencode: [{ authCookie: "test", workspaceID: "wrk_x" }],
                },
            }),
    );
    assert.ok(out.includes("cookie 已过期"), "应提示 cookie 过期");
    assert.ok(out.includes("login-opencode.cmd"), "应提示重新登录命令");
});

test("opencode: 200 跳转到 OpenAuth 判定 cookie 失效", async () => {
    const out = await withFetch(
        makeResp({
            status: 200,
            url: "https://auth.opencode.ai/authorize?client_id=x",
            body: "<html><title>OpenAuth</title></html>",
        }),
        () =>
            queryOpencode({
                position: 0,
                cache: false,
                _config: {
                    opencode: [{ authCookie: "test", workspaceID: "wrk_x" }],
                },
            }),
    );
    assert.ok(
        out.includes("cookie 已过期") || out.includes("workspace_id 不属于"),
        "应提示凭据失效",
    );
    assert.ok(out.includes("login-opencode.cmd"), "应提示重新登录命令");
});

test("opencode: 200 无鉴权跳转且有 subscribe-button 判定无活跃套餐", async () => {
    // 关键：subscribe-button 是「无活跃套餐」的正向认定，应区别于「凭据失效」
    const out = await withFetch(
        makeResp({
            status: 200,
            url: "https://opencode.ai/workspace/wrk_x/go",
            body: `<html><body><button data-slot="subscribe-button">Subscribe</button></body></html>`,
        }),
        () =>
            queryOpencode({
                position: 0,
                cache: false,
                _config: {
                    opencode: [{ authCookie: "test", workspaceID: "wrk_x" }],
                },
            }),
    );
    assert.ok(out.includes("无活跃套餐"), "应判定无活跃套餐而非凭据失效");
    assert.ok(!out.includes("login-opencode.cmd"), "不应提示重新登录");
});

// #endregion opencode cookie 失效 --------------------------------