/**
 * @file Ollama Cloud 用量查询
 *
 * 读取 config.json 的 ollama 数组获取凭据
 * 请求 https://ollama.com/settings 页面，解析 session / weekly 用量
 *
 * 注意：
 *   Ollama 登录受 Cloudflare 人机验证保护，Playwright 启动的浏览器会被判定为自动化
 *   即使用户手动操作也无法通过验证，故未提供登录脚本，cookie 需从真实浏览器手动复制
 *
 * 用法:
 *   node query-usage-ollama.mjs
 *
 * 参数:
 *   --display / -d    显示模式：auto(a,默认) | long(l) | short(s)
 *   --position / -p   账号位置（0 开始，默认 0）
 *
 * 也可被 import 后调用 queryUsage(options)
 */

import {
    DISPLAY,
    KEYS,
    NO_ACTIVE_PLAN,
    DEFAULT_LABELS,
    renderWindows,
    renderErrorLine,
    friendlyError,
    loadConfig,
    resolvePrefixes,
    findAccount,
    parseArgs,
    fetchUsageCached,
    writeCache,
    isMainModule,
    REQUEST_TIMEOUT_MS,
} from "../utils/utils-query-usage.mjs";

// #region 配置常量 ----------------

const KEY = KEYS.OLLAMA;

const SETTINGS_URL = "https://ollama.com/settings";
const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0";

// #endregion 配置常量 --------------------------------

// #region 解析工具 ----------------

/**
 * 把 "4 hours." / "6 days." / "3 hours 12 minutes" 等英文时长文本转为秒数
 *
 * ollama 页面 "Resets in" 后面是英文时长文本，renderWindows 需要秒数
 *
 * @param {string} s 时长文本
 * @returns {number} 秒数，无法识别时返回 0
 */
export function parseDurationString(s) {
    let sec = 0;
    const multipliers = { day: 86400, hour: 3600, minute: 60, second: 1 };
    const re = /(\d+)\s*(day|hour|minute|second)s?/gi;
    let m;
    while ((m = re.exec(s))) {
        sec += parseInt(m[1], 10) * multipliers[m[2].toLowerCase()];
    }
    return sec;
}

/**
 * 从 SSR HTML 中提取用量窗口数据
 *
 * ollama 无月度窗口，session 映射到 rolling，weekly 映射到 weekly
 * 百分比从可见文本抓取；重置时间优先取 local-time 元素的 data-time 精确时间戳，
 * 解析失败时回退到 "Resets in X hours" 文本时长
 *
 * 从窗口标题向后取该窗口数据：标题后第一个 local-time 的 data-time 为精确重置时间，
 * 标题后第一个 "Resets in" 文本为兜底时长。不依赖块容器配平（真实页面标题在 <span>
 * 内、外层块容器嵌套深，按 <div> 配平会取到内层布局 div 而漏掉 local-time），
 * 也不依赖全局出现顺序（避免窗口顺序变化干扰）
 *
 * @param {string} html settings 页面 HTML
 * @param {number} [now=Date.now()] 当前时间戳，用于计算倒计时
 * @returns {{
 *     rolling: { pct: number, sec: number } | null,
 *     weekly: { pct: number, sec: number } | null
 * }}
 */
export function parseUsageWindows(html, now = Date.now()) {
    // 从标题位置向后取该窗口的第一个匹配：local-time 的 data-time 与 "Resets in"
    // 都在标题所在块内、且是该标题后第一个，故无需块容器配平即可正确归属。
    // 标题定位用大小写不敏感搜索，与下方正则的 /i 一致，避免标题大小写变体时整窗丢数据。
    // 每窗口只定位标题一次、切片一次，对同一段连跑三个正则，避免重复全量扫描
    const parseWindow = (title) => {
        const idx = html.search(new RegExp(title, "i"));
        if (idx < 0) {
            return null;
        }
        const rest = html.slice(idx);
        const pct = rest.match(/([\d.]+)%\s*used/i)?.[1];
        if (pct === undefined) {
            return null;
        }
        const timeMatch = rest.match(
            /class="[^"]*local-time[^"]*"\s+data-time="([^"]+)"/i,
        );
        const resetMs = timeMatch ? Date.parse(timeMatch[1]) : null;
        const reset = rest.match(/Resets in\s*([^\n<]+)/i)?.[1];
        return { pct, reset, resetMs };
    };

    const toWindow = (w) => {
        if (w === null) {
            return null;
        }
        // 优先 data-time 精确时间戳，回退到文本时长解析；两者皆无效则无倒计时（null → ↻ --）
        // 负数（重置已过）原样透传，由 renderWindows 统一显示 ↻ --，不再钳成 0 分钟
        let sec;
        if (w.resetMs != null && Number.isFinite(w.resetMs)) {
            sec = Math.round((w.resetMs - now) / 1000);
        } else if (w.reset !== undefined) {
            // parseDurationString 对无法识别文本返回 0，视为无效（0 秒倒计时也无意义），
            // 归 null → ↻ --，与「两者皆无效则无倒计时」契约一致
            const parsed = parseDurationString(w.reset);
            sec = parsed > 0 ? parsed : null;
        } else {
            sec = null;
        }
        return { pct: parseFloat(w.pct), sec };
    };

    return {
        rolling: toWindow(parseWindow("Session usage")),
        weekly: toWindow(parseWindow("Weekly usage")),
    };
}

/**
 * 从 settings 页面提取套餐类型标签
 *
 * "Cloud usage" 标题右侧有一个带 capitalize class 的 span 显示套餐类型
 * （已订阅为 "pro"，未订阅为 "free"）；抓不到返回 null
 *
 * @param {string} html settings 页面 HTML
 * @returns {string | null} 小写套餐类型，如 "pro" / "free"；抓不到为 null
 */
export function parsePlanType(html) {
    const m = html.match(
        /Cloud usage<\/span>[\s\S]{0,400}?<span[^>]*\bcapitalize\b[^>]*>\s*([^<]+?)\s*<\/span/,
    );
    return m ? m[1].trim().toLowerCase() : null;
}

// #endregion 解析工具 --------------------------------

// #region 用量请求 ----------------

/**
 * 请求 ollama.com/settings 并解析用量数据
 *
 * @param {string} sessionCookie __Secure-session 的值
 * @returns {Promise<{
 *     rolling: { pct: number, sec: number } | null,
 *     weekly: { pct: number, sec: number } | null
 * }>}
 * @throws {Error} cookie 失效、网络失败或页面结构变更
 */
async function fetchUsage(sessionCookie) {
    const resp = await fetch(SETTINGS_URL, {
        headers: {
            Cookie: `__Secure-session=${sessionCookie}`,
            Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
            "User-Agent": UA,
        },
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    // cookie 失效：ollama.com 会 3xx 重定向到登录页
    if (resp.status >= 300 && resp.status < 400) {
        throw new Error(
            `cookie 已过期或无效(重定向到 ${resp.headers.get("location")})，请从浏览器重新获取 __Secure-session`,
        );
    }
    if (!resp.ok) {
        throw new Error(`请求失败(HTTP ${resp.status})`);
    }

    const html = await resp.text();

    const usage = parseUsageWindows(html);
    const planType = parsePlanType(html);
    // 套餐类型为 free（未订阅/已过期降级）时视为无活跃套餐
    if (planType === "free") {
        throw new Error(`${NO_ACTIVE_PLAN}，当前为${planType}套餐`);
    }
    if (usage.rolling === null && usage.weekly === null) {
        if (/Session usage|Weekly usage/i.test(html)) {
            throw new Error("页面解析失败，页面结构可能已更新");
        }
        throw new Error("未找到用量数据");
    }
    return usage;
}

// #endregion 用量请求 --------------------------------

// #region 查询入口 ----------------

/**
 * 查询 Ollama Cloud 用量并返回渲染后的输出行
 *
 * 不抛出异常：出错时返回带默认标签前缀的错误字符串，便于调用方保持退出码 0
 *
 * @param {object} [options]
 * @param {number} [options.position=0] 账号位置（0 开始）
 * @param {"auto" | "long" | "short"} [options.display=DISPLAY.AUTO] 展示档位
 * @param {boolean} [options.cache=false] 启用结果缓存（含错误负缓存）
 * @param {object} [options._config] 内部：已解析的 config 对象，避免重复读取
 * @returns {Promise<string>} 输出行
 */
export async function queryUsage(options = {}) {
    const { position = 0, display = DISPLAY.AUTO, cache = false } = options;

    let prefixes = DEFAULT_LABELS[KEY];
    // 是否已进入网络查询阶段：仅对此后的失败写负缓存（配置类错误不写，原因同 ark）
    let reachedFetch = false;
    try {
        const cfg = options._config || loadConfig();
        const account = findAccount(cfg[KEY], position);
        prefixes = resolvePrefixes(account, DEFAULT_LABELS[KEY]);
        const cookie = (account.cookie || "").trim();

        if (!cookie) {
            return renderErrorLine(
                prefixes,
                display,
                "cookie 为空，请从浏览器 DevTools -> Application -> Cookies 复制 __Secure-session 填入配置",
            );
        }

        reachedFetch = true;
        const result = await fetchUsageCached(`${KEY}:${position}`, cache, () =>
            fetchUsage(cookie),
        );
        if (result.output !== undefined) {
            return result.output;
        }
        return renderWindows(result.usage, display, prefixes);
    } catch (err) {
        const output = renderErrorLine(prefixes, display, friendlyError(err));
        if (cache && reachedFetch) {
            writeCache(`${KEY}:${position}`, { output });
        }
        return output;
    }
}

// #endregion 查询入口 --------------------------------

// #region CLI 壳 ----------------

async function main() {
    let display = DISPLAY.AUTO;
    try {
        const parsed = parseArgs(process.argv);
        display = parsed.display;
        const output = await queryUsage({
            position: parsed.position,
            display: parsed.display,
        });
        if (output) {
            process.stdout.write(output);
        }
    } catch (err) {
        process.stdout.write(
            renderErrorLine(DEFAULT_LABELS[KEY], display, err.message) + "\n",
        );
    }
}

if (isMainModule(import.meta.url)) {
    main();
}

// #endregion CLI 壳 --------------------------------
