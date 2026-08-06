/**
 * @file CC-Switch 相关工具
 *
 * 读取 ~/.cc-switch 的 settings.json 与 cc-switch.db
 * 提供当前供应商识别与 API Key 读取
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CC_SWITCH_DIR = join(homedir(), ".cc-switch");
const SETTINGS_PATH = join(CC_SWITCH_DIR, "settings.json");
const DB_PATH = join(CC_SWITCH_DIR, "cc-switch.db");
const APP_TYPE = "claude";
const CURRENT_PROVIDER_FIELD = "currentProviderClaude";

/** cc-launcher 启动时注入的供应商 id 环境变量 */
const LAUNCHER_PROVIDER_ID_ENV = "CC_SWITCH_PROVIDER_ID";

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
 * 获取当前供应商 id
 *
 * 读 ~/.cc-switch/settings.json 的 currentProviderClaude
 *
 * @returns {string} 供应商 id
 * @throws {Error} settings.json 不存在或 currentProviderClaude 为空
 */
export function getCurrentProviderId() {
    const id = readSettings()[CURRENT_PROVIDER_FIELD];
    if (!id) {
        throw new Error(
            "未检测到 CC-Switch 当前供应商 (settings.json 缺少 currentProviderClaude)",
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
        throw new Error(`CC-Switch 数据库读取失败: ${e.message}`);
    } finally {
        db?.close();
    }
}

/**
 * 解析当前实际使用的供应商 db 行
 *
 * 优先 cc-launcher 注入的 CC_SWITCH_PROVIDER_ID：该 id 查无此行（null）或 db 读失败
 * （抛错，如短暂锁/损坏）时降级到全局激活供应商 currentProviderClaude，与「查无此行」
 * 一致——抛错也降级，避免 launcherId 侧瞬态故障时直接失败；
 * 全局供应商查无此行返回 null，db 读失败抛错（无更 fallback）
 *
 * @returns {Promise<object|null>} 供应商行；全局供应商查无此行时返回 null
 * @throws {Error} 全局供应商 db 读失败，或 getCurrentProviderId 失败时抛出
 */
async function getCurrentProviderRow() {
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
    return new Error(`供应商 "${getCurrentProviderId()}" 未在 CC-Switch 数据库中找到`);
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
    // PROXY_MANAGED 是 CC-Switch 代理模式占位符，环境变量无真实 key，回退到数据库
    if (envKey && envKey !== "PROXY_MANAGED") {
        return envKey;
    }

    // 回退到 CC-Switch 数据库：优先 cc-launcher 注入的 CC_SWITCH_PROVIDER_ID，
    // 与 getActualProviderName 共用 getCurrentProviderRow，保证两条链路供应商判定一致
    const row = await getCurrentProviderRow();
    if (!row) {
        throw providerNotFound();
    }
    let providerEnv;
    try {
        providerEnv = JSON.parse(row.settings_config).env || {};
    } catch (error) {
        throw new Error(`无法获取 API Key: ${error.message}`);
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
 *   1. cc-launcher 注入的 CC_SWITCH_PROVIDER_ID 环境变量：指向实际启动的供应商 id，
 *      可精确区分 base_url 与 token 均相同的同 key 供应商；该 id 在数据库中不存在或
 *      db 读失败时降级到全局
 *   2. cc-switch 全局激活供应商（settings.json 的 currentProviderClaude）
 *
 * @returns {Promise<string>} 供应商名称
 * @throws {Error} 全局激活供应商缺失或数据库中查不到时
 */
export async function getActualProviderName() {
    const row = await getCurrentProviderRow();
    if (!row) {
        throw providerNotFound();
    }
    return row.name;
}
