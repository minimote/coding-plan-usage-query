/**
 * @file 负缓存门控（reachedFetch）单元测试
 *
 * 覆盖 queryUsage 的负缓存行为：
 *   - 配置类错误（findAccount 越界 / 凭据缺失）发生在网络阶段之前，不写负缓存
 *   - 网络阶段失败（fetch 抛错）确实写入负缓存
 *
 * 通过 _config 注入假配置，不依赖真实 config.json；通过临时 fetch stub 模拟网络失败
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readCache } from "../src/utils/utils-query-usage.mjs";
import { queryUsage as queryArk } from "../src/query/query-usage-ark.mjs";
import { queryUsage as queryOpencode } from "../src/query/query-usage-opencode-go.mjs";
import { queryUsage as queryQwen } from "../src/query/query-usage-qwen.mjs";
import { queryUsage as queryOllama } from "../src/query/query-usage-ollama.mjs";

// 缓存重定向到临时目录：网络失败测试写入的负缓存不触碰真实生产缓存文件
const CACHE_DIR = mkdtempSync(join(tmpdir(), "cc-negative-cache-test-"));
process.env.CC_USAGE_CACHE_PATH = join(CACHE_DIR, "cache-usage.json");

test.after(() => {
    delete process.env.CC_USAGE_CACHE_PATH;
    rmSync(CACHE_DIR, { recursive: true, force: true });
});

/** 必然越界的 position：对任意注入的空账号数组都触发 findAccount 阶段错误 */
const OOB = 999999;

// #region 配置类错误不写负缓存 ----------------

test("ark: config 阶段错误（position 越界）返回错误行且不写负缓存", async () => {
    const out = await queryArk({
        position: OOB,
        cache: true,
        _config: { ark: [] },
    });
    assert.ok(out.includes("❌"), "应返回错误行");
    assert.equal(readCache(`ark:${OOB}:coding`), null, "不应写负缓存");
});

test("opencode: config 阶段错误（position 越界）返回错误行且不写负缓存", async () => {
    const out = await queryOpencode({
        position: OOB,
        cache: true,
        _config: { opencode: [] },
    });
    assert.ok(out.includes("❌"), "应返回错误行");
    assert.equal(readCache(`opencode:${OOB}`), null, "不应写负缓存");
});

test("qwen: config 阶段错误（position 越界）返回错误行且不写负缓存", async () => {
    const out = await queryQwen({
        position: OOB,
        cache: true,
        _config: { qwen: [] },
    });
    assert.ok(out.includes("❌"), "应返回错误行");
    assert.equal(readCache(`qwen:${OOB}`), null, "不应写负缓存");
});

test("ollama: config 阶段错误（position 越界）返回错误行且不写负缓存", async () => {
    const out = await queryOllama({
        position: OOB,
        cache: true,
        _config: { ollama: [] },
    });
    assert.ok(out.includes("❌"), "应返回错误行");
    assert.equal(readCache(`ollama:${OOB}`), null, "不应写负缓存");
});

// #endregion 配置类错误不写负缓存 ----------------

// #region 凭据缺失不写负缓存 ----------------

test("ark: 缺 accessKeyId/secretAccessKey 返回错误行且不写负缓存", async () => {
    const out = await queryArk({
        position: 0,
        cache: true,
        _config: { ark: [{}] },
    });
    assert.ok(out.includes("accessKeyId"), "应提示缺凭据");
    assert.equal(readCache(`ark:0:coding`), null, "不应写负缓存");
});

test("opencode: 缺 authCookie/workspaceID 返回错误行且不写负缓存", async () => {
    const out = await queryOpencode({
        position: 0,
        cache: true,
        _config: { opencode: [{}] },
    });
    assert.ok(out.includes("authCookie"), "应提示缺凭据");
    assert.equal(readCache(`opencode:0`), null, "不应写负缓存");
});

test("qwen: 缺 cookie 返回错误行且不写负缓存", async () => {
    const out = await queryQwen({
        position: 0,
        cache: true,
        _config: { qwen: [{}] },
    });
    assert.ok(out.includes("cookie"), "应提示缺 cookie");
    assert.equal(readCache(`qwen:0`), null, "不应写负缓存");
});

test("ollama: 缺 cookie 返回错误行且不写负缓存", async () => {
    const out = await queryOllama({
        position: 0,
        cache: true,
        _config: { ollama: [{}] },
    });
    assert.ok(out.includes("cookie"), "应提示缺 cookie");
    assert.equal(readCache(`ollama:0`), null, "不应写负缓存");
});

// #endregion 凭据缺失不写负缓存 ----------------

// #region 网络失败写负缓存 ----------------

test("qwen: 网络失败（fetch 抛错）返回错误行且写负缓存", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error("network down");
    };
    try {
        const out = await queryQwen({
            position: 0,
            cache: true,
            _config: { qwen: [{ cookie: "test-cookie" }] },
        });
        assert.ok(out.includes("❌"), "应返回错误行");
        const hit = readCache(`qwen:0`);
        assert.ok(hit, "网络失败应写负缓存");
        assert.equal(typeof hit.output, "string", "负缓存应存错误输出");
    } finally {
        globalThis.fetch = origFetch;
    }
});

// #endregion 网络失败写负缓存 ----------------
