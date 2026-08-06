/**
 * @file getActualModelName 路由模式单元测试
 *
 * 覆盖 getActualModelName 的路由模式分支（本地 baseUrl 判定 + settings.json env 匹配 +
 * 未命中回退 display_name），并锁定 baseUrl 正则的锚定修复（localhost.evil.com 不应判为本地）。
 *
 * 通过 CC_CLAUDE_SETTINGS_PATH 环境变量把 settings.json 重定向到临时文件，
 * 避免触碰真实 ~/.claude/settings.json
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getActualModelName } from "../src/tools/get-actual-model-name.mjs";

const TMP = mkdtempSync(join(tmpdir(), "cc-model-settings-test-"));

test.after(() => {
    rmSync(TMP, { recursive: true, force: true });
});

/**
 * 在路由模式下测试 getActualModelName：把假 settings.json 写入临时目录并重定向，
 * 设置 ANTHROPIC_BASE_URL 环境变量，结束后还原
 *
 * @param {object} settingsObj 假 settings.json 内容
 * @param {string} baseUrl 注入的 ANTHROPIC_BASE_URL
 * @param {() => void} fn 含断言的测试体
 */
function withRoutedSettings(settingsObj, baseUrl, fn) {
    const settingsPath = join(TMP, "settings.json");
    writeFileSync(settingsPath, JSON.stringify(settingsObj));
    const prevUrl = process.env.ANTHROPIC_BASE_URL;
    const prevSettings = process.env.CC_CLAUDE_SETTINGS_PATH;
    process.env.ANTHROPIC_BASE_URL = baseUrl;
    process.env.CC_CLAUDE_SETTINGS_PATH = settingsPath;
    try {
        fn();
    } finally {
        if (prevUrl === undefined) {
            delete process.env.ANTHROPIC_BASE_URL;
        } else {
            process.env.ANTHROPIC_BASE_URL = prevUrl;
        }
        if (prevSettings === undefined) {
            delete process.env.CC_CLAUDE_SETTINGS_PATH;
        } else {
            process.env.CC_CLAUDE_SETTINGS_PATH = prevSettings;
        }
    }
}

// #region 路由模式：匹配与回退 ----------------

test("getActualModelName: 本地 baseUrl 走路由模式，匹配 tier 返回真实模型名", () => {
    withRoutedSettings(
        {
            env: {
                ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "glm-opus",
                ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-latest[1M]",
            },
        },
        "http://localhost:8080",
        () => {
            const raw = JSON.stringify({
                model: { display_name: "Claude Opus 4" },
            });
            assert.equal(getActualModelName(raw), "glm-opus[1M]");
        },
    );
});

test("getActualModelName: 路由模式未匹配 tier 回退 display_name", () => {
    withRoutedSettings({ env: {} }, "http://127.0.0.1:3000", () => {
        const raw = JSON.stringify({
            model: { display_name: "Claude Opus 4" },
        });
        assert.equal(getActualModelName(raw), "Claude Opus 4");
    });
});

test("getActualModelName: 路由模式 baseUrl 优先取环境变量而非 settings.json", () => {
    // settings.json 里 baseUrl 是公网（直连），但环境变量注入本地（路由）→ 应走路由模式
    withRoutedSettings(
        {
            env: {
                ANTHROPIC_BASE_URL: "https://api.anthropic.com",
                ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "glm-sonnet",
                ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-4",
            },
        },
        "http://localhost:11434",
        () => {
            const raw = JSON.stringify({
                model: { display_name: "Claude Sonnet 4" },
            });
            assert.equal(getActualModelName(raw), "glm-sonnet");
        },
    );
});

// #endregion 路由模式：匹配与回退 --------------------------------

// #region baseUrl 正则锚定（锁定 #2 修复） ----------------

test("getActualModelName: localhost.evil.com 不判为本地路由（直连）", () => {
    // 修复前 localhost 前缀子串匹配会把 evil.com 误判为本地路由；
    // 锚定后应走直连模式返回 display_name，不读 env 匹配
    withRoutedSettings(
        {
            env: {
                ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "should-not-match",
                ANTHROPIC_DEFAULT_OPUS_MODEL: "x",
            },
        },
        "http://localhost.evil.com",
        () => {
            const raw = JSON.stringify({
                model: { display_name: "Claude Opus 4" },
            });
            assert.equal(getActualModelName(raw), "Claude Opus 4");
        },
    );
});

test("getActualModelName: 本地 baseUrl 无端口无路径仍判为路由", () => {
    withRoutedSettings(
        {
            env: {
                ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "glm-opus",
                ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-latest",
            },
        },
        "http://localhost",
        () => {
            const raw = JSON.stringify({
                model: { display_name: "Claude Opus 4" },
            });
            assert.equal(getActualModelName(raw), "glm-opus");
        },
    );
});

// #endregion baseUrl 正则锚定 --------------------------------