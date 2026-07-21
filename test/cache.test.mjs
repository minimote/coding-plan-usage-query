/**
 * @file 缓存读写单元测试
 *
 * 缓存文件路径在 utils-query-usage.mjs 内由 import.meta.url 计算得到，
 * 指向项目根目录 tmp/usage-cache.json。本测试直接清理该文件后验证
 * 读-改-写、TTL 过期、负缓存、倒计时偏移等行为。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    existsSync,
    readFileSync,
    writeFileSync,
    rmSync,
} from "fs";
import { fileURLToPath } from "url";

// 与 utils-query-usage.mjs 中 CACHE_PATH 保持一致的计算方式
const CACHE_PATH = fileURLToPath(
    new URL("../tmp/usage-cache.json", import.meta.url),
);

import {
    readCache,
    writeCache,
    fetchUsageCached,
    CACHE_TTL_MS,
} from "../src/utils/utils-query-usage.mjs";

function clearCache() {
    rmSync(CACHE_PATH, { force: true });
}

test.before(() => {
    clearCache();
});

test("readCache: 空缓存返回 null", () => {
    clearCache();
    assert.equal(readCache("ark:0:coding"), null);
});

test("writeCache -> readCache: 写入后立即可读", () => {
    clearCache();
    const usage = {
        rolling: { pct: 50, sec: 1800 },
        weekly: { pct: 30, sec: 500000 },
        monthly: { pct: 80, sec: 2000000 },
    };
    writeCache("ark:0:coding", { usage });
    const hit = readCache("ark:0:coding");
    assert.ok(hit);
    // readCache 会扣去已流逝毫秒，故 sec 用近似比较
    assert.equal(hit.usage.rolling.pct, 50);
    assert.ok(Math.abs(hit.usage.rolling.sec - 1800) < 1);
    assert.equal(hit.usage.weekly.pct, 30);
    assert.ok(Math.abs(hit.usage.weekly.sec - 500000) < 1);
    assert.equal(hit.usage.monthly.pct, 80);
    assert.ok(Math.abs(hit.usage.monthly.sec - 2000000) < 1);
});

test("readCache: 倒计时扣除已流逝秒数", () => {
    clearCache();
    writeCache("ark:0:coding", {
        usage: {
            rolling: { pct: 50, sec: 100 },
            weekly: { pct: 30, sec: 200 },
            monthly: null,
        },
    });
    // 回写一个 3 秒前的条目模拟已流逝时间
    const raw = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
    raw["ark:0:coding"].ts = Date.now() - 3000;
    writeFileSync(CACHE_PATH, JSON.stringify(raw));

    const hit = readCache("ark:0:coding");
    assert.ok(hit);
    // 100 - 3 ≈ 97（浮点，允许误差）
    assert.ok(Math.abs(hit.usage.rolling.sec - 97) < 1);
    assert.ok(Math.abs(hit.usage.weekly.sec - 197) < 1);
    assert.equal(hit.usage.monthly, null);
});

test("readCache: 负缓存（错误输出）命中", () => {
    clearCache();
    writeCache("ark:0:coding", { output: "❌ 查询失败" });
    const hit = readCache("ark:0:coding");
    assert.ok(hit);
    assert.equal(hit.output, "❌ 查询失败");
});

test("readCache: TTL 过期返回 null", () => {
    clearCache();
    writeCache("ark:0:coding", {
        usage: { rolling: { pct: 1, sec: 1 }, weekly: null, monthly: null },
    });
    // 把时间戳改成 TTL 之前
    const raw = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
    raw["ark:0:coding"].ts = Date.now() - CACHE_TTL_MS - 1;
    writeFileSync(CACHE_PATH, JSON.stringify(raw));
    assert.equal(readCache("ark:0:coding"), null);
});

test("readCache: 损坏 JSON 返回 null（自愈）", () => {
    clearCache();
    writeFileSync(CACHE_PATH, "not a json {{{");
    assert.equal(readCache("ark:0:coding"), null);
});

test("fetchUsageCached: 命中缓存时不调用 fetchFn", async () => {
    clearCache();
    writeCache("ark:0:coding", {
        usage: { rolling: { pct: 50, sec: 1800 }, weekly: null, monthly: null },
    });
    let called = false;
    const result = await fetchUsageCached("ark:0:coding", true, async () => {
        called = true;
        return { rolling: { pct: 99, sec: 0 } };
    });
    assert.equal(called, false);
    assert.equal(result.usage.rolling.pct, 50);
});

test("fetchUsageCached: 未命中时调用 fetchFn 并写缓存", async () => {
    clearCache();
    let called = false;
    const result = await fetchUsageCached("ark:0:coding", true, async () => {
        called = true;
        return { rolling: { pct: 42, sec: 100 }, weekly: null, monthly: null };
    });
    assert.equal(called, true);
    assert.equal(result.usage.rolling.pct, 42);
    // 缓存应已写入
    const hit = readCache("ark:0:coding");
    assert.ok(hit);
    assert.equal(hit.usage.rolling.pct, 42);
});

test("fetchUsageCached: enabled=false 时不读不写缓存", async () => {
    clearCache();
    const result = await fetchUsageCached("ark:0:coding", false, async () => ({
        rolling: { pct: 77, sec: 0 },
        weekly: null,
        monthly: null,
    }));
    assert.equal(result.usage.rolling.pct, 77);
    assert.equal(readCache("ark:0:coding"), null);
});

test("fetchUsageCached: fetchFn 抛错时透传异常、不写缓存", async () => {
    clearCache();
    await assert.rejects(
        fetchUsageCached("ark:0:coding", true, async () => {
            throw new Error("网络错误");
        }),
        /网络错误/,
    );
    assert.equal(readCache("ark:0:coding"), null);
});

test("writeCache: 多键共存于同一文件", () => {
    clearCache();
    writeCache("ark:0:coding", { output: "err1" });
    writeCache("opencode:0", {
        usage: { rolling: { pct: 1, sec: 1 }, weekly: null, monthly: null },
    });
    assert.ok(readCache("ark:0:coding").output);
    assert.ok(readCache("opencode:0").usage);
});

test.after(() => {
    clearCache();
});
