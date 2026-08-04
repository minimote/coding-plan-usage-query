/**
 * @file query-usage-smart 账号匹配单元测试
 *
 * 只测纯函数 matchAccountByApiKey（按 apiKey 在 config 各账号数组中查找），
 * 不涉及 getAPIKey / loadConfig 的 IO
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchAccountByApiKey } from "../src/query/query-usage-smart.mjs";
import { KEYS } from "../src/utils/utils-query-usage.mjs";

/**
 * 构造 config 对象
 *
 * @param {object} byKey 各 key 的账号数组
 * @returns {object}
 */
function cfg(byKey) {
    return { [KEYS.ARK]: byKey.ark, [KEYS.OLLAMA]: byKey.ollama, [KEYS.OPENCODE]: byKey.opencode, [KEYS.QWEN]: byKey.qwen };
}

test("matchAccountByApiKey: 命中 ark 第一个账号", () => {
    const c = cfg({
        ark: [
            { apiKey: "sk-ark-1", accessKeyId: "a1" },
            { apiKey: "sk-ark-2", accessKeyId: "a2" },
        ],
    });
    const m = matchAccountByApiKey(c, "sk-ark-1");
    assert.deepEqual(m, { key: KEYS.ARK, index: 0, account: c.ark[0] });
});

test("matchAccountByApiKey: 同 key 多账号命中正确 index", () => {
    const c = cfg({
        ark: [
            { apiKey: "sk-ark-1" },
            { apiKey: "sk-ark-2" },
        ],
    });
    const m = matchAccountByApiKey(c, "sk-ark-2");
    assert.equal(m.index, 1);
    assert.equal(m.account.apiKey, "sk-ark-2");
});

test("matchAccountByApiKey: 命中靠后的 key（qwen）", () => {
    const c = cfg({
        ark: [{ apiKey: "sk-ark-1" }],
        qwen: [{ apiKey: "sk-qwen-1", cookie: "c" }],
    });
    const m = matchAccountByApiKey(c, "sk-qwen-1");
    assert.equal(m.key, KEYS.QWEN);
    assert.equal(m.index, 0);
});

test("matchAccountByApiKey: 按 QUERY_FNS 顺序取第一个命中（ark 优先于 qwen）", () => {
    // 两个 key 都有相同 apiKey，应返回顺序在前的 ark
    const c = cfg({
        ark: [{ apiKey: "same-key" }],
        qwen: [{ apiKey: "same-key" }],
    });
    const m = matchAccountByApiKey(c, "same-key");
    assert.equal(m.key, KEYS.ARK);
});

test("matchAccountByApiKey: 未匹配返回 null", () => {
    const c = cfg({ ark: [{ apiKey: "sk-ark-1" }] });
    assert.equal(matchAccountByApiKey(c, "not-exist"), null);
});

test("matchAccountByApiKey: apiKey 为空/null/undefined 返回 null", () => {
    const c = cfg({ ark: [{ apiKey: "sk-ark-1" }] });
    assert.equal(matchAccountByApiKey(c, ""), null);
    assert.equal(matchAccountByApiKey(c, null), null);
    assert.equal(matchAccountByApiKey(c, undefined), null);
});

test("matchAccountByApiKey: 账号 apiKey 为空字符串的条目不被匹配", () => {
    // 即使传入空串，也不应匹配到 apiKey 为空的账号（a.apiKey falsy 短路）
    const c = cfg({ ark: [{ apiKey: "" }, { apiKey: "sk-ark-2" }] });
    assert.equal(matchAccountByApiKey(c, ""), null);
    // 但能匹配到第二个
    assert.equal(matchAccountByApiKey(c, "sk-ark-2").index, 1);
});

test("matchAccountByApiKey: 某 key 不是数组（undefined）时跳过不报错", () => {
    const c = cfg({ qwen: [{ apiKey: "sk-qwen-1" }] });
    // ark/ollama/opencode 均为 undefined
    const m = matchAccountByApiKey(c, "sk-qwen-1");
    assert.equal(m.key, KEYS.QWEN);
});

test("matchAccountByApiKey: 空配置返回 null", () => {
    assert.equal(matchAccountByApiKey({}, "sk-any"), null);
});

test("matchAccountByApiKey: 账号对象为 null 的槽位被跳过", () => {
    const c = cfg({ ark: [null, { apiKey: "sk-ark-2" }] });
    const m = matchAccountByApiKey(c, "sk-ark-2");
    assert.equal(m.index, 1);
});