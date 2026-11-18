/**
 * @file 状态/缓存文件跨进程并发写回归测试
 *
 * 多进程同时读-改-写同一文件：加锁 + 原子写后所有账号的条目都应保留
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashCredential } from "../src/utils/utils-query-usage.mjs";

const execFileAsync = promisify(execFile);
const TMP = mkdtempSync(join(tmpdir(), "cc-state-concurrency-test-"));
const STATE_PATH = join(TMP, "no-active-state.json");
const CACHE_PATH = join(TMP, "cache-usage.json");
const MODULE_URL = pathToFileURL(
    join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "src",
        "utils",
        "utils-query-usage.mjs",
    ),
).href;
const N = 8;

// 每个子进程：账号 0 触发「无活跃套餐」写状态，账号 1 成功查询写缓存
const CHILD_SCRIPT = `
import { runQueryUsage } from ${JSON.stringify(MODULE_URL)};
const spec = (fetchUsage) => ({
    key: "ark",
    defaultLabels: { long: "t", short: "t" },
    readCredential: (a) => a.apiKey,
    missingCredential: "缺凭据",
    fetchUsage,
});
await runQueryUsage(
    spec(async () => {
        throw new Error("无活跃套餐");
    }),
    {
        position: 0,
        _config: { ark: [{ apiKey: process.env.K1 }] },
        hideOnNoActivePlan: true,
    },
);
await runQueryUsage(
    spec(async () => ({ rolling: { pct: 1, sec: 60 } })),
    {
        position: 1,
        cache: true,
        _config: {
            ark: [{ apiKey: process.env.K1 }, { apiKey: process.env.K2 }],
        },
    },
);
`;

test.after(() => {
    rmSync(TMP, { recursive: true, force: true });
});

test("多进程并发写状态与缓存：条目不丢失、无残留锁", async () => {
    const baseEnv = {
        ...process.env,
        CC_NO_ACTIVE_STATE_PATH: STATE_PATH,
        CC_USAGE_CACHE_PATH: CACHE_PATH,
    };
    await Promise.all(
        Array.from({ length: N }, (_, i) =>
            execFileAsync(
                process.execPath,
                ["--input-type=module", "-e", CHILD_SCRIPT],
                { env: { ...baseEnv, K1: `n${i}`, K2: `c${i}` } },
            ),
        ),
    );

    const state = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    const cache = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
    for (let i = 0; i < N; i++) {
        assert.ok(
            state[`ark:${hashCredential(`n${i}`)}`],
            `状态键 n${i} 不应丢失`,
        );
        assert.ok(
            cache[`ark:${hashCredential(`c${i}`)}`],
            `缓存键 c${i} 不应丢失`,
        );
    }
    assert.equal(existsSync(`${STATE_PATH}.lock`), false, "不应残留锁文件");
    assert.equal(existsSync(`${CACHE_PATH}.lock`), false, "不应残留锁文件");
});
