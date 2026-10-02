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
import { queryUsage as queryCommandcode } from "../src/query/query-usage-commandcode.mjs";
import { queryUsage as queryOpencode } from "../src/query/query-usage-opencode-go.mjs";
import { queryUsage as queryQwen } from "../src/query/query-usage-qwen.mjs";
import { queryUsage as queryOllama } from "../src/query/query-usage-ollama.mjs";
import { makeJsonResp, withFetch } from "./fetch-stub.mjs";

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

test("opencode: 缺 apiKey 返回错误行且不写负缓存", async () => {
    const out = await queryOpencode({
        position: 0,
        cache: true,
        _config: { opencode: [{}] },
    });
    assert.ok(out.includes("apiKey"), "应提示缺凭据");
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

// #region commandcode 门控（新增供应商时最容易抄漏 reachedFetch 埋点） ----------------

test("commandcode: config 阶段错误（position 越界）返回错误行且不写负缓存", async () => {
    const out = await queryCommandcode({
        position: OOB,
        cache: true,
        _config: { commandcode: [] },
    });
    assert.ok(out.includes("❌"), "应返回错误行");
    assert.equal(readCache(`commandcode:${OOB}`), null, "不应写负缓存");
});

test("commandcode: 缺 apiKey 返回错误行且不写负缓存", async () => {
    const out = await queryCommandcode({
        position: 0,
        cache: true,
        _config: { commandcode: [{}] },
    });
    assert.ok(out.includes("apiKey"), "应提示缺 apiKey");
    assert.equal(readCache(`commandcode:0`), null, "不应写负缓存");
});

// 两条用例都写/读 commandcode:0，用不同 position 隔离，避免前一条的负缓存
// 被后一条的 readCache 命中而根本不打网络
test("commandcode: 瞬时故障（500）写负缓存", async () => {
    const out = await withFetch(makeJsonResp({}, 500), () =>
        queryCommandcode({
            position: 0,
            cache: true,
            _config: { commandcode: [{ apiKey: "test" }] },
        }),
    );
    assert.ok(out.includes("HTTP 500"), "500 应提示 HTTP 错误");
    const hit = readCache(`commandcode:0`);
    assert.ok(hit, "瞬时故障应写负缓存");
    assert.equal(typeof hit.error, "string", "负缓存应存错误消息");
});

test("commandcode: 非瞬时故障（401 key 无效）不写负缓存", async () => {
    // 改配置即解的错误写负缓存，会让用户修好后仍被旧错误挡满 30s
    const out = await withFetch(makeJsonResp({}, 401), () =>
        queryCommandcode({
            position: 1,
            cache: true,
            _config: { commandcode: [{ apiKey: "test" }, { apiKey: "t2" }] },
        }),
    );
    assert.ok(out.includes("apiKey 无效"), "401 应提示 key 无效");
    assert.equal(readCache(`commandcode:1`), null, "非瞬时故障不应写负缓存");
});

// #endregion commandcode 门控 --------------------------------

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
        assert.equal(typeof hit.error, "string", "负缓存应存错误消息");
    } finally {
        globalThis.fetch = origFetch;
    }
});

// #endregion 网络失败写负缓存 ----------------

// #region 负缓存命中时按本次参数重渲染 ----------------

test("负缓存命中用本次 display 渲染，而非缓存的整行", async () => {
    // 负缓存存的是错误消息而非渲染好的行：否则 30s 窗口内改显示档位不生效，
    // 用户会看到上一次调用的长短标签
    await withFetch(makeJsonResp({}, 500), () =>
        queryOllama({
            position: 0,
            cache: true,
            display: "long",
            _config: { ollama: [{ cookie: "c", longLabel: "MyOllama", shortLabel: "MO" }] },
        }),
    );
    const short = await queryOllama({
        position: 0,
        cache: true,
        display: "short",
        _config: { ollama: [{ cookie: "c", longLabel: "MyOllama", shortLabel: "MO" }] },
    });
    assert.ok(short.includes("MO"), "short 档应改用短标签");
    assert.ok(!short.includes("MyOllama"), "不应残留 long 档的长标签");
});

test("负缓存命中用当前账号标签，而非写入时的旧标签", async () => {
    await withFetch(makeJsonResp({}, 500), () =>
        queryOllama({
            position: 0,
            cache: true,
            display: "short",
            _config: { ollama: [{ cookie: "c", shortLabel: "OldShort" }] },
        }),
    );
    const renamed = await queryOllama({
        position: 0,
        cache: true,
        display: "short",
        _config: { ollama: [{ cookie: "c", shortLabel: "NewShort" }] },
    });
    assert.ok(renamed.includes("NewShort"), "应改用改名后的短标签");
    assert.ok(!renamed.includes("OldShort"), "不应残留旧标签");
});

// #endregion 负缓存命中时按本次参数重渲染 ----------------
