# dsh-code-quote

> DSH（DeepSeek Harness）Web 输入框的代码引用折叠插件：把「路径：行号 + 代码」粘贴自动折叠成一行紧凑引用，发送时把完整代码快照内联给模型。

## 这是什么

在没有行内引用机制之前，往 DSH 输入框粘贴一段带 `路径:行号` 头的代码，它会以原始多行文本进入草稿和消息。本插件提供「方案 b（内联快照）」体验：

- **输入框**：粘贴后自动折叠成一行 token —— `⟦代码引用#qxxx|dsh-web-launcher/package.json:13-15⟧`，Ctrl+Z 一步还原；
- **气泡**：发送后用户消息保持紧凑 token；
- **模型**：`agent/pre-step` 在消息进入模型前，把粘贴时落定的完整代码快照作为一条独立的上下文消息追加进批次（UI 中渲染为可展开的「上下文注入」行，后续轮次持续可见）。

数据是**快照**口径：折叠那一刻的代码内容被留存，之后文件怎么改动都不影响这条引用；DSH 进程重启后快照丢失，发送时会注入「快照已失效」提示而不是静默失败。

## 工作原理

```
粘贴「header + 代码体」
  → 浏览器半（conversation.input.dock 条目）识别形态
      → POST /dsh-code-quote/put 存快照 {id, header, code}
      → inputActions.setDraft 折叠为 ⟦代码引用#id|header⟧（一次可撤销事务）
发送
  → 持久日志 = 紧凑 token（气泡紧凑）
  → agent/pre-step：先 await next() 委托下游，再对 enter 批次扫描 token，
      追加 source={kind:'plugin', plugin:'dsh-code-quote'} 的独立上下文消息
  → 模型看到完整代码快照
```

token 形态契约（client 与 host 两半必须同形）：`⟦代码引用#<id>|<header>⟧`，
其中 `<id>` 为 `[a-z0-9]+`，`<header>` 为不含 `⟦`/换行的任意文本（≤300 字符）。

## 安装

```powershell
# 本地目录安装（或用 tarball / git 地址）
dsh plugin --profile web add D:\path\to\dsh-code-quote

# 安装后需重启 profile：bundle 成员在启动时固定
```

`cordis.patch.yml` 会经 `dsh.bundle.patch` 在 reconcile 时自动把插件加入 profile 组合；无需构建步骤（源码即 ESM 直发）。安装后重启，浏览器端 client bundle 重新下发即可生效。

## 使用与识别规则

把下面这种格式粘贴进输入框（编辑器选中复制即可）：

```
dsh-web-launcher/package.json:13-15
  "bin": {
    "dsh-web-launcher": "bin/dsh-web-launcher.js"
  },
```

识别条件（最小版故意保守，防误判）：

| 条件 | 值 |
| --- | --- |
| 首行 | `路径:行号` 或 `路径:起始-结束`（整行匹配，可含路径分隔符） |
| 代码体 | 至少 1 行非空代码；单行代码需 ≥40 字符 |
| 插入长度 | ≥30 字符且含换行 |
| 排除 | 纯文本无 header、已含 token 字符 `⟦` 的文本 |

折叠是异步确认的：快照落库成功且草稿未再变化才替换；期间你继续输入则放弃本次折叠。

## 行为边界

- 识别阈值偏保守：无 header 的纯代码粘贴不会折叠（后续版本可加）；
- 折叠后光标可能跳到输入框末尾；
- 快照存于 DSH 进程内存（上限 64 块 / 单块 128KB，LRU 淘汰），进程重启即失效（有失效回退提示，不阻塞发送）；
- 与会话内动态版插件（如 `quote-1`）**二选一**：两者都监听 `agent/pre-step`，同时启用会重复注入。

## 开发

```
src/plugin.js    Host 半：/dsh-code-quote/put 路由（same-origin 校验）+ agent/pre-step 注入
client/client.js 浏览器半：dock 条目、粘贴识别与折叠、fetch 存快照
cordis.patch.yml bundle 成员声明（reconcile 时插入 profile 组合）
```

调整识别阈值：改 `client/client.js` 的 `MIN_INSERTED` 与 `parseQuote`；token 形态若变化，需同步修改 `src/plugin.js` 的 `TOKEN_RE` 与 `contextText`。

## License

MIT
