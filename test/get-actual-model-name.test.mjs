/**
 * @file get-actual-model-name 单元测试
 *
 * matchRoutedModel 为抽出的纯函数，覆盖路由模式的 tier 匹配逻辑；
 * getActualModelName 的输入解析与直连模式路径不依赖 settings.json 内容，可确定性测试
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    getActualModelName,
    matchRoutedModel,
} from "../src/tools/get-actual-model-name.mjs";

// #region matchRoutedModel ----------------

test("matchRoutedModel: 命中 tier 返回对应 NAME", () => {
    const env = {
        ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "glm-opus",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-latest",
    };
    assert.equal(matchRoutedModel("Claude Opus 4", env), "glm-opus");
});

test("matchRoutedModel: 从 MODEL 提取末尾 [xxx] 后缀拼到 NAME", () => {
    const env = {
        ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "glm-opus",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-latest[1M]",
    };
    assert.equal(matchRoutedModel("Claude Opus 4", env), "glm-opus[1M]");
});

test("matchRoutedModel: 后缀只取末尾单个括号组，不贪心吞掉靠前括号", () => {
    const env = {
        ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "glm-opus",
        // MODEL 含靠前括号：修复前 [.*]$ 贪心会把 "[beta]-latest[1M]" 整体当后缀
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm[beta]-latest[1M]",
    };
    assert.equal(matchRoutedModel("Claude Opus 4", env), "glm-opus[1M]");
});

test("matchRoutedModel: 多个 tier 命中时取 name 更长（更具体）者", () => {
    const env = {
        // 故意先定义短名，验证确实靠长度降序排序而非插入顺序
        ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "sonnet-name",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "sonnet-model",
        ANTHROPIC_DEFAULT_SONNET_4_MODEL_NAME: "sonnet4-name",
        ANTHROPIC_DEFAULT_SONNET_4_MODEL: "sonnet4-model",
    };
    // display 同时含 "sonnet" 与 "sonnet-4"，应取更长的 SONNET_4（真实显示名用连字符 / 空格）
    assert.equal(
        matchRoutedModel("claude-sonnet-4-20250514", env),
        "sonnet4-name",
    );
    assert.equal(matchRoutedModel("Claude Sonnet 4", env), "sonnet4-name");
});

test("matchRoutedModel: 无 tier 命中返回 null", () => {
    const env = {
        ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "sonnet-name",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "sonnet-model",
    };
    assert.equal(matchRoutedModel("Claude Opus 4", env), null);
});

test("matchRoutedModel: 缺少配对 _MODEL 的条目被排除", () => {
    const env = {
        ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "glm-opus",
        // 无 ANTHROPIC_DEFAULT_OPUS_MODEL
    };
    assert.equal(matchRoutedModel("Claude Opus 4", env), null);
});

test("matchRoutedModel: MODEL_NAME 值为空白时该条目被排除", () => {
    const env = {
        ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "   ",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-latest",
    };
    assert.equal(matchRoutedModel("Claude Opus 4", env), null);
});

test("matchRoutedModel: env 为空对象返回 null", () => {
    assert.equal(matchRoutedModel("Claude Opus 4", {}), null);
});

// #endregion matchRoutedModel --------------------------------

// #region getActualModelName 输入解析 ----------------

test("getActualModelName: 空输入返回 输入为空", () => {
    assert.equal(getActualModelName(""), "输入为空");
});

test("getActualModelName: 非法 JSON 返回 JSON 解析失败", () => {
    assert.equal(getActualModelName("{not json"), "JSON 解析失败");
});

test("getActualModelName: 缺少或空白 display_name 返回 未找到模型名", () => {
    assert.equal(getActualModelName(JSON.stringify({ model: {} })), "未找到模型名");
    assert.equal(
        getActualModelName(JSON.stringify({ model: { display_name: "  " } })),
        "未找到模型名",
    );
});

// #endregion getActualModelName 输入解析 --------------------------------

// #region getActualModelName 直连模式 ----------------

test("getActualModelName: 非本地 baseUrl 走直连模式返回 display_name", () => {
    // 环境变量优先于 settings.json，强制非本地 baseUrl 即直连，不依赖真实配置内容
    const prev = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    try {
        const raw = JSON.stringify({ model: { display_name: "Claude Opus 4" } });
        assert.equal(getActualModelName(raw), "Claude Opus 4");
    } finally {
        if (prev === undefined) {
            delete process.env.ANTHROPIC_BASE_URL;
        } else {
            process.env.ANTHROPIC_BASE_URL = prev;
        }
    }
});

// #endregion getActualModelName 直连模式 --------------------------------
