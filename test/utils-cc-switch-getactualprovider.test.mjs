/**
 * @file getActualProviderName / getAppMode 测试
 *
 * 覆盖直连 / 路由 / 聚合三种模式的判定：
 *   - 直连：环境变量 CC_SWITCH_PROVIDER_ID（cc-launcher 注入）优先，id 无效时降级直连指针
 *   - 路由：live-state.json 的 proxy_route，与直连指针互相独立
 *   - 聚合：固定返回「聚合」
 *   - live-state.json 缺失 / 损坏 / attached=false 时按直连处理
 *   - 注入 CC_SWITCH_PROVIDER_ID（cc-launcher 直连实例）或 base_url 不指向本地代理时忽略 live-state
 *
 * 通过 CC_SWITCH_DB_PATH / CC_SWITCH_SETTINGS_PATH / CC_SWITCH_LIVE_STATE_PATH /
 * CC_CLAUDE_SETTINGS_PATH 重定向到临时文件，避免触碰用户真实配置
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getActualProviderName,
  getAppMode,
  STACK_DISPLAY_NAME,
  suppressExperimentalWarning,
} from "../src/utils/utils-cc-switch.mjs";

const APP_TYPE = "claude";
const LAUNCHER_ID = "launcher-prov";
const GLOBAL_ID = "global-prov";
const ROUTE_ID = "route-prov";

let tmpDir;
let tmpDbPath;
let tmpSettingsPath;
let tmpLiveStatePath;
let tmpClaudeSettingsPath;
let DatabaseSync;

/** 建表并插入测试供应商：启动指定 + 全局激活 + 路由那家 */
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
  insert.run(ROUTE_ID, APP_TYPE, "路由供应商", "{}");
  db.close();
}

/** 写 settings.json，currentProviderClaude 默认指向 global-prov */
function seedSettings(overrides = {}) {
  writeFileSync(
    tmpSettingsPath,
    JSON.stringify({ currentProviderClaude: GLOBAL_ID, ...overrides }),
  );
}

/** 写 live-state.json；传 null 表示不留文件（旧版 / 首次运行） */
function seedLiveState(app) {
  rmSync(tmpLiveStatePath, { force: true });
  if (app === null) {
    return;
  }
  writeFileSync(
    tmpLiveStatePath,
    JSON.stringify({ version: 1, apps: { [APP_TYPE]: app } }),
  );
}

/** 写客户端 ~/.claude/settings.json；传 null 表示不留文件（按直连处理） */
function seedClientSettings(baseUrl) {
  rmSync(tmpClaudeSettingsPath, { force: true });
  if (baseUrl === null) {
    return;
  }
  writeFileSync(
    tmpClaudeSettingsPath,
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: baseUrl } }),
  );
}

test.before(async () => {
  suppressExperimentalWarning();
  DatabaseSync = (await import("node:sqlite")).DatabaseSync;
  tmpDir = mkdtempSync(join(tmpdir(), "cc-switch-provider-test-"));
  tmpDbPath = join(tmpDir, "cc-switch.db");
  tmpSettingsPath = join(tmpDir, "settings.json");
  tmpLiveStatePath = join(tmpDir, "live-state.json");
  tmpClaudeSettingsPath = join(tmpDir, "claude-settings.json");
  process.env.CC_SWITCH_DB_PATH = tmpDbPath;
  process.env.CC_SWITCH_SETTINGS_PATH = tmpSettingsPath;
  process.env.CC_SWITCH_LIVE_STATE_PATH = tmpLiveStatePath;
  process.env.CC_CLAUDE_SETTINGS_PATH = tmpClaudeSettingsPath;
});

test.after(() => {
  delete process.env.CC_SWITCH_DB_PATH;
  delete process.env.CC_SWITCH_SETTINGS_PATH;
  delete process.env.CC_SWITCH_LIVE_STATE_PATH;
  delete process.env.CC_CLAUDE_SETTINGS_PATH;
  delete process.env.CC_SWITCH_PROVIDER_ID;
  rmSync(tmpDir, { recursive: true, force: true });
});

test.beforeEach(() => {
  rmSync(tmpDbPath, { force: true });
  seedProviders();
  seedSettings();
  seedLiveState(null);
  // 默认客户端指向本地代理：继承的 ANTHROPIC_BASE_URL 会干扰判定，先清掉
  delete process.env.ANTHROPIC_BASE_URL;
  seedClientSettings("http://127.0.0.1:15721");
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
  await assert.rejects(getActualProviderName(), /未在 CC Switch 数据库中找到/);
});

test("无环境变量且 settings.json 缺 currentProviderClaude：抛错误", async () => {
  writeFileSync(tmpSettingsPath, JSON.stringify({}));
  await assert.rejects(getActualProviderName(), /未检测到 CC Switch 当前供应商/);
});

test("有 CC_SWITCH_PROVIDER_ID 但 db 读失败：降级到全局（进而读 settings）", async () => {
  // db 不可读 + settings.json 存在但缺 currentProviderClaude + 设 launcherId：
  // launcherId 查 db 抛错应被 catch 降级到全局，进而调 getCurrentProviderId 读 settings
  // 得到 undefined 抛「未检测到 CC Switch 当前供应商」——证明降级发生；
  // 若不降级（旧行为）会直接抛「数据库读取失败」，断言消息可区分
  process.env.CC_SWITCH_PROVIDER_ID = LAUNCHER_ID;
  rmSync(tmpDbPath, { force: true });
  writeFileSync(tmpSettingsPath, JSON.stringify({}));
  try {
    await assert.rejects(
      getActualProviderName(),
      /未检测到 CC Switch 当前供应商/,
    );
  } finally {
    // beforeEach 会重建 db 与 settings，无需手动恢复
  }
});

test("getAppMode: live-state 缺失按直连", () => {
  assert.equal(getAppMode(), "direct");
});

test("getAppMode: mode=proxy 且 attached=true 为路由", () => {
  seedLiveState({ mode: "proxy", attached: true, proxy_route: ROUTE_ID });
  assert.equal(getAppMode(), "route");
});

test("getAppMode: mode=proxy 但 attached=false 按直连（客户端已指回直连）", () => {
  seedLiveState({ mode: "proxy", attached: false, proxy_route: ROUTE_ID });
  assert.equal(getAppMode(), "direct");
});

test("getAppMode: stack.enabled=true 为聚合", () => {
  seedLiveState({
    mode: "proxy",
    attached: true,
    proxy_route: ROUTE_ID,
    stack: { enabled: true, members: [ROUTE_ID], keys: {} },
  });
  assert.equal(getAppMode(), "stack");
});

test("getAppMode: stack 未启用时为路由", () => {
  seedLiveState({
    mode: "proxy",
    attached: true,
    proxy_route: ROUTE_ID,
    stack: { members: [ROUTE_ID], keys: {} },
  });
  assert.equal(getAppMode(), "route");
});

test("getAppMode: live-state 内容损坏按直连", () => {
  writeFileSync(tmpLiveStatePath, "{ not json");
  assert.equal(getAppMode(), "direct");
});

test("路由模式：取 live-state 的 proxy_route，而非直连指针", async () => {
  seedLiveState({ mode: "proxy", attached: true, proxy_route: ROUTE_ID });
  assert.equal(await getActualProviderName(), "路由供应商");
});

test("聚合模式：返回「聚合」，即使匹配不到唯一供应商", async () => {
  seedLiveState({
    mode: "proxy",
    attached: true,
    proxy_route: ROUTE_ID,
    stack: { enabled: true, members: [ROUTE_ID], keys: {} },
  });
  assert.equal(await getActualProviderName(), STACK_DISPLAY_NAME);
});

test("有 launcherId 时按直连实例处理：即使全局处于路由模式", async () => {
  process.env.CC_SWITCH_PROVIDER_ID = LAUNCHER_ID;
  seedLiveState({ mode: "proxy", attached: true, proxy_route: ROUTE_ID });
  assert.equal(getAppMode(), "direct");
  assert.equal(await getActualProviderName(), "启动指定供应商");
});

test("attached=false：回退直连指针", async () => {
  seedLiveState({ mode: "proxy", attached: false, proxy_route: ROUTE_ID });
  assert.equal(await getActualProviderName(), "全局激活供应商");
});

test("proxy_route 在库中查不到：降级直连指针", async () => {
  seedLiveState({
    mode: "proxy",
    attached: true,
    proxy_route: "not-in-db",
  });
  assert.equal(await getActualProviderName(), "全局激活供应商");
});

test("proxy_route 缺失：降级直连指针", async () => {
  seedLiveState({ mode: "proxy", attached: true });
  assert.equal(await getActualProviderName(), "全局激活供应商");
});

test("客户端 base_url 非本地：忽略 live-state 路由，按直连实例判定", async () => {
  process.env.CC_SWITCH_PROVIDER_ID = LAUNCHER_ID;
  seedLiveState({ mode: "proxy", attached: true, proxy_route: ROUTE_ID });
  seedClientSettings("https://api.deepseek.com");
  assert.equal(getAppMode(), "direct");
  assert.equal(await getActualProviderName(), "启动指定供应商");
});

test("客户端 base_url 非本地：忽略 live-state 聚合状态", async () => {
  seedLiveState({
    mode: "proxy",
    attached: true,
    proxy_route: ROUTE_ID,
    stack: { enabled: true, members: [ROUTE_ID], keys: {} },
  });
  seedClientSettings("https://api.deepseek.com");
  assert.equal(getAppMode(), "direct");
  assert.equal(await getActualProviderName(), "全局激活供应商");
});

test("进程环境变量的 base_url 优先于客户端 settings.json", () => {
  seedLiveState({ mode: "proxy", attached: true, proxy_route: ROUTE_ID });
  seedClientSettings("https://api.deepseek.com");
  process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:15721";
  try {
    assert.equal(getAppMode(), "route");
  } finally {
    delete process.env.ANTHROPIC_BASE_URL;
  }
});
