/**
 * @file colorful-git-changes.mjs
 *
 * 从 ccstatusline-zh 的标准输入接收 JSON，取当前仓库的改动并着色输出
 * 颜色复用 utils-query-usage.mjs 的 COLORS，与用量查询状态栏配色统一
 *
 * 显示格式：`Δ2+48-289`——Δ 后是改动文件数（含未跟踪文件），其后是增删行数；
 * 只增 / 只删时不显示另一侧；有改动但增删为 0（改名、二进制）只显示 `ΔN`；
 * 完全没改动时什么都不输出
 *
 * 用法:
 *   node colorful-git-changes.mjs
 *
 * 也可被 import 后调用 renderFromRaw(raw)
 */

import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { COLORS, isMainModule } from "../utils/utils-query-usage.mjs";

// #region 核心逻辑 ----------------

/** 单条 git 命令的超时；失败与超时一律视为读不到 */
const GIT_TIMEOUT_MS = 1500;

/** 超过这个大小的未跟踪文件不数行，只计文件数 */
const UNTRACKED_MAX_BYTES = 2_000_000;

/** 列改动文件（含未跟踪）的命令 */
const STATUS_ARGS = [
  "status",
  "--porcelain",
  "-z",
  "--untracked-files=all",
];

/**
 * 从 `git diff --*shortstat` 的文本解析文件数与增删行数
 *
 * 只解析英文输出：调用 git 时强制 LC_ALL=C，避免本地化文案解析不出来
 *
 * @param {string} stat git --shortstat 的原始输出
 * @returns {{files: number, insertions: number, deletions: number}} 缺失或非法时为 0
 */
export function parseShortStat(stat) {
  const text = typeof stat === "string" ? stat : "";
  const num = (re) => {
    const m = re.exec(text);
    return m ? Number(m[1]) : 0;
  };
  return {
    files: num(/(\d+)\s+files?\s+changed/),
    insertions: num(/(\d+)\s+insertions?/),
    deletions: num(/(\d+)\s+deletions?/),
  };
}

/** 两组统计相加 */
function addStats(a, b) {
  return {
    files: a.files + b.files,
    insertions: a.insertions + b.insertions,
    deletions: a.deletions + b.deletions,
  };
}

/**
 * 把统计渲染成着色后的显示串，如 `Δ2+48-289`
 *
 * Δ 后是改动文件数（白色）；新增绿色、删除红色；单侧为 0 时省略该侧；
 * 无改动时返回空串
 *
 * @param {{files?: number, insertions: number, deletions: number}} changes
 * @returns {string} 着色后的显示串；无变更时为空串
 */
export function formatChanges({
  files = 0,
  insertions = 0,
  deletions = 0,
}) {
  const count = files > 0 ? `${COLORS.WHITE}Δ${files}${COLORS.RESET}` : "";
  let diff = "";
  if (insertions > 0) {
    diff += `${COLORS.GREEN}+${insertions}`;
  }
  if (deletions > 0) {
    diff += `${COLORS.RED}-${deletions}`;
  }
  if (diff) {
    diff += COLORS.RESET;
  }
  return count + diff;
}

/**
 * 在指定目录执行 git 子命令
 *
 * 强制英文输出（--shortstat 的文案要解析），并禁用可选锁，避免与编辑器抢 index
 *
 * @param {string} cwd 执行目录
 * @param {string[]} args git 参数
 * @returns {string | null} 标准输出（已 trim）；失败或超时返回 null
 */
function runGit(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      env: {
        ...process.env,
        LC_ALL: "C",
        LANG: "C",
        GIT_OPTIONAL_LOCKS: "0",
      },
    }).trim();
  } catch {
    return null;
  }
}

/**
 * 从 `git status --porcelain -z` 的输出取未跟踪文件
 *
 * @param {string} statusOut git status 输出
 * @returns {string[]} 相对路径列表
 */
function untrackedPaths(statusOut) {
  if (typeof statusOut !== "string" || statusOut === "") {
    return [];
  }
  return statusOut
    .split("\0")
    .filter((entry) => entry.startsWith("?? "))
    .map((entry) => entry.slice(3));
}

/**
 * 统计文件行数；二进制或读不到时返回 0
 *
 * @param {string} path 文件绝对路径
 * @param {typeof readFileSync} readFile 读取器，便于测试注入
 * @returns {number}
 */
function countLines(path, readFile) {
  try {
    const buf = readFile(path);
    if (buf.length === 0 || buf.length > UNTRACKED_MAX_BYTES) {
      return 0;
    }
    // 含 NUL 视为二进制：只计文件数，不计行数
    if (buf.includes(0)) {
      return 0;
    }
    let lines = 0;
    for (const byte of buf) {
      if (byte === 0x0a) {
        lines += 1;
      }
    }
    return buf[buf.length - 1] === 0x0a ? lines : lines + 1;
  } catch {
    return 0;
  }
}

/**
 * 从原始 JSON 字符串渲染着色后的 Git 变更显示
 *
 * 不是 Git 仓库、无变更、JSON 非法或缺少 cwd 时返回空串；
 * 仓库正常但 git 读失败（超时等）输出 ⚠，与「无变更」区分
 *
 * @param {string} raw ccstatusline 传入的 JSON
 * @param {(cwd: string, args: string[]) => string | null} [git] git 执行器，便于测试注入
 * @param {(path: string) => Buffer} [readFile] 文件读取器，便于测试注入
 * @returns {string} 着色后的显示串
 */
export function renderFromRaw(raw, git = runGit, readFile = readFileSync) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return "";
  }

  const cwd = data?.workspace?.current_dir || data?.cwd;
  if (!cwd) {
    return "";
  }

  // 非 Git 仓库时 git status 直接失败
  const statusOut = git(cwd, STATUS_ARGS);
  if (statusOut === null) {
    return "";
  }
  const untracked = untrackedPaths(statusOut);

  // 与 HEAD 比，已暂存与未暂存的变更都计入；空仓库（无 HEAD）时退到暂存区 + 工作区
  let stat;
  const head = git(cwd, ["diff", "HEAD", "--shortstat"]);
  if (head !== null) {
    stat = parseShortStat(head);
  } else {
    const cached = git(cwd, ["diff", "--cached", "--shortstat"]);
    const work = git(cwd, ["diff", "--shortstat"]);
    if (cached === null && work === null) {
      // 仓库正常但 git 读不到（超时 / 损坏）：给个提示，别和「无变更」混淆
      return `${COLORS.ORANGE}⚠${COLORS.RESET}`;
    }
    stat = addStats(parseShortStat(cached ?? ""), parseShortStat(work ?? ""));
  }

  let insertions = stat.insertions;
  for (const path of untracked) {
    insertions += countLines(join(cwd, path), readFile);
  }

  return formatChanges({
    files: stat.files + untracked.length,
    insertions,
    deletions: stat.deletions,
  });
}

// #endregion 核心逻辑 --------------------------------

// #region CLI 壳 ----------------

/**
 * 主函数：读 stdin -> 渲染着色 Git 变更 -> 输出
 */
function main() {
  // 终端直接运行时 stdin 为 TTY，readFileSync(0) 会阻塞，给出提示
  if (process.stdin.isTTY) {
    process.stdout.write(
      "请在 ccstatusline / ccstatusline-zh 中作为自定义命令调用",
    );
    return;
  }
  let raw;
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    // stdin 读取失败（管道断开等）按无输出处理
    raw = "";
  }
  process.stdout.write(renderFromRaw(raw));
}

if (isMainModule(import.meta.url)) {
  main();
}

// #endregion CLI 壳 --------------------------------
