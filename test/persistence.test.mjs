/**
 * dsh-code-quote 持久化自测
 *   node test/persistence.test.mjs
 *
 * 覆盖：
 *   1. put 成功后 pre-step 注入完整代码；
 *   2. 「重启」（新模块实例、同一 dataDir）后快照仍可命中——即 0.2.0 修复点；
 *   3. 未知 id 走「快照已失效」回退（不阻塞）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const dataDir = mkdtempSync(join(tmpdir(), 'dshcq-test-'))
process.env.DSH_CODE_QUOTE_DATA_DIR = dataDir

function makeCtx() {
  const routes = new Map()
  let preStep = null
  const ctx = {
    logger: { info() {}, warn() {} },
    inject(_deps, fn) {
      fn({
        effect(factory) { factory() },
        webServer: { register(route) { routes.set(route.path, route.handler); return () => {} } },
      })
    },
    on(event, fn) { if (event === 'agent/pre-step') preStep = fn },
  }
  return { ctx, routes, get preStep() { return preStep } }
}

function post(handler, body) {
  return new Promise((resolve, reject) => {
    const request = {
      method: 'POST',
      headers: { origin: 'http://x', host: 'x' },
      on(type, fn) {
        if (type === 'data') fn(Buffer.from(JSON.stringify(body)))
        if (type === 'end') fn()
      },
      destroy() {},
    }
    const response = {
      statusCode: 0, payload: null,
      writeHead(code) { this.statusCode = code },
      end(data) { this.payload = data ? JSON.parse(data) : null; resolve(this) },
    }
    Promise.resolve(handler(request, response)).catch(reject)
  })
}

async function runPreStep(preStep, text) {
  return preStep({ turn: 1, step: 1 }, async () => ({
    kind: 'enter',
    messages: [{ role: 'user', content: [{ type: 'text', text }] }],
  }))
}

const appended = (decision) =>
  (decision.messages || []).filter((m) => m && m.source && m.source.plugin === 'dsh-code-quote')

// --- 进程 1：写入快照并就地命中 ---
const mod1 = await import('../src/plugin.js')
const box1 = makeCtx()
mod1.apply(box1.ctx)
const put1 = box1.routes.get('/dsh-code-quote/put')

const res1 = await post(put1, { id: 'qtest1', header: 'a/b.js:1-2', code: 'const a = 1\nconst b = 2' })
assert.equal(res1.statusCode, 200)
assert.deepEqual(res1.payload, { ok: true })

const d1 = await runPreStep(box1.preStep, 'see ⟦代码引用#qtest1|a/b.js:1-2⟧ here')
assert.equal(appended(d1).length, 1)
assert.ok(appended(d1)[0].content[0].text.includes('const a = 1'), '应注入完整代码')

// --- 「重启」：新模块实例，同一 dataDir，快照应已从磁盘载回 ---
const mod2 = await import('../src/plugin.js?restart=1')
const box2 = makeCtx()
mod2.apply(box2.ctx)

const d2 = await runPreStep(box2.preStep, 'see ⟦代码引用#qtest1|a/b.js:1-2⟧ here')
assert.equal(appended(d2).length, 1)
assert.ok(appended(d2)[0].content[0].text.includes('const b = 2'), '重启后快照应仍在')

// --- 未知 id → 失效回退（不阻塞、仍追加提示消息） ---
const d3 = await runPreStep(box2.preStep, '⟦代码引用#qnope|x:1⟧')
assert.equal(appended(d3).length, 1)
assert.ok(appended(d3)[0].content[0].text.includes('快照已失效'), '未知 id 应走失效回退')

rmSync(dataDir, { recursive: true, force: true })
console.log('persistence test passed (put / restart-survival / missing-fallback)')
