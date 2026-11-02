/**
 * @file query-usage-smart 聚合分支测试
 *
 * 起子进程跑 CLI（config / live-state / cc-switch 配置全部重定向到临时文件）：
 *   - 聚合模式：查 config 里全部账号（两个空 apiKey 账号 → 两行错误，不触网）
 *   - 直连模式：走 getAPIKey，settings 缺失 → 单行 ❌
 * 断言两者输出行数不同，证明聚合分支确实生效
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(
    new URL("../src/query/query-usage-smart.mjs", import.meta.url),
);
const APP_TYPE = "claude";

let tmpDir;
let tmpConfigPath;
let tmpLiveStatePath;

/** 子进程环境：清掉真实配置影响，全部指向临时文件 */
function runCli() {
    const env = { ...process.env };
    delete env.CC_SWITCH_PROVIDER_ID;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;
    env.CC_CONFIG_PATH = tmpConfigPath;
    env.CC_SWITCH_LIVE_STATE_PATH = tmpLiveStatePath;
    env.CC_SWITCH_SETTINGS_PATH = "__nonexistent_settings__";
    env.CC_SWITCH_DB_PATH = "__nonexistent_db__";
    // 客户端指向本地代理：getAppMode 才会读 live-state
    env.ANTHROPIC_BASE_URL = "http://127.0.0.1:15721";
    return execFileSync(process.execPath, [SCRIPT, "-d", "s"], {
        env,
        encoding: "utf-8",
        input: "",
        // 子进程卡住时及时失败，避免测试挂死
        timeout: 30_000,
    });
}

test.before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "smart-stack-test-"));
    tmpConfigPath = join(tmpDir, "config.json");
    tmpLiveStatePath = join(tmpDir, "live-state.json");
    // 两个空 apiKey 账号：缺凭据直接渲染错误行，不发网络请求
    writeFileSync(
        tmpConfigPath,
        JSON.stringify({ opencode: [{ apiKey: "" }, { apiKey: "" }] }),
    );
});

test.after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
});

test("聚合模式：查询全部账号（两行）", () => {
    writeFileSync(
        tmpLiveStatePath,
        JSON.stringify({
            version: 1,
            apps: {
                [APP_TYPE]: {
                    mode: "proxy",
                    attached: true,
                    proxy_route: "route-prov",
                    stack: { enabled: true, members: [], keys: {} },
                },
            },
        }),
    );
    const lines = runCli().trim().split("\n");
    assert.equal(lines.length, 2);
    assert.ok(lines.every((line) => line.includes("配置缺少 apiKey")));
});

test("非聚合模式（直连）：不走全部账号分支", () => {
    writeFileSync(
        tmpLiveStatePath,
        JSON.stringify({
            version: 1,
            apps: { [APP_TYPE]: { mode: "direct" } },
        }),
    );
    const lines = runCli().trim().split("\n");
    assert.equal(lines.length, 1);
    assert.ok(lines[0].startsWith("❌"));
});
