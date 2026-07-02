/**
 * @file 根据 ANTHROPIC_BASE_URL 路由到对应用量查询脚本
 * 读 ~/.claude/settings.json 的 ANTHROPIC_BASE_URL，按域名分发到
 * get-plan-usage-ark-codingplan.js / get-plan-usage-opencode-go.js，拼接子脚本输出
 * 使用前需将 config.example.json 重命名为 config.json 并填写
 * ccstatusline-zh 自定义命令：node F:\xxx\get-plan-usage-all.js
 * 超时建议设为 5000
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// 调子脚本拿 stdout；子进程失败也不让本 router 退出码变 1
/**
 * 同步执行子脚本并返回其 stdout
 *
 * 子进程失败（超时、崩溃、非零退出、未输出任何内容）时不抛错，返回 "—" 占位，
 * 让本 router 的退出码保持 0；子脚本内部已自行打印表头与失败原因，
 * 故仅在子进程根本未启动时才会走到占位分支
 *
 * @param file 子脚本绝对路径
 * @return 子进程 stdout；子进程未产出任何输出时返回 "—"
 */
function safeExec(file) {
    try {
        return execFileSync("node", [file], {
            timeout: 4000,
            encoding: "utf8",
        });
    } catch (e) {
        return "—";
    }
}

/**
 * 读配置拿到 baseUrl，按域名分发到对用量查询子脚本，并拼接输出到 stdout
 *
 * 火山域名 → 仅火山；
 * opencode.ai(OpenCodeGo 未路由) → 火山在前、OpenCodeGo 在后换行拼接；
 * 其他（主要是 OpenCode 路由）→ 仅 OpenCodeGo
 */
function main() {
    const cfgPath = path.join(os.homedir(), ".claude", "settings.json");
    let baseUrl = "";
    try {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        baseUrl = (cfg.env && cfg.env.ANTHROPIC_BASE_URL) || "";
    } catch (e) {}

    const dir = __dirname;
    const goFile = path.join(dir, "get-plan-usage-opencode-go.js");
    const arkFile = path.join(dir, "get-plan-usage-ark-codingplan.js");

    if (/ark\.cn-beijing\.volces\.com/.test(baseUrl)) {
        // 火山 → 只显示火山
        process.stdout.write(safeExec(arkFile));
    } else if (/opencode\.ai/.test(baseUrl)) {
        // OpenCodeGo 未路由 → 火山在前，两个都显示，换行分隔
        const ark = safeExec(arkFile).trimEnd();
        const go = safeExec(goFile).trimEnd();
        process.stdout.write(ark + "\n" + go);
    } else {
        // 其他(主要是 OpenCode 路由的情况) → 只显示 go
        process.stdout.write(safeExec(goFile));
    }
}

main();
