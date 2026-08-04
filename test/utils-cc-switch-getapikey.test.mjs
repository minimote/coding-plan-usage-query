/**
 * @file utils-cc-switch getAPIKey 环境变量分支单元测试
 *
 * 只测环境变量优先级（不碰 CC-Switch db 的分支）：
 *   ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY，PROXY_MANAGED 视为占位符回退到 db
 *
 * PROXY_MANAGED 回退分支会走 db，通过 CC_SWITCH_DB_PATH 重定向到不存在的文件，
 * 断言其抛错而非把 PROXY_MANAGED 当真实 key 返回
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { getAPIKey } from "../src/utils/utils-cc-switch.mjs";

/** 备份并清理两个环境变量，返回恢复函数 */
function withEnv(overrides) {
    const prev = {
        ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    };
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    Object.assign(process.env, overrides);
    return () => {
        for (const [k, v] of Object.entries(prev)) {
            if (v === undefined) {
                delete process.env[k];
            } else {
                process.env[k] = v;
            }
        }
    };
}

test("getAPIKey: ANTHROPIC_AUTH_TOKEN 直接返回，不碰 db", async () => {
    const restore = withEnv({ ANTHROPIC_AUTH_TOKEN: "sk-token-123" });
    try {
        assert.equal(await getAPIKey(), "sk-token-123");
    } finally {
        restore();
    }
});

test("getAPIKey: 仅 ANTHROPIC_API_KEY 时返回它", async () => {
    const restore = withEnv({ ANTHROPIC_API_KEY: "sk-key-456" });
    try {
        assert.equal(await getAPIKey(), "sk-key-456");
    } finally {
        restore();
    }
});

test("getAPIKey: AUTH_TOKEN 优先于 API_KEY", async () => {
    const restore = withEnv({
        ANTHROPIC_AUTH_TOKEN: "sk-auth",
        ANTHROPIC_API_KEY: "sk-api",
    });
    try {
        assert.equal(await getAPIKey(), "sk-auth");
    } finally {
        restore();
    }
});

test("getAPIKey: PROXY_MANAGED 作为 AUTH_TOKEN 时不被当作真实 key 返回", async () => {
    // PROXY_MANAGED 是 CC-Switch 代理模式占位符，应回退到 db 分支
    const restoreEnv = withEnv({
        ANTHROPIC_AUTH_TOKEN: "PROXY_MANAGED",
        ANTHROPIC_API_KEY: "PROXY_MANAGED",
    });
    // 把 db 重定向到不存在的路径，强制 db 分支抛错（而非返回 PROXY_MANAGED）
    const prevDb = process.env.CC_SWITCH_DB_PATH;
    process.env.CC_SWITCH_DB_PATH = "__nonexistent_test_db_path__";
    try {
        await assert.rejects(getAPIKey(), (err) => {
            // 关键：抛错而非返回 "PROXY_MANAGED"
            assert.notEqual(err.message, "PROXY_MANAGED");
            return true;
        });
    } finally {
        restoreEnv();
        if (prevDb === undefined) {
            delete process.env.CC_SWITCH_DB_PATH;
        } else {
            process.env.CC_SWITCH_DB_PATH = prevDb;
        }
    }
});

test("getAPIKey: 无任何环境变量时走 db 分支抛错", async () => {
    const restoreEnv = withEnv({});
    const prevDb = process.env.CC_SWITCH_DB_PATH;
    process.env.CC_SWITCH_DB_PATH = "__nonexistent_test_db_path__";
    try {
        await assert.rejects(getAPIKey());
    } finally {
        restoreEnv();
        if (prevDb === undefined) {
            delete process.env.CC_SWITCH_DB_PATH;
        } else {
            process.env.CC_SWITCH_DB_PATH = prevDb;
        }
    }
});