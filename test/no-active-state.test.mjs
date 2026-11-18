/**
 * @file 无活跃套餐状态记忆单元测试
 *
 * 覆盖：无订阅错误写入状态、瞬时故障沿用状态隐藏、重新查到用量清除状态、
 * 状态过期与未开启 hideOnNoActivePlan 时正常显示错误
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "cc-no-active-test-"));
process.env.CC_USAGE_CACHE_PATH = join(TMP, "cache-usage.json");
process.env.CC_NO_ACTIVE_STATE_PATH = join(TMP, "no-active-state.json");

const {
    runQueryUsage,
    hasRecentNoActiveState,
    clearNoActiveState,
    hashCredential,
    NO_ACTIVE_STATE_TTL_MS,
} = await import("../src/utils/utils-query-usage.mjs");

const STATE_PATH = process.env.CC_NO_ACTIVE_STATE_PATH;
// 缓存键为凭据哈希，测试账号的 apiKey 为 "k"
const KEY = `ark:${hashCredential("k")}`;
const CFG = { ark: [{ apiKey: "k" }] };
const BASE = { position: 0, _config: CFG, cache: false };
const LABELS = { long: "测试", short: "测" };

function makeSpec(fetchUsage) {
    return {
        key: "ark",
        defaultLabels: LABELS,
        readCredential: (a) => a.apiKey,
        missingCredential: "缺少 apiKey",
        fetchUsage,
        labels: () => LABELS,
    };
}

/** 预置一条「刚刚确认无订阅」的状态 */
function seedNoActive(ts = Date.now()) {
    writeFileSync(STATE_PATH, JSON.stringify({ [KEY]: { ts } }));
}

/** 构造瞬时故障（超时） */
function timeoutError() {
    const err = new Error("请求超时");
    err.name = "TimeoutError";
    return err;
}

test.after(() => {
    rmSync(TMP, { recursive: true, force: true });
});

test("无活跃套餐错误：输出错误行并写入状态", async () => {
    rmSync(STATE_PATH, { force: true });
    const out = await runQueryUsage(
        makeSpec(async () => {
            throw new Error("无活跃套餐");
        }),
        { ...BASE, hideOnNoActivePlan: true },
    );
    assert.match(out, /❌/);
    assert.equal(hasRecentNoActiveState(KEY), true);
});

test("瞬时故障且最近确认无订阅：隐藏", async () => {
    seedNoActive();
    const out = await runQueryUsage(
        makeSpec(async () => {
            throw timeoutError();
        }),
        { ...BASE, hideOnNoActivePlan: true },
    );
    assert.equal(out, "");
});

test("瞬时故障但没有无订阅状态：正常显示错误", async () => {
    rmSync(STATE_PATH, { force: true });
    const out = await runQueryUsage(
        makeSpec(async () => {
            throw timeoutError();
        }),
        { ...BASE, hideOnNoActivePlan: true },
    );
    assert.match(out, /❌/);
});

test("瞬时故障且无订阅状态已过期：正常显示错误", async () => {
    seedNoActive(Date.now() - NO_ACTIVE_STATE_TTL_MS - 1000);
    const out = await runQueryUsage(
        makeSpec(async () => {
            throw timeoutError();
        }),
        { ...BASE, hideOnNoActivePlan: true },
    );
    assert.match(out, /❌/);
});

test("重复观测无订阅：保留原 ts 不续期", async () => {
    const ts = Date.now() - NO_ACTIVE_STATE_TTL_MS + 60_000;
    seedNoActive(ts);
    await runQueryUsage(
        makeSpec(async () => {
            throw new Error("无活跃套餐");
        }),
        { ...BASE, hideOnNoActivePlan: true },
    );
    const state = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    assert.equal(state[KEY].ts, ts);
});

test("未来时间戳（时钟回拨）视为过期：正常显示错误", async () => {
    seedNoActive(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const out = await runQueryUsage(
        makeSpec(async () => {
            throw timeoutError();
        }),
        { ...BASE, hideOnNoActivePlan: true },
    );
    assert.match(out, /❌/);
});

test("未开启 hideOnNoActivePlan：即使有无订阅状态也显示错误", async () => {
    seedNoActive();
    const out = await runQueryUsage(
        makeSpec(async () => {
            throw timeoutError();
        }),
        { ...BASE, hideOnNoActivePlan: false },
    );
    assert.match(out, /❌/);
});

test("查询成功：显示用量并清除无订阅状态", async () => {
    seedNoActive();
    const out = await runQueryUsage(
        makeSpec(async () => ({ rolling: { pct: 10, sec: 60 } })),
        BASE,
    );
    assert.ok(out.length > 0);
    assert.equal(hasRecentNoActiveState(KEY), false);
});

test("凭据缺失不受无订阅状态影响：仍显示错误", async () => {
    seedNoActive();
    const out = await runQueryUsage(
        {
            ...makeSpec(async () => ({ rolling: { pct: 10, sec: 60 } })),
            readCredential: () => "",
        },
        { ...BASE, hideOnNoActivePlan: true },
    );
    assert.match(out, /缺少 apiKey/);
    // 凭据类错误不改变无订阅状态
    assert.equal(hasRecentNoActiveState(KEY), true);
});

test("负缓存命中且最近无订阅：隐藏", async () => {
    seedNoActive();
    const opts = { ...BASE, cache: true, hideOnNoActivePlan: true };
    // 第一次：瞬时故障，写负缓存
    const first = await runQueryUsage(
        makeSpec(async () => {
            throw timeoutError();
        }),
        opts,
    );
    assert.equal(first, "");
    // 第二次：命中负缓存，仍按无订阅隐藏
    const second = await runQueryUsage(
        makeSpec(async () => ({ rolling: { pct: 10, sec: 60 } })),
        opts,
    );
    assert.equal(second, "");
});

test("clearNoActiveState：无记录时不创建文件", () => {
    rmSync(STATE_PATH, { force: true });
    clearNoActiveState(KEY);
    assert.throws(() => readFileSync(STATE_PATH, "utf-8"));
});
