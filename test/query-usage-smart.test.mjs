/**
 * @file query-usage-smart 免费模型判断单元测试
 *
 * isFreeModelName 为抽出的纯函数。测试强制直连模式（ANTHROPIC_BASE_URL 设为非本地），
 * 使 getActualModelName 直接返回 display_name，不依赖真实 ~/.claude/settings.json 的路由配置
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isFreeModelName } from "../src/query/query-usage-smart.mjs";

/** 强制 getActualModelName 走直连模式（ANTHROPIC_BASE_URL 非本地），返回恢复函数 */
function forceDirectMode() {
    const prev = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
    return () => {
        if (prev === undefined) delete process.env.ANTHROPIC_BASE_URL;
        else process.env.ANTHROPIC_BASE_URL = prev;
    };
}

test("isFreeModelName: 模型名含 free 返回 true", () => {
    const restore = forceDirectMode();
    try {
        const raw = JSON.stringify({
            model: { display_name: "claude-haiku-4-5-free" },
        });
        assert.equal(isFreeModelName(raw), true);
    } finally {
        restore();
    }
});

test("isFreeModelName: 大小写不敏感（FREE）", () => {
    const restore = forceDirectMode();
    try {
        const raw = JSON.stringify({
            model: { display_name: "claude-haiku-4-5-FREE" },
        });
        assert.equal(isFreeModelName(raw), true);
    } finally {
        restore();
    }
});

test("isFreeModelName: 模型名不含 free 返回 false", () => {
    const restore = forceDirectMode();
    try {
        const raw = JSON.stringify({
            model: { display_name: "claude-opus-4" },
        });
        assert.equal(isFreeModelName(raw), false);
    } finally {
        restore();
    }
});

test("isFreeModelName: 空输入 / 空白 / 非法 JSON 返回 false", () => {
    assert.equal(isFreeModelName(""), false);
    assert.equal(isFreeModelName("   "), false);
    assert.equal(isFreeModelName(undefined), false);
    assert.equal(isFreeModelName(null), false);
    assert.equal(isFreeModelName("{not json"), false);
});
