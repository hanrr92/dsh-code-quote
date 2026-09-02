window.__ModuleLoader__.load({ id: 'dsh-code-quote', factory: (require) => {
  const module = { exports: {} }
  const exports = module.exports
  const React = require('react')

  // 与 host 半 src/plugin.js 的 TOKEN_RE 保持同形：⟦代码引用#id|header⟧
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
   */
  function parseQuote(text) {
    if (text.indexOf('\n') < 0) return null
    if (text.indexOf('⟦') >= 0) return null
    var lines = text.split('\n')
    var head = 0
    while (head < lines.length && lines[head].trim() === '') head++
    if (head >= lines.length) return null
    var headerLine = lines[head].trim()
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
    }, function () {})
  }

  /**
   * conversation.input.dock 条目（零视觉）：随会话挂载，
   * 通过 session 标准 kit 的 useInput 订阅草稿、inputActions 改写草稿。
   */
  function CodeQuoteDock(props) {
    var box = React.useState(function () { return { prev: null, lastToken: null, latest: null } })[0]
    var input = props.useInput(function (state) { return state })
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
        var token = '⟦代码引用#' + id + '|' + quote.header + '⟧'
        box.lastToken = token
        actions.setDraft(next.slice(0, change.start) + token + next.slice(change.end))
      }, function (error) {
        // 快照保存失败不再静默：明示用户本次折叠未发生（#4）。
        showToast('代码引用折叠失败：' + (error && error.message ? error.message : '快照保存失败'))
      })
    })

    return null
  }

  exports.inject = ['slots']
  exports.apply = (ctx) => {
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register({ name: 'conversation.input.dock', id: 'code-quote', order: 60 }, CodeQuoteDock))
  }

  return module.exports
}})
