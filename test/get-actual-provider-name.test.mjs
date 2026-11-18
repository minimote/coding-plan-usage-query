/**
 * @file get-actual-provider-name 显示值计算单元测试
 *
 * 覆盖 resolveProviderDisplay 的显示/隐藏判定、free- 前缀剥离与聚合模式的固定显示，
 * 不触碰真实配置文件
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProviderDisplay } from "../src/tools/get-actual-provider-name.mjs";
import { STACK_DISPLAY_NAME } from "../src/utils/utils-cc-switch.mjs";

const MATCHED = { key: "ark", index: 0, account: {} };

test("resolveProviderDisplay: 无套餐账号时返回供应商名", () => {
  assert.equal(resolveProviderDisplay(null, "claude-pro"), "claude-pro");
});

test("resolveProviderDisplay: 名字以 free- 开头时剥前缀返回（无论是否有套餐账号）", () => {
  assert.equal(resolveProviderDisplay(null, "free-claude"), "claude");
  assert.equal(resolveProviderDisplay(MATCHED, "free-claude"), "claude");
});

test("resolveProviderDisplay: 匹配到套餐账号且名字无 free- 前缀时返回 null", () => {
  assert.equal(resolveProviderDisplay(MATCHED, "claude-pro"), null);
});

test("resolveProviderDisplay: 空名剥前缀后为空串仍返回，而非误判为不显示", () => {
  // 无套餐账号 + 空名：返回空串（剥前缀后为空），不是 null
  assert.equal(resolveProviderDisplay(null, ""), "");
  // 有套餐账号 + 空名：无 free- 前缀，返回 null 不显示
  assert.equal(resolveProviderDisplay(MATCHED, ""), null);
});

test("resolveProviderDisplay: 聚合模式无视套餐账号匹配，固定显示「聚合」", () => {
  assert.equal(
    resolveProviderDisplay(MATCHED, STACK_DISPLAY_NAME, true),
    STACK_DISPLAY_NAME,
  );
  assert.equal(
    resolveProviderDisplay(null, STACK_DISPLAY_NAME, true),
    STACK_DISPLAY_NAME,
  );
});
