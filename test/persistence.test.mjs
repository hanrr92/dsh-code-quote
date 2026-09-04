/**
 * dsh-code-quote 持久化自测
 *   node test/persistence.test.mjs
 *
 * 覆盖：
 *   1. put 成功后 pre-step 注入完整代码；
 *   2. 「重启」（新模块实例、同一 dataDir）后快照仍可命中——即 0.2.0 修复点；
 *   3. 未知 id 走「快照已失效」回退（不阻塞）；
 *   4. 0.3.0 新形态 @⟦id⟧header 扫描、新旧混排合并、新形态字面模板不误扫；
 *   5. 0.3.2 chipMode 默认开 + 环境变量可覆盖（0 关 / 1 开）。
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

function get(handler) {
  return new Promise((resolve, reject) => {
    const request = { method: 'GET', headers: { origin: 'http://x', host: 'x' }, on() {}, destroy() {} }
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

const res1 = await post(put1, { id: 'qtest1xyz', header: 'a/b.js:1-2', code: 'const a = 1\nconst b = 2' })
assert.equal(res1.statusCode, 200)
assert.deepEqual(res1.payload, { ok: true })

const d1 = await runPreStep(box1.preStep, 'see ⟦代码引用#qtest1xyz|a/b.js:1-2⟧ here')
assert.equal(appended(d1).length, 1)
assert.ok(appended(d1)[0].content[0].text.includes('const a = 1'), '应注入完整代码')

// --- 「重启」：新模块实例，同一 dataDir，快照应已从磁盘载回 ---
const mod2 = await import('../src/plugin.js?restart=1')
const box2 = makeCtx()
mod2.apply(box2.ctx)

const d2 = await runPreStep(box2.preStep, 'see ⟦代码引用#qtest1xyz|a/b.js:1-2⟧ here')
assert.equal(appended(d2).length, 1)
assert.ok(appended(d2)[0].content[0].text.includes('const b = 2'), '重启后快照应仍在')

// --- 未知 id → 失效回退（不阻塞、仍追加提示消息） ---
const d3 = await runPreStep(box2.preStep, '⟦代码引用#qnopeaaaa|x:1⟧')
assert.equal(appended(d3).length, 1)
assert.ok(appended(d3)[0].content[0].text.includes('快照已失效'), '未知 id 应走失效回退')

// --- 配置端点（#3）：默认值（0.3.2 起 chipMode 默认开）+ 环境变量覆盖 ---
const cfg1 = await get(box1.routes.get('/dsh-code-quote/config'))
assert.equal(cfg1.statusCode, 200)
assert.deepEqual(cfg1.payload, { minInserted: 30, minSingleLineChars: 40, chipMode: true })
process.env.DSH_CODE_QUOTE_MIN_INSERTED = '12'
process.env.DSH_CODE_QUOTE_MIN_SINGLE_LINE_CHARS = '25'
const cfg2 = await get(box1.routes.get('/dsh-code-quote/config'))
assert.deepEqual(cfg2.payload, { minInserted: 12, minSingleLineChars: 25, chipMode: true })
process.env.DSH_CODE_QUOTE_CHIP_MODE = '0'
const cfg3 = await get(box1.routes.get('/dsh-code-quote/config'))
assert.deepEqual(cfg3.payload, { minInserted: 12, minSingleLineChars: 25, chipMode: false })
process.env.DSH_CODE_QUOTE_CHIP_MODE = '1'
const cfg4 = await get(box1.routes.get('/dsh-code-quote/config'))
assert.deepEqual(cfg4.payload, { minInserted: 12, minSingleLineChars: 25, chipMode: true })
delete process.env.DSH_CODE_QUOTE_MIN_INSERTED
delete process.env.DSH_CODE_QUOTE_MIN_SINGLE_LINE_CHARS
delete process.env.DSH_CODE_QUOTE_CHIP_MODE

// --- 模板形 token（文档示例字面 id）不触发注入（TOKEN_RE 只认生成形态） ---
const d4 = await runPreStep(box2.preStep, 'doc example ⟦代码引用#id|header⟧ only')
assert.equal(appended(d4).length, 0, '模板 token 不应触发注入')

// --- 多 token 合并为一条上下文消息（#5） ---
const res5 = await post(box2.routes.get('/dsh-code-quote/put'), { id: 'qtest2xyz', header: 'c/d.js:3-4', code: 'const c = 3\nconst d = 4' })
assert.equal(res5.statusCode, 200)
const d5 = await runPreStep(box2.preStep, 'A ⟦代码引用#qtest1xyz|a/b.js:1-2⟧ B ⟦代码引用#qtest2xyz|c/d.js:3-4⟧')
assert.equal(appended(d5).length, 1, '多 token 应合并为一条消息')
assert.ok(appended(d5)[0].content[0].text.includes('const a = 1'), '合并消息应含第一段代码')
assert.ok(appended(d5)[0].content[0].text.includes('const d = 4'), '合并消息应含第二段代码')
assert.ok(appended(d5)[0].content[0].text.includes('×2'), '合并消息应标注数量')

// --- 0.3.0 新形态：@⟦id⟧header（气泡 @ 前缀文件芯片形态） ---
const resN = await post(box2.routes.get('/dsh-code-quote/put'), { id: 'qtest3xyz', header: 'e/f.js:5-6', code: 'const e = 5\nconst f = 6' })
assert.equal(resN.statusCode, 200)
const d6 = await runPreStep(box2.preStep, 'see @⟦代码引用#qtest3xyz⟧e/f.js:5-6 here')
assert.equal(appended(d6).length, 1, '新形态 token 应被扫描')
assert.ok(appended(d6)[0].content[0].text.includes('const f = 6'), '新形态应注入完整代码')

// --- 新旧形态混排仍合并为一条 ---
const d7 = await runPreStep(box2.preStep, 'A @⟦代码引用#qtest3xyz⟧e/f.js:5-6 B ⟦代码引用#qtest1xyz|a/b.js:1-2⟧')
assert.equal(appended(d7).length, 1, '混排应合并为一条消息')
assert.ok(appended(d7)[0].content[0].text.includes('const e = 5'), '混排合并应含新形态代码')
assert.ok(appended(d7)[0].content[0].text.includes('const b = 2'), '混排合并应含旧形态代码')
assert.ok(appended(d7)[0].content[0].text.includes('×2'), '混排合并应标注数量')

// --- 新形态字面模板（文档示例）不触发注入 ---
const d8 = await runPreStep(box2.preStep, 'doc example @⟦代码引用#id⟧header only')
assert.equal(appended(d8).length, 0, '新形态模板 token 不应触发注入')

rmSync(dataDir, { recursive: true, force: true })
console.log('persistence test passed (put / restart-survival / missing-fallback / template-ignore / multi-token-merge / config-endpoint+chipMode-default-on / new-form-token / mixed-form-merge / new-form-template-ignore)')
