/**
 * @file 千问 Token Plan 登录模块
 *
 * 使用 Playwright 启动系统 Edge，引导用户登录千问控制台，
 * 读取登录 cookie 写回 config.json
 *
 * 既是模块（导出 doLogin）也是 CLI：直接 `node login-qwen.mjs [--position <n>]` 即可触发登录
 * 依赖 playwright-core（devDependency），未安装时询问后安装
 */

import { runLogin, isMainModule } from "../utils/utils-login.mjs";
import { parseArgs, ERROR_MARK } from "../utils/utils-query-usage.mjs";

const LOGIN_URL =
    "https://platform.qianwenai.com/home/billing/subscription/token-plan-individual";
const COOKIE_URL = "https://platform.qianwenai.com";
const COOKIE_NAME = "login_qianwenai_ticket";
const KEY = "qwen";

/**
 * 启动 Edge 登录千问，读取 cookie 写回 config
 *
 * 每个 position 使用独立的持久化 profile 目录（tmp/profile-qwen/<position>），
 * 避免多账号登录时复用同一 profile 导致 cookie 写错账号
 *
 * @param {number} [position=0] qwen 账号在 config.qwen 数组中的位置
 * @returns {Promise<string>} 新的 cookie 字符串
 */
export async function doLogin(position = 0) {
    const result = await runLogin({
        key: KEY,
        position,
        loginUrl: LOGIN_URL,
        cookieUrl: COOKIE_URL,
        cookieName: COOKIE_NAME,
        onLogin: async (ctx, page) => {
            // 登录后导航到用量页，确保 cookie 完整
            await page.goto(LOGIN_URL).catch(() => {});
            await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
            const cookies = await ctx.cookies(COOKIE_URL);
            const cookieStr = cookies
                .map((c) => `${c.name}=${c.value}`)
                .join("; ");
            if (!cookieStr || !cookieStr.includes(COOKIE_NAME)) {
                throw new Error("未获取到有效 cookie，请确认已成功登录千问");
            }
            return { configUpdate: { cookie: cookieStr } };
        },
    });
    return result?.cookie;
}

if (isMainModule(import.meta.url)) {
    try {
        const position = parseArgs(process.argv).position;
        doLogin(position).then(
            () => {
                // 成功消息在 doLogin 内部输出
            },
            (err) => {
                process.stderr.write(`${ERROR_MARK}登录失败：${err.message}\n`);
                process.exitCode = 1;
            },
        );
    } catch (err) {
        process.stderr.write(`${ERROR_MARK}登录失败：${err.message}\n`);
        process.exitCode = 1;
    }
}
