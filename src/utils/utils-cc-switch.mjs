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

/** DatabaseSync 构造器，首次调用 openDb 时动态加载 */
let DatabaseSync;

/**
 * 覆盖 process.emitWarning 屏蔽 ExperimentalWarning
 *
 * node:sqlite 的实验性警告在模块加载时触发，静态 import 无法拦截；
 * 动态 import 前调用本函数，可只过滤实验性警告，其他警告（如 DeprecationWarning）仍正常输出
 */
function suppressExperimentalWarning() {
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
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
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
    return new DatabaseSync(DB_PATH, { readOnly: true });
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
    const db = await openDb();
    try {
        return (
            db
                .prepare(
                    "SELECT id, app_type, name, settings_config, website_url, category, " +
                        "created_at, sort_index, notes, icon, icon_color, meta, is_current, " +
                        "in_failover_queue FROM providers WHERE id = ? AND app_type = ?",
                )
                .get(id, APP_TYPE) || null
        );
    } finally {
        db.close();
    }
}

/**
 * 获取指定供应商的 API Key
 *
 * @param {string} [id=getCurrentProviderId()] 供应商 id；默认使用当前供应商 id
 * @returns {Promise<string>} token；获取失败时抛出 Error
 */
export async function getAPIKey(id = getCurrentProviderId()) {
    const row = await lookupProviderInDb(id);
    if (!row) {
        throw new Error(`供应商 "${id}" 未在 CC-Switch 数据库中找到`);
    }
    try {
        const env = JSON.parse(row.settings_config).env || {};
        return env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
    } catch (error) {
        throw new Error(`无法获取 API Key: ${error.message}`);
    }
}
