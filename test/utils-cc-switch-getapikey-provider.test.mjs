/**
 * @file getAPIKey 供应商 id 解析单元测试
 *
 * 覆盖 db 分支的供应商 id 解析（envKey 无效时）：
 *   - CC_SWITCH_PROVIDER_ID（cc-launcher 注入）优先，命中 db 返回该供应商 key
 *   - 该 id 在 db 中查不到时降级到全局激活供应商
 *   - 无环境变量时走全局激活供应商
 *   - envKey（含 PROXY_MANAGED 占位符回退）优先于 launcherId
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
    getAPIKey,
    suppressExperimentalWarning,
} from "../src/utils/utils-cc-switch.mjs";

const APP_TYPE = "claude";
const LAUNCHER_ID = "launcher-prov";
const GLOBAL_ID = "global-prov";
const LAUNCHER_KEY = "sk-launcher-real";
const GLOBAL_KEY = "sk-global-real";

let tmpDir;
let tmpDbPath;
let tmpSettingsPath;
let DatabaseSync;

/** 建表并插入两条测试供应商，各自 settings_config.env 含不同真实 token */
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
    insert.run(
        LAUNCHER_ID,
        APP_TYPE,
        "启动指定供应商",
        JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: LAUNCHER_KEY } }),
    );
    insert.run(
        GLOBAL_ID,
        APP_TYPE,
        "全局激活供应商",
        JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: GLOBAL_KEY } }),
    );
    db.close();
}

/** 写 settings.json，currentProviderClaude 默认指向 global-prov */
function seedSettings(overrides = {}) {
    writeFileSync(
        tmpSettingsPath,
        JSON.stringify({ currentProviderClaude: GLOBAL_ID, ...overrides }),
    );
}

/** 备份并清理 token 环境变量，返回恢复函数 */
function withTokenEnv(overrides) {
    const prev = {
        ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    };
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    Object.assign(process.env, overrides);
    return () => {
        for (const [k, v] of Object.entries(prev)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    };
}

test.before(async () => {
    suppressExperimentalWarning();
    DatabaseSync = (await import("node:sqlite")).DatabaseSync;
    tmpDir = mkdtempSync(join(tmpdir(), "cc-switch-getapikey-prov-"));
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

test("getAPIKey: CC_SWITCH_PROVIDER_ID 命中 db 返回该供应商 key", async () => {
    const restore = withTokenEnv({});
    process.env.CC_SWITCH_PROVIDER_ID = LAUNCHER_ID;
    try {
        assert.equal(await getAPIKey(), LAUNCHER_KEY);
    } finally {
        restore();
    }
});

test("getAPIKey: CC_SWITCH_PROVIDER_ID 在 db 中查不到时降级到全局供应商 key", async () => {
    const restore = withTokenEnv({});
    process.env.CC_SWITCH_PROVIDER_ID = "invalid-id";
    try {
        assert.equal(await getAPIKey(), GLOBAL_KEY);
    } finally {
        restore();
    }
});

test("getAPIKey: 无 CC_SWITCH_PROVIDER_ID 走全局激活供应商 key", async () => {
    const restore = withTokenEnv({});
    try {
        assert.equal(await getAPIKey(), GLOBAL_KEY);
    } finally {
        restore();
    }
});

test("getAPIKey: 真实 envKey 优先于 CC_SWITCH_PROVIDER_ID，不碰 db", async () => {
    const restore = withTokenEnv({ ANTHROPIC_AUTH_TOKEN: "sk-env-real" });
    process.env.CC_SWITCH_PROVIDER_ID = LAUNCHER_ID;
    try {
        assert.equal(await getAPIKey(), "sk-env-real");
    } finally {
        restore();
    }
});

test("getAPIKey: PROXY_MANAGED 占位符回退 db，用 launcherId 取真实 key", async () => {
    // 代理模式：envKey 为 PROXY_MANAGED 占位符，应走 db 分支取真实 token
    const restore = withTokenEnv({ ANTHROPIC_AUTH_TOKEN: "PROXY_MANAGED" });
    process.env.CC_SWITCH_PROVIDER_ID = LAUNCHER_ID;
    try {
        assert.equal(await getAPIKey(), LAUNCHER_KEY);
    } finally {
        restore();
    }
});