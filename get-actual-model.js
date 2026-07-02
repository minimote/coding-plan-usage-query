const fs = require("fs");
const path = require("path");
const os = require("os");

// 读 stdin
const raw = fs.readFileSync(0, "utf8");

let j;
try {
    j = JSON.parse(raw);
} catch (e) {
    process.stdout.write(raw || "(empty stdin)");
    return;
}

const display = j && j.model && j.model.display_name;
if (
    display === undefined ||
    display === null ||
    String(display).trim() === ""
) {
    process.stdout.write(raw || "(empty stdin)");
    return;
}

// 读 settings.json 判断是否路由 + 取档位映射的真实模型名
const cfgPath = path.join(os.homedir(), ".claude", "settings.json");
let cfg;
try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
} catch (e) {
    process.stdout.write(String(display));
    return;
}

const baseUrl = (cfg && cfg.env && cfg.env.ANTHROPIC_BASE_URL) || "";

if (/:\/\/(127\.0\.0\.1|localhost)/.test(baseUrl)) {
    // 路由模式：按 display_name 前缀反推档位，拼上 [xxx] 后缀
    const lower = String(display).toLowerCase();
    let targetName, targetModel;
    if (lower.includes("opus")) {
        targetName = cfg.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME;
        targetModel = cfg.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
    } else if (lower.includes("sonnet")) {
        targetName = cfg.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME;
        targetModel = cfg.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    } else if (lower.includes("haiku")) {
        targetName = cfg.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME;
        targetModel = cfg.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
    } else if (lower.includes("fable")) {
        targetName = cfg.env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME;
        targetModel = cfg.env.ANTHROPIC_DEFAULT_FABLE_MODEL;
    } else {
        process.stdout.write(String(display));
        return;
    }

    if (
        targetName === undefined ||
        targetName === null ||
        String(targetName).trim() === ""
    ) {
        process.stdout.write("?");
        return;
    }

    const m = String(targetModel).match(/\[.*\]$/);
    if (m) {
        process.stdout.write(`${targetName}${m[0]}`);
    } else {
        process.stdout.write(String(targetName));
    }
} else {
    // 直连模式：直接输出 display_name
    process.stdout.write(String(display));
}
