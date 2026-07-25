/**
 * @file 登录脚本公共逻辑
 *
 * Playwright 启动、持久化 profile（按 key+position 隔离）、cookie 轮询、写回 config
 * 被 login-qwen.mjs / login-opencode.mjs 复用
 */

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
    CONFIG_PATH,
    isMainModule,
    loadConfig,
} from "../utils/utils-query-usage.mjs";

const TMP_DIR = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "tmp",
);

/**
 * 加载 playwright-core 的 chromium，未安装时自动 npm install
 *
 * @returns {Promise<object>} chromium 对象
 */
export async function loadChromium() {
    try {
        return (await import("playwright-core")).chromium;
    } catch {
        process.stderr.write("\n正在安装 playwright-core，请稍后...\n");
        const { execSync } = await import("child_process");
        const projectRoot = join(
            dirname(fileURLToPath(import.meta.url)),
            "..",
            "..",
        );
        try {
            execSync("npm install -D playwright-core", {
                stdio: "inherit",
                cwd: projectRoot,
            });
        } catch {
            throw new Error(
                "playwright-core 安装失败，请手动运行 npm install -D playwright-core",
            );
        }
        try {
            const mod = await import("playwright-core");
            process.stderr.write("✅ playwright-core 安装完成\n\n");
            return mod.chromium;
        } catch {
            throw new Error("playwright-core 已安装，请重新运行登录命令");
        }
    }
}

/**
 * 运行登录流程
 *
 * 每个 key+position 使用独立的持久化 profile 目录（tmp/profile-<key>/<position>），
 * 避免多账号登录时复用同一 profile 导致凭据写错账号
 *
 * @param {object} options
 * @param {string} options.key config 中的账号键名（如 "qwen"）
 * @param {number} options.position 账号位置
 * @param {string} options.loginUrl 登录页 URL
 * @param {string} options.cookieUrl 取 cookie 的 URL
 * @param {string} options.cookieName 检测登录成功的 cookie 名
 * @param {(ctx: object, page: object, cookies: Array) => Promise<{configUpdate: object}>} options.onLogin
 *        登录成功后的回调，返回要写回 config 账号对象的字段（如 { cookie } 或 { authCookie, workspaceID }）
 * @returns {Promise<object>} onLogin 返回的 configUpdate
 */
export async function runLogin({
    key,
    position,
    loginUrl,
    cookieUrl,
    cookieName,
    onLogin,
}) {
    // 先读取 config；账号为空且 position=0 时自动创建空账号，position 越界才报错
    const cfg = loadConfig();
    if (!Array.isArray(cfg[key])) {
        cfg[key] = [];
    }
    if (cfg[key].length === 0 && position === 0) {
        cfg[key].push({});
        writeFileSync(
            CONFIG_PATH,
            JSON.stringify(cfg, null, 4) + "\n",
            "utf-8",
        );
        process.stderr.write(`✅ 已在 config.json 创建 ${key} 账号\n`);
    }
    if (!cfg[key][position]) {
        throw new Error(`config.json 中 ${key}[${position}] 不存在`);
    }

    const chromium = await loadChromium();

    process.stderr.write(
        "\n即将打开浏览器，请在浏览器中登录，然后等待浏览器自动关闭\n\n",
    );
    await new Promise((r) => setTimeout(r, 2000));

    // 每个 key+position 独立 profile，避免多账号登录态串号
    const profileDir = join(TMP_DIR, `profile-${key}`, String(position));
    const ctx = await chromium.launchPersistentContext(profileDir, {
        channel: "msedge",
        headless: false,
        ignoreDefaultArgs: ["--no-sandbox"],
    });

    // 监听浏览器关闭，用于在各阶段给出友好提示
    let browserClosed = false;
    ctx.on("close", () => {
        browserClosed = true;
    });

    let result;
    try {
        const page = ctx.pages()[0] || (await ctx.newPage());
        await page.goto(loginUrl);

        // 轮询检测登录完成（目标 cookie 出现即视为已登录）
        const deadline = Date.now() + 5 * 60 * 1000;
        let cookies = [];
        while (Date.now() < deadline) {
            if (browserClosed) {
                throw new Error("浏览器被关闭，请重新运行登录命令");
            }
            try {
                cookies = await ctx.cookies(cookieUrl);
            } catch {
                throw new Error("浏览器被关闭，请重新运行登录命令");
            }
            if (cookies.some((c) => c.name === cookieName)) {
                break;
            }
            await new Promise((r) => setTimeout(r, 1000));
        }
        if (!cookies.some((c) => c.name === cookieName)) {
            throw new Error("登录超时（5 分钟内未检测到登录）");
        }

        // provider 特有逻辑（如导航到指定页、提取额外字段）
        // isClosed 供 onLogin 在循环中检测浏览器关闭
        try {
            result = await onLogin(ctx, page, cookies, () => browserClosed);
        } catch (err) {
            if (browserClosed || /closed|disposed/i.test(err.message)) {
                throw new Error("浏览器被关闭，请重新运行登录命令");
            }
            throw err;
        }
    } finally {
        // 浏览器可能已被用户关闭，close() 忽略被关闭的错误
        try {
            await ctx.close();
        } catch {}
    }

    // 写回 config.json：重新读取最新配置，只更新对应字段，避免覆盖登录期间的手工修改
    const latest = loadConfig();
    if (!Array.isArray(latest[key]) || !latest[key][position]) {
        throw new Error(
            `config.json 在登录期间被修改，${key}[${position}] 不存在`,
        );
    }
    Object.assign(latest[key][position], result.configUpdate);
    writeFileSync(CONFIG_PATH, JSON.stringify(latest, null, 4) + "\n", "utf-8");

    process.stderr.write("✅ 登录成功，凭据已写入 config.json\n\n");
    return result.configUpdate;
}

export { isMainModule };
