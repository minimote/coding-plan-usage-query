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
 * HTML 转纯文本（去标签、解实体、压空白）
 *
 * ollama settings 页面用量数据为 SSR 渲染的可见文本，无内嵌 JS 对象，
 * 故先转纯文本再用正则匹配
 */
function htmlToText(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, "\n")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n/g, "\n")
        .trim();
}

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
 * @param {string} html settings 页面 HTML
 * @param {number} [now=Date.now()] 当前时间戳，用于计算倒计时
 * @returns {{
 *     rolling: { pct: number, sec: number } | null,
 *     weekly: { pct: number, sec: number } | null
 * }}
 */
export function parseUsageWindows(html, now = Date.now()) {
    const text = htmlToText(html);

    const sessionMatch = text.match(
        /Session usage\s*\n\s*([\d.]+)%\s*used\s*\n\s*Resets in\s*([^\n]+)/i,
    );
    const weeklyMatch = text.match(
        /Weekly usage\s*\n\s*([\d.]+)%\s*used\s*\n\s*Resets in\s*([^\n]+)/i,
    );

    // local-time 元素的 data-time 精确时间戳（ISO 8601），按出现顺序：session, weekly
    const resetTimes = [
        ...html.matchAll(
            /class="[^"]*local-time[^"]*"\s+data-time="([^"]+)"/gi,
        ),
    ].map((m) => Date.parse(m[1]));

    const toWindow = (match, resetMs) => {
        if (!match) {
            return null;
        }
        // 优先 data-time 精确时间戳，回退到文本时长解析
        const sec =
            resetMs != null && Number.isFinite(resetMs)
                ? Math.max(0, Math.round((resetMs - now) / 1000))
                : parseDurationString(match[2]);
        return {
            pct: parseFloat(match[1]),
            sec,
        };
    };

    return {
        rolling: toWindow(sessionMatch, resetTimes[0]),
        weekly: toWindow(weeklyMatch, resetTimes[1]),
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

    // cookie 过期但 HTTP 仍 200 时，页面会出现登录关键词
    if (/\/login|sign\s*in|auth\/authorize|log\s*into/i.test(html)) {
        throw new Error(
            "cookie 已过期或无效，请从浏览器重新获取 __Secure-session",
        );
    }

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
        const output = renderErrorLine(prefixes, display, err.message);
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
