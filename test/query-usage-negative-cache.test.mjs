/**
 * @file 负缓存门控（reachedFetch）单元测试
 *
 * 守护「配置类错误不写负缓存」的行为：用必然越界的 position 触发 config 阶段错误
 * （loadConfig/findAccount），断言返回错误行且不写负缓存。
 *
 * 使用独立的大 position 键（不与 cache.test.mjs 的键重叠），本测试只读缓存文件、
 * 不清空，避免与并行的 cache.test.mjs 互相干扰；即便有残留键也会在 5 秒 TTL 后自愈。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readCache } from "../src/utils/utils-query-usage.mjs";
import { queryUsage as queryArk } from "../src/query/query-usage-ark.mjs";
import { queryUsage as queryOpencode } from "../src/query/query-usage-opencode-go.mjs";
import { queryUsage as queryQwen } from "../src/query/query-usage-qwen.mjs";

/** 必然越界的 position：无论真实 config 有多少账号都触发 findAccount 阶段错误 */
const OOB = 999999;

test("ark: config 阶段错误（position 越界）返回错误行且不写负缓存", async () => {
    const out = await queryArk({ position: OOB, cache: true });
    assert.ok(out.includes("❌"), "应返回错误行");
    assert.equal(readCache(`ark:${OOB}:coding`), null, "不应写负缓存");
});

test("opencode: config 阶段错误（position 越界）返回错误行且不写负缓存", async () => {
    const out = await queryOpencode({ position: OOB, cache: true });
    assert.ok(out.includes("❌"), "应返回错误行");
    assert.equal(readCache(`opencode:${OOB}`), null, "不应写负缓存");
});

test("qwen: config 阶段错误（position 越界）返回错误行且不写负缓存", async () => {
    const out = await queryQwen({ position: OOB, cache: true });
    assert.ok(out.includes("❌"), "应返回错误行");
    assert.equal(readCache(`qwen:${OOB}`), null, "不应写负缓存");
});
