/**
 * @file OpenCodeGo 用量查询
 * 请求 https://opencode.ai/workspace/<WorkspaceID>/go 页面，解析 SSR 直出的用量 HTML
 * 使用前需将 config.example.json 重命名为 config.json 并填写
 * ccstatusline-zh 自定义命令：node F:\xxx\get-plan-usage-opencode-go.js
 * 超时建议设为 5000
 */

const https = require("https");
const cfg = require("./config.json");

/**
 * 返回 config.json 中 opencode.ai 的 auth cookie 值
 *
 * @return auth cookie 值（不含 "auth=" 前缀）
 */
function loadCookie() {
    return cfg.opencode.authCookie;
}

/**
 * 返回 config.json 中 opencode.ai 的 workspaceID
 *
 * @return workspaceID
 */
function loadWorkspaceID() {
    return cfg.opencode.workspaceID;
}

/**
 * 渲染 10 格进度条
 *
 * @param pct 百分比
 * @return 形如 "█████░░░░░" 的 10 字符串
 */
function bar(pct) {
    const n = Math.round(pct / 10);
    return "█".repeat(Math.min(n, 10)).padEnd(10, "░");
}

/**
 * 秒数 → 人类可读倒计时
 *
 * @param sec 距离重置的剩余秒数
 * @return 形如 "3天6小时" / "4小时47分" / "12分" / "即将"（sec≤0）
 */
function toCountdown(sec) {
    if (sec <= 0) return "即将重置";
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return h > 0 ? `${d}天${h}小时` : `${d}天`;
    if (h > 0) return m > 0 ? `${h}小时${m}分` : `${h}小时`;
    return `${m}分`;
}

/**
 * 从 SSR HTML 中取某用量窗口对象的字段值
 *
 * 用量对象固定形态 name:$R[数字]={...}；页面里 name 可能先作为别处字段名出现
 * （如 monthlyUsage:0），故用 ":$R[数字]=" 前缀锁定，再花括号配对取正文，
 * 最后在正文中按 field:数值 提取
 *
 * @param html 页面 HTML
 * @param name 用量对象名（如 "rollingUsage"）
 * @param field 要取的字段名（如 "usagePercent"）
 * @return 字段值的字符串形式；未匹配到对象或字段时返回 null
 */
function getWindowValue(html, name, field) {
    const hm = html.match(
        name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":\\$R\\[\\d+\\]=\\{",
    );
    if (!hm) return null;
    const start = hm.index + hm[0].length;
    let depth = 1,
        i = start,
        end = -1;
    while (i < html.length && depth > 0) {
        const ch = html[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
        i++;
    }
    if (end < 0) return null;
    const body = html.substring(start, end);
    const fm = body.match(
        field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:\\s*(-?[\\d.]+)",
    );
    if (!fm) return null;
    return fm[1];
}

/**
 * 查询并打印 OpenCodeGo 用量
 *
 * 请求 workspace 用量页，按 rolling/weekly/monthly 三个窗口输出进度条、
 * 百分比和重置倒计时；失败时输出一行错误提示
 */
function main() {
    const cookie = "auth=" + loadCookie();
    const workspaceID = loadWorkspaceID();
    const timeoutMs = 3000;

    // 先把名字写到 stdout，错误信息或正常数据接在后面
    process.stdout.write("OpenCodeGo | ");

    // 防止 timeout 后 destroy 触发的 error 事件重复输出
    let done = false;
    /**
     * 单次输出：保证整个 main 只往 stdout 写一次后续内容
     * 防止 timeout 后 destroy 触发的 error 事件导致重复输出
     *
     * @param msg 要输出的内容
     */
    function out(msg) {
        if (done) return;
        done = true;
        process.stdout.write(msg);
    }

    const baseUrl = "https://opencode.ai";
    const userAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

    // 用量窗口标签
    const labels = { rolling: "5小时", weekly: "1周", monthly: "1月" };
    const windows = ["rolling", "weekly", "monthly"];

    // ─── 发请求 ───
    const url = `${baseUrl}/workspace/${workspaceID}/go`;
    const req = https.request(
        url,
        {
            headers: {
                Cookie: cookie,
                "User-Agent": userAgent,
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            timeout: timeoutMs,
        },
        (resp) => {
            if (resp.statusCode === 401 || resp.statusCode === 403) {
                out(`cookie 已过期或无效(HTTP ${resp.statusCode})`);
                return;
            }
            if (resp.statusCode !== 200) {
                out(`请求失败(HTTP ${resp.statusCode})`);
                return;
            }
            let html = "";
            resp.setEncoding("utf8");
            resp.on("data", (c) => (html += c));
            resp.on("end", () => {
                try {
                    const htmlLow = html.toLowerCase();
                    for (const kw of [
                        "/login",
                        "sign in",
                        "auth/authorize",
                        "not associated with an account",
                        'actor of type "public"',
                    ]) {
                        if (htmlLow.includes(kw)) {
                            out("cookie 已过期或无效");
                            return;
                        }
                    }

                    // rolling 必须能取到，否则视为页面结构变化
                    const rollingPct = getWindowValue(
                        html,
                        "rollingUsage",
                        "usagePercent",
                    );
                    if (rollingPct === null) {
                        if (/usagePercent/.test(html))
                            out("页面解析失败， SSR 格式可能已变更");
                        else
                            out("未找到用量数据，请检查 workspace_id 是否正确");
                        return;
                    }

                    // ─── 打印（单行：百分比 + 重置倒计时）───
                    const segs = [];
                    for (let i = 0; i < windows.length; i++) {
                        const w = windows[i];
                        const pctRaw = getWindowValue(
                            html,
                            w + "Usage",
                            "usagePercent",
                        );
                        if (pctRaw === null) {
                            segs.push(`${labels[w]}:—`);
                            continue;
                        }
                        let pct = parseFloat(pctRaw);
                        if (pct < 0) pct = 0;
                        if (pct > 100) pct = 100;
                        let secRaw = getWindowValue(
                            html,
                            w + "Usage",
                            "resetInSec",
                        );
                        let sec = secRaw !== null ? parseInt(secRaw, 10) : 0;
                        if (sec < 0) sec = 0;
                        const pctInt = Math.round(pct);
                        segs.push(
                            `${labels[w]}:${bar(pct)} ${pctInt}% ↻ ${toCountdown(sec)}`,
                        );
                    }
                    out(segs.join(" | "));
                } catch (e) {
                    out("处理响应时出错");
                }
            });
        },
    );

    req.on("timeout", () => {
        req.destroy();
        out("网络请求失败: 超时");
    });
    req.on("error", (e) => {
        out(`网络请求失败: ${e.message}`);
    });
    req.end();
}

main();
