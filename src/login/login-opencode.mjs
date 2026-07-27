/**
 * @file OpenCode 登录模块
 *
 * 使用 Playwright 启动系统 Edge，引导用户登录 opencode.ai，
 * 读取 auth cookie 和 workspaceID 写回 config.json
 *
 * 既是模块（导出 doLogin）也是 CLI：直接 `node login-opencode.mjs [--position <n>]` 即可触发登录
 * 依赖 playwright-core（devDependency），未安装时询问后安装
 */

import { runLogin, isMainModule } from "../utils/utils-login.mjs";
import { parseArgs } from "../utils/utils-query-usage.mjs";

const LOGIN_URL = "https://opencode.ai/auth";
const COOKIE_URL = "https://opencode.ai";
const COOKIE_NAME = "auth";
const KEY = "opencode";

/**
 * 启动 Edge 登录 OpenCode，读取 auth cookie 和 workspaceID 写回 config
 *
 * 每个 position 使用独立的持久化 profile 目录（tmp/profile-opencode/<position>），
 * 避免多账号登录时复用同一 profile 导致凭据写错账号
 *
 * 登录流程：开浏览器 -> 用户登录（auth cookie 出现）-> 用户进入目标 workspace -> 提取 workspaceID
 *
 * @param {number} [position=0] OpenCode 账号在 config.opencode 数组中的位置
 * @returns {Promise<{authCookie: string, workspaceID: string}>} 凭据
 */
export async function doLogin(position = 0) {
    return runLogin({
        key: KEY,
        position,
        loginUrl: LOGIN_URL,
        cookieUrl: COOKIE_URL,
        cookieName: COOKIE_NAME,
        onLogin: async (ctx, page, _cookies, isClosed) => {
            const deadline = Date.now() + 5 * 60 * 1000;
            let workspaceID = null;
            while (Date.now() < deadline) {
                if (isClosed()) {
                    break; // 浏览器关闭，退出循环，由 runLogin 统一报错
                }
                const match = page
                    .url()
                    .match(/\/workspace\/(wrk_[a-zA-Z0-9_-]+)/);
                if (match) {
                    workspaceID = match[1];
                    break;
                }
                await new Promise((r) => setTimeout(r, 1000));
            }
            if (!workspaceID) {
                throw new Error(
                    "未检测到 workspace 页面，请确认已成功登录 OpenCode",
                );
            }

            const cookies = await ctx.cookies(COOKIE_URL);
            const authCookie = cookies.find(
                (c) => c.name === COOKIE_NAME,
            )?.value;
            if (!authCookie) {
                throw new Error(
                    "未获取到 auth cookie，请确认已成功登录 OpenCode",
                );
            }
            return { configUpdate: { authCookie, workspaceID } };
        },
    });
}

if (isMainModule(import.meta.url)) {
    try {
        const position = parseArgs(process.argv).position;
        doLogin(position).then(
            () => {
                // 成功消息在 doLogin 内部输出
            },
            (err) => {
                process.stderr.write(`❌ 登录失败：${err.message}\n`);
                process.exitCode = 1;
            },
        );
    } catch (err) {
        process.stderr.write(`❌ 登录失败：${err.message}\n`);
        process.exitCode = 1;
    }
}
