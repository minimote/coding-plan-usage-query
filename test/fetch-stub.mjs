/**
 * @file 查询脚本测试共用的 fetch stub
 *
 * 五个供应商脚本的请求层错误分支都靠 stub globalThis.fetch 验证，
 * stub 构造方式完全相同，故收敛到此一处维护
 */

/**
 * 构造 JSON fetch Response 的最小 stub
 *
 * 必须是真 stub 而非全局 mock.fetch：query-usage-cookie-expired 等用例需要
 * 同一测试文件内对不同 URL/不同次调用返回不同响应
 *
 * @param {object} body 响应体对象
 * @param {number} [status=200]
 */
export function makeJsonResp(body, status = 200) {
    return {
        status,
        ok: status >= 200 && status < 300,
        // 与 makeResp 的能力对齐：缺了它，在 3xx 分支上误用本构造函数会抛
        // TypeError，那种失败看起来像产品 bug 而非测试写错
        headers: { get: () => null },
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

/**
 * 用固定 Response stub fetch，执行 fn，结束后还原
 * @param {object} resp
 * @param {() => Promise<*>} fn
 */
export async function withFetch(resp, fn) {
    return withFetchByUrl(() => resp, fn);
}

/**
 * 构造文本/混合响应体的 fetch Response stub
 *
 * 与 makeJsonResp 的区别：body 是字符串，同时提供 text() 与 json()——
 * ollama 抓 HTML 走 text()，opencode 读 error.type 走 json()，
 * 另外还要 headers.get("location") 给 3xx 分支用
 *
 * @param {object} opts
 * @param {number} [opts.status=200]
 * @param {string|null} [opts.location] Location 响应头（3xx 用）
 * @param {string} [opts.body] 响应体
 */
export function makeResp({ status = 200, location = null, body = "" }) {
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: {
            get: (k) => (k.toLowerCase() === "location" ? location : null),
        },
        text: async () => body,
        // 非 JSON 的 body（HTML 页面）只在走 text() 的路径上出现，
        // 走到 json() 说明被测代码预期它是 JSON，抛错即符合预期
        json: async () => JSON.parse(body),
    };
}

/**
 * 按请求 URL 分发固定 Response stub fetch，结束后还原
 * @param {(url: string) => object} handler
 * @param {() => Promise<*>} fn
 */
export async function withFetchByUrl(handler, fn) {
    return withStub(async (url) => handler(String(url)), fn);
}

/**
 * 安装 stub fetch 并捕获每次调用的 init，结束后还原
 *
 * 用于断言请求头/方法等 fetch 选项。handler 收到的 init 是调用方传入的原始对象，
 * 返回的 Response 原样交给被测代码
 *
 * @param {(url: string, init: object) => object} handler
 * @param {() => Promise<*>} fn
 * @returns {Promise<Array<{ url: string, init: object }>>} 按调用顺序记录
 */
export async function withFetchCapture(handler, fn) {
    const calls = [];
    await withStub(async (url, init) => {
        calls.push({ url: String(url), init });
        return handler(String(url), init);
    }, fn);
    return calls;
}

/** save/restore globalThis.fetch 的唯一实现 */
async function withStub(impl, fn) {
    const orig = globalThis.fetch;
    globalThis.fetch = impl;
    try {
        return await fn();
    } finally {
        globalThis.fetch = orig;
    }
}
