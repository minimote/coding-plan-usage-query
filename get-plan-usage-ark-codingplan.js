/**
 * @file 火山方舟 Coding Plan 用量查询
 * 调用控制台 GetCodingPlanUsage 接口获取实时用量（POST + cookie + X-CSRF-Token）
 * 使用前需将 config.example.json 重命名为 config.json 并填写
 * ccstatusline-zh 自定义命令：node F:\xxx\get-plan-usage-ark-codingplan.js
 * 超时建议设为 5000
 */

const https = require("https");
const cfg = require("./config.json");

/**
 * 返回 config.json 中火山引擎控制台完整的登录 cookie 字符串
 *
 * @return 完整 cookie 字符串
 */
function loadCookie() {
    return cfg.ark.cookie;
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
 * 查询并打印火山方舟 Coding Plan 用量
 *
 * 向控制台 GetCodingPlanUsage 接口发 POST，按 会话/周/月 三个维度
 * 输出进度条、百分比和重置倒计时；失败时输出一行错误提示
 */
function main() {
    const cookie = loadCookie();
    const timeoutMs = 3000;

    // 先把名字写到 stdout，错误信息或正常数据接在后面
    process.stdout.write("火山方舟 | ");

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

    // 从 cookie 提取 csrfToken（火山引擎控制台 CSRF 校验需要）
    const csrfMatch = cookie.match(/csrfToken=([^;]+)/);
    if (!csrfMatch) {
        out("cookie 中未找到 csrfToken ，请重新复制完整 cookie");
        return;
    }
    const csrfToken = csrfMatch[1];

    const labels = { session: "5小时", weekly: "1周", monthly: "1月" };
    const windows = ["session", "weekly", "monthly"];

    // ─── 发请求 ───
    const url =
        "https://console.volcengine.com/api/top/ark/cn-beijing/2024-01-01/GetCodingPlanUsage";
    const req = https.request(
        url,
        {
            method: "POST",
            headers: {
                Cookie: cookie,
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
                "Content-Type": "application/json",
                Accept: "application/json, text/plain, */*",
                "X-CSRF-Token": csrfToken,
            },
            timeout: timeoutMs,
        },
        (resp) => {
            let body = "";
            resp.setEncoding("utf8");
            resp.on("data", (c) => (body += c));
            resp.on("end", () => {
                try {
                    let j;
                    try {
                        j = JSON.parse(body);
                    } catch (e) {
                        out("响应解析失败");
                        return;
                    }

                    const err = j.ResponseMetadata && j.ResponseMetadata.Error;
                    if (err) {
                        if (err.Code === "InvalidCSRFToken")
                            out("csrfToken 已过期，请重新复制完整 cookie");
                        else out(`请求失败(${err.Code})`);
                        return;
                    }

                    const quota = j.Result && j.Result.QuotaUsage;
                    if (!Array.isArray(quota)) {
                        // cookie 失效通常表现为拿不到 Result（或重定向到登录页）
                        out("cookie 已过期或无效");
                        return;
                    }

                    const now = Math.floor(Date.now() / 1000);
                    const segs = [];
                    for (const key of windows) {
                        const item = quota.find((q) => q.Level === key);
                        if (!item) {
                            segs.push(`${labels[key]}:—`);
                            continue;
                        }
                        let pct = item.Percent;
                        if (pct < 0) pct = 0;
                        if (pct > 100) pct = 100;
                        const sec = (item.ResetTimestamp || 0) - now;
                        const pctInt = Math.round(pct);
                        segs.push(
                            `${labels[key]}:${bar(pct)} ${pctInt}% ↻ ${toCountdown(sec)}`,
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
    req.write("{}");
    req.end();
}

main();
