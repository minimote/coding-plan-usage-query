/**
 * @file utils-cc-switch 集成测试
 *
 * 用临时 SQLite 文件验证 lookupProviderInDb 的查询逻辑，
 * 并守护「db 损坏时抛出友好错误」的行为（catch 包装为 CC-Switch 数据库读取失败）
 *
 * 通过 CC_SWITCH_DB_PATH 环境变量将 db 路径重定向到临时文件，
 * 避免触碰用户真实的 ~/.cc-switch/cc-switch.db
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { lookupProviderInDb } from "../src/utils/utils-cc-switch.mjs";

const APP_TYPE = "claude";

let tmpDir;
let tmpDbPath;

/**
 * 建表并可选插入一行测试数据
 *
 * @param {{ id: string, app_type: string, name: string, settings_config: string } | null} row
 */
function seedProvider(row) {
    const db = new DatabaseSync(tmpDbPath);
    db.exec(`
        CREATE TABLE providers (
            id TEXT, app_type TEXT, name TEXT, settings_config TEXT,
            website_url TEXT, category TEXT, created_at TEXT, sort_index INTEGER,
            notes TEXT, icon TEXT, icon_color TEXT, meta TEXT, is_current INTEGER,
            in_failover_queue INTEGER
        )
    `);
    if (row) {
        db.prepare(
            "INSERT INTO providers (id, app_type, name, settings_config) VALUES (?, ?, ?, ?)",
        ).run(row.id, row.app_type, row.name, row.settings_config);
    }
    db.close();
}

test.before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cc-switch-test-"));
    tmpDbPath = join(tmpDir, "cc-switch.db");
    process.env.CC_SWITCH_DB_PATH = tmpDbPath;
});

test.after(() => {
    delete process.env.CC_SWITCH_DB_PATH;
    rmSync(tmpDir, { recursive: true, force: true });
});

test.beforeEach(() => {
    rmSync(tmpDbPath, { force: true });
});

test("lookupProviderInDb: 命中匹配的供应商返回完整行", async () => {
    seedProvider({
        id: "prov-1",
        app_type: APP_TYPE,
        name: "测试供应商",
        settings_config: JSON.stringify({
            env: { ANTHROPIC_AUTH_TOKEN: "sk-xxx" },
        }),
    });
    const row = await lookupProviderInDb("prov-1");
    assert.ok(row, "应返回行");
    assert.equal(row.id, "prov-1");
    assert.equal(row.app_type, APP_TYPE);
    assert.equal(row.name, "测试供应商");
    const cfg = JSON.parse(row.settings_config);
    assert.equal(cfg.env.ANTHROPIC_AUTH_TOKEN, "sk-xxx");
});

test("lookupProviderInDb: 不存在的 id 返回 null", async () => {
    seedProvider({
        id: "prov-1",
        app_type: APP_TYPE,
        name: "测试供应商",
        settings_config: "{}",
    });
    const row = await lookupProviderInDb("not-exist");
    assert.equal(row, null);
});

test("lookupProviderInDb: app_type 不匹配时返回 null", async () => {
    seedProvider({
        id: "prov-1",
        app_type: "codex",
        name: "其他应用",
        settings_config: "{}",
    });
    const row = await lookupProviderInDb("prov-1");
    assert.equal(row, null);
});

test("lookupProviderInDb: db 损坏时抛出友好错误", async () => {
    writeFileSync(tmpDbPath, "not a sqlite file {{{");
    await assert.rejects(
        lookupProviderInDb("prov-1"),
        /CC-Switch 数据库读取失败/,
    );
});
