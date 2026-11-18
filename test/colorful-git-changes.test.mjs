/**
 * @file colorful-git-changes 解析、着色与仓库检测单元测试
 *
 * 文件数（Δ）、单侧为 0、改名/二进制（0 增 0 删）、未跟踪文件、
 * 无 HEAD 的空仓库与 git 读失败均在此覆盖
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseShortStat,
  formatChanges,
  renderFromRaw,
} from "../src/tools/colorful-git-changes.mjs";
import { COLORS } from "../src/utils/utils-query-usage.mjs";

// #region 测试辅助 ----------------

const STATUS = "status --porcelain -z --untracked-files=all";

/**
 * 构造一个只响应指定命令的假 git 执行器
 *
 * 未登记的命令返回 null（模拟 git 失败），便于覆盖非仓库与超时分支
 *
 * @param {Record<string, string | null>} responses "子命令" -> 输出
 * @returns {(cwd: string, args: string[]) => string | null}
 */
function fakeGit(responses) {
  return (_cwd, args) => {
    const key = args.join(" ");
    return key in responses ? responses[key] : null;
  };
}

/** 假文件读取器：路径 -> 内容（缺省抛错，模拟读不到） */
function fakeReadFile(files) {
  return (path) => {
    const content = files[path.split(/[\\/]/).pop()];
    if (content === undefined) {
      throw new Error("ENOENT");
    }
    return Buffer.from(content);
  };
}

function payload(cwd) {
  return JSON.stringify({ cwd, workspace: { current_dir: cwd } });
}

// #endregion 测试辅助 --------------------------------

// #region parseShortStat ----------------

test("parseShortStat: 同时有新增与删除", () => {
  const out = parseShortStat(
    " 6 files changed, 48 insertions(+), 289 deletions(-)",
  );
  assert.deepEqual(out, { files: 6, insertions: 48, deletions: 289 });
});

test("parseShortStat: 单数形式 file changed", () => {
  const out = parseShortStat(" 1 file changed, 2 insertions(+)");
  assert.deepEqual(out, { files: 1, insertions: 2, deletions: 0 });
});

test("parseShortStat: 只有删除（单数形式）", () => {
  const out = parseShortStat(" 1 file changed, 1 deletion(-)");
  assert.deepEqual(out, { files: 1, insertions: 0, deletions: 1 });
});

test("parseShortStat: 0 增 0 删（改名 / 二进制）", () => {
  const out = parseShortStat(
    " 2 files changed, 0 insertions(+), 0 deletions(-)",
  );
  assert.deepEqual(out, { files: 2, insertions: 0, deletions: 0 });
});

test("parseShortStat: 空串或非字符串视为 0", () => {
  const zero = { files: 0, insertions: 0, deletions: 0 };
  assert.deepEqual(parseShortStat(""), zero);
  assert.deepEqual(parseShortStat(null), zero);
});

test("parseShortStat: 中文文案解析为 0（调用方应强制 LC_ALL=C）", () => {
  assert.deepEqual(parseShortStat(" 1 个文件被更改，2 处插入(+)"), {
    files: 0,
    insertions: 0,
    deletions: 0,
  });
});

// #endregion parseShortStat --------------------------------

// #region formatChanges ----------------

test("formatChanges: 文件数 + 新增绿 + 删除红", () => {
  assert.equal(
    formatChanges({ files: 6, insertions: 48, deletions: 289 }),
    `${COLORS.WHITE}Δ6${COLORS.RESET}${COLORS.GREEN}+48${COLORS.RED}-289${COLORS.RESET}`,
  );
});

test("formatChanges: 只有新增时不显示 -0", () => {
  assert.equal(
    formatChanges({ files: 1, insertions: 2, deletions: 0 }),
    `${COLORS.WHITE}Δ1${COLORS.RESET}${COLORS.GREEN}+2${COLORS.RESET}`,
  );
});

test("formatChanges: 只有删除时不显示 +0", () => {
  assert.equal(
    formatChanges({ files: 1, insertions: 0, deletions: 3 }),
    `${COLORS.WHITE}Δ1${COLORS.RESET}${COLORS.RED}-3${COLORS.RESET}`,
  );
});

test("formatChanges: 0 增 0 删但文件有改动时显示 ΔN", () => {
  assert.equal(
    formatChanges({ files: 2, insertions: 0, deletions: 0 }),
    `${COLORS.WHITE}Δ2${COLORS.RESET}`,
  );
});

test("formatChanges: 完全没改动返回空串", () => {
  assert.equal(
    formatChanges({ files: 0, insertions: 0, deletions: 0 }),
    "",
  );
});

// #endregion formatChanges --------------------------------

// #region renderFromRaw ----------------

test("renderFromRaw: 非 Git 仓库返回空串", () => {
  const git = fakeGit({});
  assert.equal(renderFromRaw(payload("F:\\tmp"), git), "");
});

test("renderFromRaw: 仓库内无变更返回空串", () => {
  const git = fakeGit({
    [STATUS]: "",
    "diff HEAD --shortstat": "",
  });
  assert.equal(renderFromRaw(payload("F:\\repo"), git), "");
});

test("renderFromRaw: 有变更时显示文件数与增删", () => {
  const git = fakeGit({
    [STATUS]: "",
    "diff HEAD --shortstat":
      " 6 files changed, 48 insertions(+), 289 deletions(-)",
  });
  assert.equal(
    renderFromRaw(payload("F:\\repo"), git),
    `${COLORS.WHITE}Δ6${COLORS.RESET}${COLORS.GREEN}+48${COLORS.RED}-289${COLORS.RESET}`,
  );
});

test("renderFromRaw: 只删不增不显示 +0", () => {
  const git = fakeGit({
    [STATUS]: "",
    "diff HEAD --shortstat": " 1 file changed, 3 deletions(-)",
  });
  assert.equal(
    renderFromRaw(payload("F:\\repo"), git),
    `${COLORS.WHITE}Δ1${COLORS.RESET}${COLORS.RED}-3${COLORS.RESET}`,
  );
});

test("renderFromRaw: 改名 / 二进制（0 增 0 删）显示 ΔN", () => {
  const git = fakeGit({
    [STATUS]: "",
    "diff HEAD --shortstat":
      " 2 files changed, 0 insertions(+), 0 deletions(-)",
  });
  assert.equal(
    renderFromRaw(payload("F:\\repo"), git),
    `${COLORS.WHITE}Δ2${COLORS.RESET}`,
  );
});

test("renderFromRaw: 未跟踪文件计入文件数与新增行", () => {
  const git = fakeGit({
    [STATUS]: "?? a.js\0?? b.txt\0",
    "diff HEAD --shortstat": " 1 file changed, 1 insertion(+)",
  });
  const readFile = fakeReadFile({ "a.js": "x\ny\n", "b.txt": "z" });
  // 1 个已跟踪文件 + 2 个未跟踪；新增 1 + 2 + 1
  assert.equal(
    renderFromRaw(payload("F:/repo"), git, readFile),
    `${COLORS.WHITE}Δ3${COLORS.RESET}${COLORS.GREEN}+4${COLORS.RESET}`,
  );
});

test("renderFromRaw: 二进制未跟踪文件只计文件数", () => {
  const git = fakeGit({
    [STATUS]: "?? bin.dat\0",
    "diff HEAD --shortstat": "",
  });
  const readFile = fakeReadFile({ "bin.dat": "\x00\x01\x02" });
  assert.equal(
    renderFromRaw(payload("F:/repo"), git, readFile),
    `${COLORS.WHITE}Δ1${COLORS.RESET}`,
  );
});

test("renderFromRaw: 空仓库（无 HEAD）退到暂存区 + 工作区", () => {
  const git = fakeGit({
    [STATUS]: "A  a.js\0",
    "diff --cached --shortstat": " 1 file changed, 2 insertions(+)",
    "diff --shortstat": "",
  });
  assert.equal(
    renderFromRaw(payload("F:/repo"), git),
    `${COLORS.WHITE}Δ1${COLORS.RESET}${COLORS.GREEN}+2${COLORS.RESET}`,
  );
});

test("renderFromRaw: 仓库正常但 git 读失败时输出警示符", () => {
  const git = fakeGit({
    [STATUS]: "",
    "diff HEAD --shortstat": null,
    "diff --cached --shortstat": null,
    "diff --shortstat": null,
  });
  assert.equal(
    renderFromRaw(payload("F:/repo"), git),
    `${COLORS.ORANGE}⚠${COLORS.RESET}`,
  );
});

test("renderFromRaw: 缺少 cwd 返回空串", () => {
  assert.equal(renderFromRaw(JSON.stringify({}), fakeGit({})), "");
});

test("renderFromRaw: 非法 JSON 返回空串", () => {
  assert.equal(renderFromRaw("{not json", fakeGit({})), "");
});

// #endregion renderFromRaw --------------------------------
