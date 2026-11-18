/**
 * @file 测试环境隔离：无订阅状态文件重定向到临时目录
 *
 * 多个查询用例会因 NO_ACTIVE_PLAN 写入状态文件；不重定向会污染开发者真实的
 * tmp/no-active-state.json（测试夹具键与线上状态共享、互相覆盖）。
 * 以副作用导入使用：import "./no-active-env.mjs";
 */
import { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "cc-query-state-test-"));

process.env.CC_NO_ACTIVE_STATE_PATH = join(TMP, "no-active-state.json");

after(() => {
    rmSync(TMP, { recursive: true, force: true });
});
