/**
 * @file 登录脚本公共逻辑
 *
 * Playwright 启动、持久化 profile（按 key+position 隔离）、cookie 轮询、写回 config
 * 被 login-qwen.mjs / login-opencode.mjs 复用
 *
 * 交互点：position 越界重输、开浏览器前确认、浏览器关闭重试、写回兜底（不丢凭据）、
 * playwright-core 安装确认
 */

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import readline from "node:readline";
import { CONFIG_PATH, isMainModule, loadConfig } from "./utils-query-usage.mjs";

const TMP_DIR = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "tmp",
);

/**
 * 用户主动取消，非错误
 *
 * runLogin 顶层 catch 后输出 "❌ <message>" 并返回 null（exitCode 0）；
 * 其他错误冒泡到 CLI 壳输出 "❌ 登录失败：<message>"（exitCode 1）
 */
class CanceledError extends Error {
    constructor(message = "已取消登录") {
        super(message);
        this.name = "CanceledError";
    }
}

// #region 交互工具 ----------------

/**
 * 创建一次性 readline 接口（stdin 读、stderr 写）
 *
 * 登录脚本必为交互式运行，stdin 是 TTY
 * @returns {readline.Interface}
 */
function createRl() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stderr,
    });
}

/**
 * 询问是/否，仅接受 y/yes（大小写不敏感）为确认，其他输入（含空回车）视为拒绝
 *
 * @param {string} prompt 提示文案（不含 y/n 后缀）
 * @returns {Promise<boolean>}
 */
export async function askConfirm(prompt) {
    const rl = createRl();
    try {
        const answer = await new Promise((r) =>
            rl.question(`${prompt} (y/n) `, r),
        );
        const a = answer.trim().toLowerCase();
        return a === "y" || a === "yes";
    } finally {
        rl.close();
    }
}

/**
 * 询问输入并用 validate 校验，循环直到合法或留空取消
 *
 * @param {string} prompt 提示文案
 * @param {(input: string) => {ok: true, value: any} | {ok: false, msg: string}} validate
 *        校验函数：合法返回 {ok:true, value}，非法返回 {ok:false, msg}
 * @returns {Promise<any | null>} 合法返回 value，留空取消返回 null
 */
export async function askInput(prompt, validate) {
    const rl = createRl();
    try {
        while (true) {
            const answer = await new Promise((r) =>
                rl.question(`${prompt} `, r),
            );
            const trimmed = answer.trim();
            if (trimmed === "") return null;
            const result = validate(trimmed);
            if (result.ok) return result.value;
            process.stderr.write(`${result.msg}\n`);
        }
    } finally {
        rl.close();
    }
}

// #endregion 交互工具 --------------------------------

// #region chromium 加载 ----------------

/**
 * 加载 playwright-core 的 chromium，未安装时询问后安装
 *
 * @returns {Promise<object>} chromium 对象
 * @throws {CanceledError} 用户取消安装
 */
export async function loadChromium() {
    try {
        return (await import("playwright-core")).chromium;
    } catch {
        const ok = await askConfirm(
            "未检测到 playwright-core（已在 package.json 的 devDependencies 中声明），是否现在安装？",
        );
        if (!ok) {
            throw new CanceledError(
                "已取消安装，请手动运行 npm install -D playwright-core 后重试",
            );
        }
        process.stderr.write("正在安装 playwright-core，请稍等...\n");
        const { execFileSync } = await import("child_process");
        const projectRoot = join(
            dirname(fileURLToPath(import.meta.url)),
            "..",
            "..",
        );
        // Windows 上 npm 是 .cmd 批处理，需经 cmd /c 执行；
        // 参数数组避免命令注入，shell:false 不触发 DEP0190
        const isWin = process.platform === "win32";
        try {
            execFileSync(
                isWin ? "cmd" : "npm",
                isWin
                    ? ["/c", "npm", "install", "-D", "playwright-core"]
                    : ["install", "-D", "playwright-core"],
                {
                    stdio: "inherit",
                    cwd: projectRoot,
                },
            );
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
            throw new Error("playwright-core 导入失败，请重新运行登录命令");
        }
    }
}

// #endregion chromium 加载 --------------------------------

// #region position 解析 ----------------

/**
 * 校验并解析 position，越界时交互式重新输入，留空取消抛 CanceledError
 *
 * position <= len 视为合法（< len 更新已有，=== len 新建）；> len 时提示重新输入
 *
 * @param {string} key 账号键名
 * @param {number} len 当前账号数
 * @param {number} initialPosition 命令行传入的初始 position（>=0）
 * @returns {Promise<{position: number, willCreate: boolean}>}
 * @throws {CanceledError} 用户留空取消
 */
async function resolvePosition(key, len, initialPosition) {
    if (initialPosition <= len) {
        return {
            position: initialPosition,
            willCreate: initialPosition === len,
        };
    }
    process.stderr.write(
        `${key} 当前有 ${len} 个账号，position 应为 0~${len}（${len} 为追加新账号位置），实际为 ${initialPosition}。\n`,
    );
    const input = await askInput("请重新输入 position（留空取消）:", (s) => {
        if (!/^\d+$/.test(s)) {
            return { ok: false, msg: `请输入 0~${len} 的数字` };
        }
        const n = parseInt(s, 10);
        if (n > len) {
            return { ok: false, msg: `position 应为 0~${len}` };
        }
        return { ok: true, value: n };
    });
    if (input === null) {
        throw new CanceledError();
    }
    return { position: input, willCreate: input === len };
}

// #endregion position 解析 --------------------------------

// #region 浏览器流程 ----------------

/**
 * 开浏览器、轮询登录 cookie、执行 onLogin
 *
 * 浏览器被关闭时抛"浏览器被关闭"，由调用方决定是否重试；
 * 登录超时（5 分钟未检测到登录）抛错不重试
 *
 * @param {object} chromium
 * @param {string} key 账号键名（用于 profile 目录隔离）
 * @param {number} position 账号位置（用于 profile 目录隔离）
 * @param {string} loginUrl 登录页 URL
 * @param {string} cookieUrl 取 cookie 的 URL
 * @param {string} cookieName 检测登录成功的 cookie 名
 * @param {(ctx: object, page: object, cookies: Array, isClosed: () => boolean) => Promise<{configUpdate: object}>} onLogin
 *        登录成功后的回调，返回要写回 config 账号对象的字段
 * @returns {Promise<{configUpdate: object}>}
 */
async function runBrowserFlow(
    chromium,
    key,
    position,
    loginUrl,
    cookieUrl,
    cookieName,
    onLogin,
) {
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
                throw new Error("浏览器被关闭");
            }
            try {
                cookies = await ctx.cookies(cookieUrl);
            } catch {
                throw new Error("浏览器被关闭");
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
                throw new Error("浏览器被关闭");
            }
            throw err;
        }
    } finally {
        // 浏览器可能已被用户关闭，close() 忽略被关闭的错误
        try {
            await ctx.close();
        } catch {}
    }
    return result;
}

// #endregion 浏览器流程 --------------------------------

// #region 写回 config ----------------

/**
 * 将凭据写回 config.json
 *
 * 目标位置存在则合并；恰好在末尾则追加；位置丢失（登录期间 config 被改）时
 * 询问是否追加到末尾，取消则把凭据打到 stderr 不丢失
 *
 * @param {string} key 账号键名
 * @param {number} position 登录时确定的 position
 * @param {{configUpdate: object}} result onLogin 返回的结果
 * @returns {Promise<boolean>} 是否成功写入文件
 */
async function writeBack(key, position, result) {
    const latest = loadConfig();
    if (!Array.isArray(latest[key])) {
        latest[key] = [];
    }
    const latestLen = latest[key].length;
    const configUpdate = result.configUpdate;

    // target >= 0 表示可直接写入：< latestLen 且账号存在则合并，=== latestLen 则追加
    let target = -1;
    if (position < latestLen && latest[key][position]) {
        target = position;
    } else if (position === latestLen) {
        target = latestLen;
    }

    if (target >= 0) {
        if (target < latestLen) {
            Object.assign(latest[key][target], configUpdate);
        } else {
            latest[key].push(configUpdate);
        }
        writeFileSync(
            CONFIG_PATH,
            JSON.stringify(latest, null, 4) + "\n",
            "utf-8",
        );
        return true;
    }

    // 兜底：position 丢失（登录期间 config 被改），询问是否追加到末尾
    const append = await askConfirm(
        `config.json 在登录期间被修改，${key}[${position}] 已不存在（当前 ${latestLen} 个账号）。是否追加到末尾？`,
    );
    if (append) {
        latest[key].push(configUpdate);
        writeFileSync(
            CONFIG_PATH,
            JSON.stringify(latest, null, 4) + "\n",
            "utf-8",
        );
        return true;
    }
    process.stderr.write(
        `凭据未写入 config.json，请手动添加到 ${key} 数组：\n${JSON.stringify(configUpdate, null, 4)}\n`,
    );
    return false;
}

// #endregion 写回 config --------------------------------

// #region 登录入口 ----------------

/**
 * 运行登录流程
 *
 * 每个 key+position 使用独立的持久化 profile 目录（tmp/profile-<key>/<position>），
 * 避免多账号登录时复用同一 profile 导致凭据写错账号
 *
 * 用户取消（CanceledError）输出 "❌ <原因>" 并返回 null（exitCode 0）；
 * 其他错误冒泡到 CLI 壳输出 "❌ 登录失败：<message>"（exitCode 1）
 *
 * @param {object} options
 * @param {string} options.key config 中的账号键名（如 "qwen"）
 * @param {number} options.position 账号位置
 * @param {string} options.loginUrl 登录页 URL
 * @param {string} options.cookieUrl 取 cookie 的 URL
 * @param {string} options.cookieName 检测登录成功的 cookie 名
 * @param {(ctx: object, page: object, cookies: Array, isClosed: () => boolean) => Promise<{configUpdate: object}>} options.onLogin
 *        登录成功后的回调，返回要写回 config 账号对象的字段（如 { cookie } 或 { authCookie, workspaceID }）
 * @returns {Promise<object | null>} onLogin 返回的 configUpdate；用户取消返回 null
 */
export async function runLogin({
    key,
    position,
    loginUrl,
    cookieUrl,
    cookieName,
    onLogin,
}) {
    let action = "更新已有账号";
    try {
        const cfg = loadConfig();
        const accounts = Array.isArray(cfg[key]) ? cfg[key] : [];
        const len = accounts.length;

        // position 越界时交互式重新输入，留空取消抛 CanceledError
        const { position: pos, willCreate } = await resolvePosition(
            key,
            len,
            position,
        );
        action = willCreate ? "新建账号" : "更新已有账号";

        const chromium = await loadChromium();

        // 开浏览器前确认（取代固定等待，给用户准备时间并防 position 手误）
        const ok = await askConfirm(
            `即将打开浏览器登录 ${key}[${pos}]（${action}），继续？`,
        );
        if (!ok) {
            throw new CanceledError();
        }

        // 可重试的浏览器流程：浏览器被关闭时询问是否重开，登录超时等错误不重试
        let result;
        while (true) {
            try {
                result = await runBrowserFlow(
                    chromium,
                    key,
                    pos,
                    loginUrl,
                    cookieUrl,
                    cookieName,
                    onLogin,
                );
                break;
            } catch (err) {
                if (/浏览器被关闭/.test(err.message)) {
                    const retry =
                        await askConfirm("浏览器被关闭，是否重新开始登录？");
                    if (!retry) throw err;
                    continue;
                }
                throw err;
            }
        }

        const written = await writeBack(key, pos, result);
        if (written) {
            process.stderr.write(
                `✅ 登录成功，凭据已写入 config.json 的 ${key}[${pos}]（${action}）\n`,
            );
        } else {
            process.stderr.write(
                `❌ 登录成功但凭据未写入 config.json（见上方输出，请手动添加到 ${key}[${pos}]）\n`,
            );
        }
        return result.configUpdate;
    } catch (err) {
        if (err instanceof CanceledError) {
            process.stderr.write(`❌ ${err.message}\n`);
            return null;
        }
        throw err;
    }
}

// #endregion 登录入口 --------------------------------

export { isMainModule };
