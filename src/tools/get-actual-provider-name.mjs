/**
 * @file 获取当前实际使用的 CC-Switch 供应商名称
 *
 * 获取不到套餐账号或名字以 FREE_PREFIX 开头时输出供应商名（输出时去掉前缀）；
 * 匹配到套餐账号且名字无前缀时不输出（用量行前缀已含供应商信息）
 * 实际供应商判定（见 utils-cc-switch.mjs 的 getActualProviderName）：
 *   1. cc-launcher 启动时注入 CC_SWITCH_PROVIDER_ID 环境变量，直接反查数据库
 *   2. 否则读取 cc-switch 全局激活供应商（currentProviderClaude）
 *
 * 用法:
 *   node get-actual-provider-name.mjs
 */

import {
    isMainModule,
    matchProviderAccount,
} from "../utils/utils-query-usage.mjs";
import { getActualProviderName } from "../utils/utils-cc-switch.mjs";

/** 免费供应商命名前缀：免费供应商在 cc-switch 里命名时以此开头 */
const FREE_PREFIX = "free-";

/**
 * 计算供应商名的显示值
 *
 * 获取不到套餐账号（如免费模型）或供应商名以 free- 开头时返回显示名
 * （已去掉 free- 前缀）；匹配到套餐账号且名字无前缀时返回 null——
 * 用量行前缀已含供应商信息，无需再输出
 *
 * @param {object | null} matched matchProviderAccount() 的结果，无套餐账号时为 null
 * @param {string} name getActualProviderName() 返回的供应商名
 * @returns {string | null} 需要显示时返回显示名（已剥 free- 前缀）；不显示时返回 null
 */
export function resolveProviderDisplay(matched, name) {
    const isFreePrefix = name.startsWith(FREE_PREFIX);
    const shown = isFreePrefix ? name.slice(FREE_PREFIX.length) : name;
    if (!matched || isFreePrefix) {
        return shown;
    }
    return null;
}

async function main() {
    // 获取不到套餐账号 → 视为免费 → 显示
    // matchProviderAccount 与 getActualProviderName 相互独立，并发执行；
    // matchProviderAccount 失败（如 config 缺失）视为获取不到套餐
    const [matched, name] = await Promise.all([
        matchProviderAccount().catch(() => null),
        getActualProviderName(),
    ]);

    const display = resolveProviderDisplay(matched, name);
    if (display !== null) {
        process.stdout.write(display);
    }
    // 匹配到套餐账号且名字无 free- 前缀：返回 null 不输出，用量行前缀已显示供应商
}

if (isMainModule(import.meta.url)) {
    main().catch(() => {
        // 兜底：任何未预期异常静默不输出
    });
}
