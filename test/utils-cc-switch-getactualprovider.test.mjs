/**
 * @file getActualProviderName 测试
 *
 * 覆盖两条判定路径：
 *   - 环境变量 CC_SWITCH_PROVIDER_ID（cc-launcher 注入）优先，id 无效时降级全局激活
 *   - 无环境变量时读取全局激活供应商 currentProviderClaude
 *
 * 通过 CC_SWITCH_DB_PATH / CC_SWITCH_SETTINGS_PATH 重定向到临时文件，
 * 避免触碰用户真实的 ~/.cc-switch
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    getActualProviderName,
    suppressExperimentalWarning,
} from "../src/utils/utils-cc-switch.mjs";

const APP_TYPE = "claude";
const LAUNCHER_ID = "launcher-prov";
const GLOBAL_ID = "global-prov";

let tmpDir;
let tmpDbPath;
let tmpSettingsPath;
let DatabaseSync;

/** 建表并插入两条测试供应商：启动指定 + 全局激活 */
function seedProviders() {
    const db = new DatabaseSync(tmpDbPath);
    db.exec(`
        CREATE TABLE providers (
            id TEXT, app_type TEXT, name TEXT, settings_config TEXT,
            website_url TEXT, category TEXT, created_at TEXT, sort_index INTEGER,
            notes TEXT, icon TEXT, icon_color TEXT, meta TEXT, is_current INTEGER,
            in_failover_queue INTEGER
        )
    `);
    const insert = db.prepare(
        "INSERT INTO providers (id, app_type, name, settings_config) VALUES (?, ?, ?, ?)",
    );
    insert.run(LAUNCHER_ID, APP_TYPE, "启动指定供应商", "{}");
    insert.run(GLOBAL_ID, APP_TYPE, "全局激活供应商", "{}");
    db.close();
}

/** 写 settings.json，currentProviderClaude 默认指向 global-prov */
function seedSettings(overrides = {}) {
    writeFileSync(
        tmpSettingsPath,
        JSON.stringify({ currentProviderClaude: GLOBAL_ID, ...overrides }),
    );
}

test.before(async () => {
    suppressExperimentalWarning();
    DatabaseSync = (await import("node:sqlite")).DatabaseSync;
    tmpDir = mkdtempSync(join(tmpdir(), "cc-switch-provider-test-"));
    tmpDbPath = join(tmpDir, "cc-switch.db");
    tmpSettingsPath = join(tmpDir, "settings.json");
    process.env.CC_SWITCH_DB_PATH = tmpDbPath;
    process.env.CC_SWITCH_SETTINGS_PATH = tmpSettingsPath;
});

test.after(() => {
    delete process.env.CC_SWITCH_DB_PATH;
    delete process.env.CC_SWITCH_SETTINGS_PATH;
    delete process.env.CC_SWITCH_PROVIDER_ID;
    rmSync(tmpDir, { recursive: true, force: true });
});

test.beforeEach(() => {
    rmSync(tmpDbPath, { force: true });
    seedProviders();
    seedSettings();
    delete process.env.CC_SWITCH_PROVIDER_ID;
});

test("有 CC_SWITCH_PROVIDER_ID 且 db 命中：返回该供应商名", async () => {
    process.env.CC_SWITCH_PROVIDER_ID = LAUNCHER_ID;
    assert.equal(await getActualProviderName(), "启动指定供应商");
});

test("有 CC_SWITCH_PROVIDER_ID 但 db 无此 id：降级到全局激活供应商名", async () => {
    process.env.CC_SWITCH_PROVIDER_ID = "invalid-id";
    assert.equal(await getActualProviderName(), "全局激活供应商");
});

test("无 CC_SWITCH_PROVIDER_ID：读取全局激活供应商名", async () => {
    assert.equal(await getActualProviderName(), "全局激活供应商");
});

test("无环境变量且全局激活供应商不在 db：抛友好错误", async () => {
    seedSettings({ currentProviderClaude: "not-in-db" });
    await assert.rejects(getActualProviderName(), /未在 CC-Switch 数据库中找到/);
});

test("无环境变量且 settings.json 缺 currentProviderClaude：抛错误", async () => {
    writeFileSync(tmpSettingsPath, JSON.stringify({}));
    await assert.rejects(getActualProviderName(), /未检测到 CC-Switch 当前供应商/);
});

test("有 CC_SWITCH_PROVIDER_ID 但 db 读失败：降级到全局（进而读 settings）", async () => {
    // db 不可读 + settings.json 存在但缺 currentProviderClaude + 设 launcherId：
    // launcherId 查 db 抛错应被 catch 降级到全局，进而调 getCurrentProviderId 读 settings
    // 得到 undefined 抛「未检测到 CC-Switch 当前供应商」——证明降级发生；
    // 若不降级（旧行为）会直接抛「数据库读取失败」，断言消息可区分
    process.env.CC_SWITCH_PROVIDER_ID = LAUNCHER_ID;
    rmSync(tmpDbPath, { force: true });
    writeFileSync(tmpSettingsPath, JSON.stringify({}));
    try {
        await assert.rejects(
            getActualProviderName(),
            /未检测到 CC-Switch 当前供应商/,
        );
    } finally {
        // beforeEach 会重建 db 与 settings，无需手动恢复
    }
});
