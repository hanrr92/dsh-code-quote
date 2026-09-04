window.__ModuleLoader__.load({ id: 'dsh-code-quote', factory: (require) => {
  const module = { exports: {} }
  const exports = module.exports
  const React = require('react')

  // 与 host 半 src/plugin.js 的 TOKEN_NEW_RE/TOKEN_OLD_RE 保持同形：
  // 新 @⟦代码引用#id⟧header / 旧 ⟦代码引用#id|header⟧（兼容扫描，不新产）
  var MIN_INSERTED = 30
  var MIN_SINGLE_LINE_CHARS = 40

  function makeId() {
    return 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  }

  async function putQuote(payload) {
    const response = await fetch('/dsh-code-quote/put', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const text = await response.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error('服务返回了无效响应')
    }
    if (!response.ok || data.ok !== true) throw new Error(data.error || ('HTTP ' + response.status))
    return data
  }

  /** 折叠失败的轻提示：右下角浮层，4 秒自动消失，不阻塞输入（#4）。 */
  function showToast(message) {
    if (typeof document === 'undefined' || !document.body) return
    var toast = document.createElement('div')
    toast.textContent = message
    toast.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;max-width:360px;'
      + 'padding:8px 12px;border:1px solid rgba(255,80,80,0.35);border-radius:8px;'
      + 'background:#2a1b1b;color:#f2d5d5;font-size:12px;line-height:1.5;'
      + 'box-shadow:0 6px 20px rgba(0,0,0,0.45);font-family:inherit;pointer-events:none;'
    document.body.appendChild(toast)
    setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast) }, 4000)
  }

  /* ---------- 真 chip 模式（#2，0.3.2 起默认开，host 可配 0 关闭） ---------- */

  var SOURCE_NAME = 'code-quote'
  var ctxSessions = null
  // 与 host 默认一致（0.3.2 起默认开）；/config 拉取后会覆盖。
  var chipMode = true
  var REGISTRY_KEY = 'dsh-code-quote/registry'
  var registry = {}
  try {
    var savedRegistry = sessionStorage.getItem(REGISTRY_KEY)
    if (savedRegistry) {
      var parsedRegistry = JSON.parse(savedRegistry)
      if (parsedRegistry !== null && typeof parsedRegistry === 'object') registry = parsedRegistry
    }
  } catch (e) {}

  function rememberId(id, header) {
    registry[id] = header
    try { sessionStorage.setItem(REGISTRY_KEY, JSON.stringify(registry)) } catch (e) {}
  }

  /** 芯片 label：剥 markdown 围栏后取末段路径（= 文件名:行号），与内核文件引用芯片同款。 */
  function chipLabel(header) {
    var clean = String(header).replace(/^`+|`+$/g, '')
    var parts = clean.split(/[\\/]/).filter(Boolean)
    return parts.length > 0 ? parts[parts.length - 1] : clean
  }

  /** 尝试在粘贴区间 mint 真 occurrence chip（bail 区间替换）；任何失败返回 false 走 token 回退。 */
  function mintChip(props, change, id, header, rev) {
    try {
      if (!ctxSessions || !props.sessionId) return false
      var actx = ctxSessions.scope(props.sessionId)
      if (!actx || typeof actx.bail !== 'function') return false
      var applied = actx.bail(actx, 'slash/input-insert-reference', {
        reference: {
          source: SOURCE_NAME,
          ref: id,
          label: chipLabel(header),
          appearance: 'file',
          clipboardText: header,
        },
        span: { start: change.start, end: change.end, draftRev: rev },
      })
      return applied === true
    } catch (e) {
      return false
    }
  }

  /** 前后缀公共扫描：返回 next 相对 prev 的纯插入区间（与输入机 diffEdit 同法）。 */
  function diffInsert(prev, next) {
    if (next.length <= prev.length) return null
    var start = 0
    var maxStart = Math.min(prev.length, next.length)
    while (start < maxStart && prev.charCodeAt(start) === next.charCodeAt(start)) start++
    var endPrev = prev.length
    var endNext = next.length
    while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
      endPrev--
      endNext--
    }
    return { start: start, end: endNext, text: next.slice(start, endNext) }
  }

  /**
   * 识别「header 行 + 代码体」粘贴：首行形如 路径:行号 或 路径:起-止，
   * 其后至少 1 行代码（单行代码需 ≥40 字符）。不含换行或已含 token 字符时拒绝。
   * header 先剥 markdown 围栏（```）残留，避免 IDE/网页复制带入的围栏污染 header。
   */
  function parseQuote(text) {
    if (text.indexOf('\n') < 0) return null
    if (text.indexOf('⟦') >= 0) return null
    var lines = text.split('\n')
    var head = 0
    while (head < lines.length && lines[head].trim() === '') head++
    if (head >= lines.length) return null
    var headerLine = lines[head].trim().replace(/^`+|`+$/g, '')
    if (!/^(\S.*?):(\d+)(?:-(\d+))?$/.test(headerLine)) return null
    var end = lines.length
    while (end > head + 1 && lines[end - 1].trim() === '') end--
    var codeLines = lines.slice(head + 1, end)
    var nonBlank = 0
    var totalChars = 0
    for (var i = 0; i < codeLines.length; i++) {
      if (codeLines[i].trim() !== '') {
        nonBlank++
        totalChars += codeLines[i].length
      }
    }
    if (nonBlank === 0) return null
    if (nonBlank < 2 && totalChars < MIN_SINGLE_LINE_CHARS) return null
    return { header: headerLine, code: codeLines.join('\n') }
  }

  // 启动时拉取一次阈值配置（host 端环境变量可覆盖），失败沿用内置默认（#3）。
  if (typeof fetch === 'function') {
    fetch('/dsh-code-quote/config').then(function (response) {
      return response.ok ? response.json() : null
    }).then(function (data) {
      if (data === null || typeof data !== 'object') return
      if (typeof data.minInserted === 'number' && data.minInserted >= 0) MIN_INSERTED = data.minInserted
      if (typeof data.minSingleLineChars === 'number' && data.minSingleLineChars >= 10) MIN_SINGLE_LINE_CHARS = data.minSingleLineChars
      if (typeof data.chipMode === 'boolean') chipMode = data.chipMode
    }, function () {})
  }

  /**
   * conversation.input.dock 条目（零视觉）：随会话挂载，
   * 通过 session 标准 kit 的 useInput 订阅草稿、inputActions 改写草稿。
   */
  function CodeQuoteDock(props) {
    var box = React.useState(function () { return { prev: null, lastToken: null, latest: null, latestState: null } })[0]
    var input = props.useInput(function (state) { return state })
    box.latestState = input === undefined || input === null ? null : input
    box.latest = input === undefined || input === null ? null : input.draft

    React.useEffect(function () {
      var actions = props.inputActions
      var next = box.latest
      if (typeof actions !== 'object' || actions === null || next === null) return
      var prev = box.prev
      box.prev = next
      if (prev === null || next === prev) return
      // 折叠的 undo（token 被机器还原成原始粘贴）：放行，不重新折叠。
      if (box.lastToken !== null && prev.indexOf(box.lastToken) >= 0 && next.indexOf(box.lastToken) < 0) return
      var change = diffInsert(prev, next)
      if (change === null || change.text.length < MIN_INSERTED) return
      var quote = parseQuote(change.text)
      if (quote === null) return
      var id = makeId()
      putQuote({ id: id, header: quote.header, code: quote.code }).then(function () {
        // RPC 往返期间草稿又变了：放弃折叠，不打扰用户输入。
        if (box.latest !== next) return
        rememberId(id, quote.header)
        // chip 模式（#2，0.3.2 起默认开）：先试真引用 chip（bail 区间替换，
        // 与内置 @ 引用同一条 insert-ref 机制）；失败/关闭回退到 setDraft token
        // 折叠。两路用同一 id，重复 token 会被 host 去重。
        // token 以 @ 开头：发送后用户气泡被内核渲染成文件图标芯片。
        // 0.3.3：token header 必须是完整路径（含 /）——内核气泡芯片的显示文案
        // 取「最后一个 / 段」（MessageItem projectUserText displayLabel），
        // 机器码必须躲在非显示段才不可见；0.3.1/0.3.2 的纯文件名 header 曾使
        // 机器码整段漏出到气泡芯片。输入框长度由 chip 模式解决，不靠缩短 token。
        var rev = box.latestState !== null && box.latestState !== undefined && typeof box.latestState.draftRev === 'number'
          ? box.latestState.draftRev
          : 0
        if (chipMode && mintChip(props, change, id, quote.header, rev)) return
        var token = '@⟦代码引用#' + id + '⟧' + quote.header
        box.lastToken = token
        actions.setDraft(next.slice(0, change.start) + token + next.slice(change.end))
      }, function (error) {
        // 快照保存失败不再静默：明示用户本次折叠未发生（#4）。
        showToast('代码引用折叠失败：' + (error && error.message ? error.message : '快照保存失败'))
      })
    })

    return null
  }

  exports.inject = ['slots', 'sessions', 'inputTriggers']
  exports.apply = (ctx) => {
    ctxSessions = ctx.sessions
    if (ctx.inputTriggers && typeof ctx.inputTriggers.registerSource === 'function') {
      // chip 的发送时序列化（#2）：永不忘 throw——registry 丢失（如换标签页）时
      // 退化为无 header 的 token，host 端快照仍能补全完整 header 并注入。
      ctx.effect(() => ctx.inputTriggers.registerSource({
        trigger: '@',
        name: SOURCE_NAME,
        order: 91,
        candidates: async () => [],
        onPick: () => undefined,
        codec: {
          clipboardText(ref) { return registry[ref] || '' },
          // 序列化必须保留完整路径（含 /）：气泡芯片按「最后一个 / 段」显示，
          // 机器码靠前置路径段藏身（0.3.3，见折叠处注释）。
          serialize(ref) { return '@⟦代码引用#' + ref + '⟧' + (registry[ref] || '') },
        },
      }), 'code-quote: trigger source')
    }
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'code-quote',
        order: 60,
        inject: (sessionId) => ({ sessionId: sessionId }),
      }, CodeQuoteDock))
  }

  return module.exports
}})
