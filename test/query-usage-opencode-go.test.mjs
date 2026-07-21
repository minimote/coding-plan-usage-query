/**
 * @file opencode HTML 解析单元测试
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUsageWindows } from "../src/query/query-usage-opencode-go.mjs";

/**
 * 构造一段模拟 opencode.ai SSR HTML 的片段
 *
 * 真实页面里用量对象形如 rollingUsage:$R12={usagePercent:...,resetInSec:...}
 * 本测试构造同构片段验证解析逻辑
 */
function makeHtml(windows) {
    let js = "";
    for (const [name, pct, sec] of windows) {
        js += `${name}Usage:$R[${Math.floor(Math.random() * 100)}]={usagePercent:${pct},resetInSec:${sec},other:"x"};`;
    }
    return `<html><script>window.__data={${js}};</script></html>`;
}

test("parseUsageWindows: 解析三窗口百分比与倒计时", () => {
    const html = makeHtml([
        ["rolling", 12.5, 1800],
        ["weekly", 45, 500000],
        ["monthly", 100, 2000000],
    ]);
    const usage = parseUsageWindows(html);
    assert.equal(usage.rolling.pct, 12.5);
    assert.equal(usage.rolling.sec, 1800);
    assert.equal(usage.weekly.pct, 45);
    assert.equal(usage.weekly.sec, 500000);
    assert.equal(usage.monthly.pct, 100);
    assert.equal(usage.monthly.sec, 2000000);
});

test("parseUsageWindows: 缺少某窗口时该窗口为 null", () => {
    const html = makeHtml([
        ["rolling", 10, 1800],
        ["weekly", 20, 3600],
    ]);
    const usage = parseUsageWindows(html);
    assert.ok(usage.rolling);
    assert.ok(usage.weekly);
    assert.equal(usage.monthly, null);
});

test("parseUsageWindows: 缺少 usagePercent 的窗口为 null", () => {
    // 手动构造一个有 resetInSec 但无 usagePercent 的窗口
    const html =
        `<script>rollingUsage:$R[1]={resetInSec:1800};` +
        `weeklyUsage:$R[2]={usagePercent:50,resetInSec:3600};</script>`;
    const usage = parseUsageWindows(html);
    assert.equal(usage.rolling, null);
    assert.ok(usage.weekly);
});

test("parseUsageWindows: resetInSec 缺失按 0 处理", () => {
    const html = `<script>rollingUsage:$R[1]={usagePercent:10};</script>`;
    const usage = parseUsageWindows(html);
    assert.equal(usage.rolling.sec, 0);
});

test("parseUsageWindows: 页面无用量数据时三窗口全 null", () => {
    const usage = parseUsageWindows("<html>no data here</html>");
    assert.equal(usage.rolling, null);
    assert.equal(usage.weekly, null);
    assert.equal(usage.monthly, null);
});

test("parseUsageWindows: 百分比支持小数与负数（原样解析）", () => {
    const html = makeHtml([["rolling", -5.5, 0]]);
    const usage = parseUsageWindows(html);
    assert.equal(usage.rolling.pct, -5.5);
});
