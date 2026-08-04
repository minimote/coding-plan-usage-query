/**
 * @file query-usage-all 分组拼接逻辑单元测试
 *
 * 只测纯函数 groupOutputs（有效行在前、无效行在后、中间空行分隔），
 * 不涉及 loadConfig / 各查询函数的网络 IO
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    groupOutputs,
} from "../src/query/query-usage-all.mjs";
import {
    ERROR_MARK,
    NO_ACTIVE_PLAN,
} from "../src/utils/utils-query-usage.mjs";

const OK = (label) => `${label} | 五:1% ↻ 1h`;
const ERR = (label, msg) => `${label} | ${ERROR_MARK}${msg}`;
const NO_PLAN = (label) => ERR(label, NO_ACTIVE_PLAN);

test("groupOutputs: 有效行在前、无效行在后，组内顺序保留", () => {
    const out = groupOutputs([
        OK("火山1"),
        NO_PLAN("火山2"),
        OK("Ollama"),
        ERR("Go", "网络错误"),
    ]);
    const lines = out.split("\n");
    assert.deepEqual(lines, [
        OK("火山1"),
        OK("Ollama"),
        "", // 组间空行
        NO_PLAN("火山2"),
        ERR("Go", "网络错误"),
    ]);
});

test("groupOutputs: 两组都非空时中间有且仅有一个空行", () => {
    const out = groupOutputs([OK("A"), ERR("B", "x")]);
    assert.equal(out, `${OK("A")}\n\n${ERR("B", "x")}`);
});

test("groupOutputs: 只有有效行时无多余空行", () => {
    const out = groupOutputs([OK("A"), OK("B")]);
    assert.equal(out, `${OK("A")}\n${OK("B")}`);
});

test("groupOutputs: 只有无效行时开头与结尾无多余空行", () => {
    const out = groupOutputs([ERR("A", "x"), NO_PLAN("B")]);
    assert.equal(out, `${ERR("A", "x")}\n${NO_PLAN("B")}`);
});

test("groupOutputs: 空串被过滤", () => {
    const out = groupOutputs(["", OK("A"), "", ERR("B", "x"), ""]);
    assert.equal(out, `${OK("A")}\n\n${ERR("B", "x")}`);
});

test("groupOutputs: 全空返回空串", () => {
    assert.equal(groupOutputs(["", "", ""]), "");
    assert.equal(groupOutputs([]), "");
});

test("groupOutputs: 无活跃套餐行默认归到无效组", () => {
    const out = groupOutputs([OK("A"), NO_PLAN("B")]);
    const lines = out.split("\n");
    assert.deepEqual(lines, [OK("A"), "", NO_PLAN("B")]);
});

test("groupOutputs: hideOnNoActivePlan 过滤无活跃套餐行，其余错误行仍保留", () => {
    const out = groupOutputs(
        [OK("A"), NO_PLAN("B"), ERR("C", "网络错误")],
        { hideOnNoActivePlan: true },
    );
    // B 被过滤，剩 A（有效）和 C（无效），中间仍有一个空行
    assert.equal(out, `${OK("A")}\n\n${ERR("C", "网络错误")}`);
});

test("groupOutputs: hideOnNoActivePlan 过滤后只剩有效行时无多余空行", () => {
    const out = groupOutputs(
        [OK("A"), OK("B"), NO_PLAN("C")],
        { hideOnNoActivePlan: true },
    );
    assert.equal(out, `${OK("A")}\n${OK("B")}`);
});

test("groupOutputs: hideOnNoActivePlan 过滤匹配错误消息部分，不误杀含此字样的有效行", () => {
    // 自定义标签里恰好含 "无活跃套餐" 字样的有效行不应被误杀
    const tricky = "无活跃套餐账号 | 五:1% ↻ 1h";
    const out = groupOutputs([tricky, NO_PLAN("B")], {
        hideOnNoActivePlan: true,
    });
    // tricky 不含 ERROR_MARK+NO_ACTIVE_PLAN，视为有效行保留；B 被过滤
    assert.equal(out, tricky);
});

test("groupOutputs: label 含 ❌ 字样的有效行不误判为错误行", () => {
    // 用户给弃用账号加 "❌ " 前缀是常见习惯：label 含 ❌ 但数据段正常
    const tricky = `${ERROR_MARK}旧账号 | 五:1% ↻ 1h`;
    const out = groupOutputs([tricky, ERR("B", "网络错误")]);
    // tricky 的数据段不含 ERROR_MARK，应归入有效组而非垫底
    const lines = out.split("\n");
    assert.deepEqual(lines, [tricky, "", ERR("B", "网络错误")]);
});

test("groupOutputs: hideOnNoActivePlan 不误杀 label 含 ❌ 与「无活跃套餐」字样的有效行", () => {
    // 原实现整行匹配 "❌ 无活跃套餐"，此 label 会被静默丢弃；现按数据段匹配应保留
    const tricky = `${ERROR_MARK}无活跃套餐账号 | 五:1% ↻ 1h`;
    const out = groupOutputs([tricky, NO_PLAN("B")], {
        hideOnNoActivePlan: true,
    });
    assert.equal(out, tricky);
});