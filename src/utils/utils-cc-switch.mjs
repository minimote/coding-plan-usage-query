/**
 * @file CC Switch 相关工具
 *
 * 读取 ~/.cc-switch 的 settings.json、live-state.json 与 cc-switch.db
 * 提供当前供应商识别与 API Key 读取
 *
 * CC Switch 4.0 起直连 / 路由 / 聚合三种模式下「当前供应商」的存放位置不同：
 *   - 直连：settings.json 的 currentProviderClaude（直连指针）
 *   - 路由：live-state.json 的 apps.claude.proxy_route
 *   - 聚合：proxy_route 是默认那家，状态栏只显示「聚合」
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CC_SWITCH_DIR = join(homedir(), ".cc-switch");
const SETTINGS_PATH = join(CC_SWITCH_DIR, "settings.json");
const LIVE_STATE_PATH = join(CC_SWITCH_DIR, "live-state.json");
const DB_PATH = join(CC_SWITCH_DIR, "cc-switch.db");
const APP_TYPE = "claude";
const CURRENT_PROVIDER_FIELD = "currentProviderClaude";

/** cc-launcher 启动时注入的供应商 id 环境变量 */
const LAUNCHER_PROVIDER_ID_ENV = "CC_SWITCH_PROVIDER_ID";

/** 应用的实际模式 */
export const MODE = Object.freeze({
  DIRECT: "direct",
  ROUTE: "route",
  STACK: "stack",
});

/** 聚合模式在状态栏的显示名 */
export const STACK_DISPLAY_NAME = "聚合";

/** DatabaseSync 构造器，首次调用 openDb 时动态加载 */
let DatabaseSync;

/**
 * 覆盖 process.emitWarning 屏蔽 ExperimentalWarning
 *
 * node:sqlite 的实验性警告在模块加载时触发，静态 import 无法拦截；
 * 动态 import 前调用本函数，可只过滤实验性警告，其他警告（如 DeprecationWarning）仍正常输出
 */
export function suppressExperimentalWarning() {
  const orig = process.emitWarning;
  process.emitWarning = function (warning, options) {
    const type = typeof options === "string" ? options : options?.type;
    if (type === "ExperimentalWarning") {
      return;
    }
    return orig.call(this, warning, options);
  };
}

/**
 * 读取 ~/.cc-switch/settings.json
 *
 * @returns {object} settings.json 内容
 */
function readSettings() {
  // 测试可通过 CC_SWITCH_SETTINGS_PATH 重定向到临时 settings.json，避免触碰真实 ~/.cc-switch
  const settingsPath = process.env.CC_SWITCH_SETTINGS_PATH || SETTINGS_PATH;
  return JSON.parse(readFileSync(settingsPath, "utf-8"));
}

/**
 * 读取 ~/.cc-switch/live-state.json
 *
 * 文件不存在（旧版 CC Switch 或还没运行过）或内容损坏时返回 null，调用方按直连处理
 *
 * @returns {object | null} 状态文件内容
 */
function readLiveState() {
  // 测试可通过 CC_SWITCH_LIVE_STATE_PATH 重定向到临时 live-state.json
  const path = process.env.CC_SWITCH_LIVE_STATE_PATH || LIVE_STATE_PATH;
  try {
    const state = JSON.parse(readFileSync(path, "utf-8"));
    return state && typeof state === "object" ? state : null;
  } catch {
    return null;
  }
}

/**
 * 读取本应用在 live-state.json 里的状态条目
 *
 * @returns {object} 条目；不存在时为空对象
 */
function appState() {
  return readLiveState()?.apps?.[APP_TYPE] || {};
}

/**
 * 本应用的实际模式
 *
 * 先看客户端是否走本设备的 CC Switch 代理：cc-launcher 可以直接以某家供应商启动实例，
 * 那时全局的 live-state 与这个实例无关
 * - 有 CC_SWITCH_PROVIDER_ID 注入，或 base_url 不是本机地址：直连（含 CC Switch 退出时分离）
 * - mode 不是 proxy（含字段缺失）：直连
 * - proxy 但 attached 为假：CC Switch 已把客户端指回直连
 * - proxy 且 stack.enabled：聚合
 * - 其余：路由
 *
 * @returns {"direct" | "route" | "stack"}
 */
export function getAppMode() {
  return modeFrom(appState());
}

/**
 * 由一个 live-state 条目判定模式（含客户端 base_url 闸门）
 *
 * @param {object} app apps.<app> 条目
 * @returns {"direct" | "route" | "stack"}
 */
function modeFrom(app) {
  return clientUsesProxy() ? modeOf(app) : MODE.DIRECT;
}

/**
 * 由 live-state 条目判定模式（不含客户端 base_url 判定）
 *
 * @param {object} app apps.<app> 条目
 * @returns {"direct" | "route" | "stack"}
 */
function modeOf(app) {
  if (app.mode !== "proxy" || app.attached !== true) {
    return MODE.DIRECT;
  }
  return app.stack?.enabled === true ? MODE.STACK : MODE.ROUTE;
}

/** 是否指向本机地址的 URL */
function isLocalUrl(url) {
  return /:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(
    url || "",
  );
}

/**
 * 当前客户端是否走本设备的 CC Switch 代理
 *
 * cc-launcher 注入 CC_SWITCH_PROVIDER_ID 说明这是它按某家供应商直接启动的实例，
 * 与全局的路由 / 聚合状态无关；否则看 base_url 是否指向本机地址（进程环境变量优先，
 * 其次 ~/.claude/settings.json）
 *
 * @returns {boolean}
 */
function clientUsesProxy() {
  if (process.env[LAUNCHER_PROVIDER_ID_ENV]) {
    return false;
  }
  if (process.env.ANTHROPIC_BASE_URL) {
    return isLocalUrl(process.env.ANTHROPIC_BASE_URL);
  }
  // 测试可通过 CC_CLAUDE_SETTINGS_PATH 重定向到临时 Claude settings.json
  const path =
    process.env.CC_CLAUDE_SETTINGS_PATH ||
    join(homedir(), ".claude", "settings.json");
  try {
    const cfg = JSON.parse(readFileSync(path, "utf-8"));
    return isLocalUrl(cfg?.env?.ANTHROPIC_BASE_URL);
  } catch {
    return false;
  }
}

/**
 * 打开 ~/.cc-switch/cc-switch.db
 *
 * 首次调用时动态加载 node:sqlite（加载前屏蔽实验性警告）
 *
 * @returns {Promise<DatabaseSync>}
 */
async function openDb() {
  if (!DatabaseSync) {
    suppressExperimentalWarning();
    DatabaseSync = (await import("node:sqlite")).DatabaseSync;
  }
  // 测试可通过 CC_SWITCH_DB_PATH 重定向到临时 db，避免触碰真实 ~/.cc-switch
  const dbPath = process.env.CC_SWITCH_DB_PATH || DB_PATH;
  return new DatabaseSync(dbPath, { readOnly: true });
}

/**
 * 获取当前供应商 id（直连指针）
 *
 * 读 ~/.cc-switch/settings.json 的 currentProviderClaude。CC Switch 4.0 起它只代表直连
 * 模式写进客户端的那家：路由 / 聚合模式下实际使用的供应商在 live-state.json，见
 * getAppMode 与 getCurrentProviderRow
 *
 * @returns {string} 供应商 id
 * @throws {Error} settings.json 不存在或 currentProviderClaude 为空
 */
export function getCurrentProviderId() {
  const id = readSettings()[CURRENT_PROVIDER_FIELD];
  if (!id) {
    throw new Error(
      "未检测到 CC Switch 当前供应商 (settings.json 缺少 currentProviderClaude)",
    );
  }
  return id;
}

/**
 * 查 cc-switch.db 读取指定供应商的完整行
 *
 * @param {string} id 供应商 id
 * @returns {Promise<object|null>} 供应商行；settings_config / meta 为 JSON 字符串，调用方按需解析，找不到返回 null
 * @throws {Error} db 不存在或读取失败
 */
export async function lookupProviderInDb(id) {
  let db;
  try {
    db = await openDb();
    return (
      db
        .prepare(
          "SELECT id, app_type, name, settings_config, website_url, category, " +
            "created_at, sort_index, notes, icon, icon_color, meta, is_current, " +
            "in_failover_queue FROM providers WHERE id = ? AND app_type = ?",
        )
        .get(id, APP_TYPE) || null
    );
  } catch (e) {
    throw new Error(`CC Switch 数据库读取失败: ${e.message}`, { cause: e });
  } finally {
    db?.close();
  }
}

/**
 * 解析当前实际使用的供应商 db 行
 *
 * 代理模式（路由 / 聚合）下读 live-state.json 的 proxy_route：它和直连指针互相独立，
 * 切换供应商时只改它、不动 settings.json；聚合模式下它是默认那家。查无此行时降级到
 * 直连，与 CC Switch 自身的判定一致；db 读失败照常抛出（同 CC Switch）。
 *
 * 直连模式下优先 cc-launcher 注入的 CC_SWITCH_PROVIDER_ID：该 id 查无此行或 db 读失败
 * 时降级到 settings.json 的直连指针；全局供应商查无此行返回 null，db 读失败抛错
 * （无从降级）
 *
 * @param {"direct" | "route" | "stack"} [mode] 已知模式，缺省时自行读取
 * @returns {Promise<object|null>} 供应商行；查无此行时返回 null
 * @throws {Error} 直连指针缺失，或代理路由 / 直连供应商 db 读失败时抛出
 */
async function getCurrentProviderRow(mode) {
  // 模式与路由取自同一份 live-state 快照，避免两次读取之间状态变化
  const app = appState();
  const current = mode ?? modeFrom(app);
  if (current !== MODE.DIRECT) {
    const routeId = app.proxy_route;
    if (routeId) {
      const row = await lookupProviderInDb(routeId);
      if (row) {
        return row;
      }
    }
  }
  const launcherId = process.env[LAUNCHER_PROVIDER_ID_ENV];
  if (launcherId) {
    try {
      const row = await lookupProviderInDb(launcherId);
      if (row) {
        return row;
      }
    } catch {
      // db 读失败降级到全局，与查无此行一致
    }
  }
  const id = getCurrentProviderId();
  return lookupProviderInDb(id);
}

/**
 * 构造「当前供应商在数据库中查无此行」的错误
 *
 * @returns {Error}
 */
function providerNotFound() {
  return new Error(`供应商 "${getCurrentProviderId()}" 未在 CC Switch 数据库中找到`);
}

/**
 * 获取指定供应商的 API Key
 *
 * @returns {Promise<string>} token；获取失败时抛出 Error
 */
export async function getAPIKey() {
  // 优先从环境变量读取
  const env = process.env;
  const envKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
  // PROXY_MANAGED 是 CC Switch 代理模式占位符，环境变量无真实 key，回退到数据库
  if (envKey && envKey !== "PROXY_MANAGED") {
    return envKey;
  }

  // 回退到 CC Switch 数据库，与 getActualProviderName 共用 getCurrentProviderRow，
  // 保证两条链路供应商判定一致：代理模式取路由那家（聚合模式下是默认那家），
  // 直连模式优先 cc-launcher 注入的 CC_SWITCH_PROVIDER_ID
  const row = await getCurrentProviderRow();
  if (!row) {
    throw providerNotFound();
  }
  let providerEnv;
  try {
    providerEnv = JSON.parse(row.settings_config).env || {};
  } catch (error) {
    throw new Error(`无法获取 API Key: ${error.message}`, { cause: error });
  }
  const key =
    providerEnv.ANTHROPIC_AUTH_TOKEN || providerEnv.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      `供应商 "${row.id}" 的 settings_config.env 未配置 ANTHROPIC_AUTH_TOKEN 或 ANTHROPIC_API_KEY`,
    );
  }
  return key;
}

/**
 * 获取当前实际使用的供应商名称
 *
 * 判定优先级：
 *   1. 聚合模式：没有唯一供应商（成员模型按请求分发），固定返回「聚合」
 *   2. 路由模式：live-state.json 的 proxy_route；查不到时降级到 3、4
 *   3. cc-launcher 注入的 CC_SWITCH_PROVIDER_ID：指向实际启动的供应商 id，
 *      可精确区分 base_url 与 token 均相同的同 key 供应商；该 id 在数据库中不存在或
 *      db 读失败时降级到 4
 *   4. CC Switch 直连指针（settings.json 的 currentProviderClaude）
 *
 * @param {"direct" | "route" | "stack"} [mode] 已知模式，缺省时自行读取
 * @returns {Promise<string>} 供应商名称；聚合模式返回「聚合」
 * @throws {Error} 直连指针缺失，或供应商数据库中查不到时
 */
export async function getActualProviderName(mode = getAppMode()) {
  if (mode === MODE.STACK) {
    return STACK_DISPLAY_NAME;
  }
  const row = await getCurrentProviderRow(mode);
  if (!row) {
    throw providerNotFound();
  }
  return row.name;
}
