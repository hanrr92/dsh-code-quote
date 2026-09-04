# dsh-code-quote

> DSH（DeepSeek Harness）Web 输入框的代码引用折叠插件：把「路径：行号 + 代码」粘贴自动折叠成一行紧凑引用，发送时把完整代码快照内联给模型。

## 这是什么

在没有行内引用机制之前，往 DSH 输入框粘贴一段带 `路径:行号` 头的代码，它会以原始多行文本进入草稿和消息。本插件提供「方案 b（内联快照）」体验：

- **输入框**：粘贴后自动折叠成一行紧凑引用 —— 默认（0.3.2 起）是可退格删除的真引用 chip（文件图标 + `文件名:行号`），关闭 chip 模式时为一行含完整路径的 token（`@⟦代码引用#qxxx⟧路径:行号`，较长——气泡芯片靠路径斜杠隐藏机器码，见 0.3.3），Ctrl+Z 一步还原；
- **气泡**：token 以 `@` 开头，聊天流按内核引用规则自动渲染成「文件图标 + 文件名:行号」芯片（与内置 @path 引用同款）；
- **模型**：`agent/pre-step` 在消息进入模型前，把粘贴时落定的完整代码快照作为一条独立的上下文消息追加进批次（UI 中渲染为可展开的「上下文注入」行，后续轮次持续可见）。

0.3.0 变更：token 序列化升级为 `@⟦代码引用#id⟧header`（气泡芯片化）；真 chip 模式补齐 `appearance: 'file'` 与「文件名:行号」label；粘贴头部剥离 markdown 围栏（\`\`\`）残留；修复 0.2.0 正则过宽导致文档模板字面量（`⟦代码引用#id|header⟧`）被误扫、注入「快照已失效」的问题。

0.3.1 变更：token 中的 header 只保留「文件名:行号」（完整路径仍存于快照表与注册表），token 显著变短；快照失效兜底文案相应只含文件名。

0.3.2 变更：**真 chip 模式默认开启**——输入框折叠产物直接是「文件图标 + 文件名:行号」真引用芯片，`⟦…⟧` 机器码不再在输入框展示（机器码仅存在于消息原文，气泡与输入框均不可见）；设环境变量 `DSH_CODE_QUOTE_CHIP_MODE=0` 可退回 token 模式。

0.3.3 变更：修复 0.3.1 引入的**气泡机器码漏出**——内核气泡芯片的显示文案取「最后一个 `/` 段」，机器码必须躲在非显示段才不可见；0.3.1 把 header 缩成纯文件名（无斜杠）后，机器码整段进入了芯片文字。0.3.3 恢复完整路径序列化：气泡芯片重新只显示「文件名:行号」，输入框长度不受影响（真 chip 模式下不可见），快照失效兜底重新拿到完整路径。历史消息里的短 token 无法追溯修复。

数据是**快照**口径：折叠那一刻的代码内容被留存，之后文件怎么改动都不影响这条引用；快照持久化到 `<DSH_HOME>/storages/dsh-code-quote/snapshots.json`，**进程重启后仍可用**——「快照已失效」提示仅作为文件损坏/被删等极端情况的回退，不静默失败。

## 工作原理

```
粘贴「header + 代码体」
  → 浏览器半（conversation.input.dock 条目）识别形态
      → POST /dsh-code-quote/put 存快照 {id, header, code}
      → chip 模式（默认）：bail slash/input-insert-reference 折叠为真引用 chip
        （token 模式：inputActions.setDraft 折叠为 @⟦代码引用#id⟧完整路径:行号）
发送
  → 持久日志 = @ 前缀紧凑 token（气泡渲染成文件图标芯片）
  → agent/pre-step：先 await next() 委托下游，再对 enter 批次扫描 token，
      追加 source={kind:'plugin', plugin:'dsh-code-quote'} 的独立上下文消息
  → 模型看到完整代码快照
```

token 形态契约（client 与 host 两半必须同形，0.3.0 起双形态兼容）：

- 新 `@⟦代码引用#<id>⟧<header>`：`<header>` 为不含空白/`⟦`/换行的任意文本（≤300 字符），实际写**完整相对路径:行号**——气泡芯片按最后一个 `/` 段显示「文件名:行号」，机器码靠前置路径段隐藏（0.3.3 恢复；0.3.1 的纯文件名 header 有漏出缺陷，勿再缩短）；
- 旧 `⟦代码引用#<id>|<header>⟧`：继续可展开（历史消息兼容），`<header>` 为不含 `⟦`/换行的任意文本（≤300 字符）；
- `<id>` 均为插件生成的 `q` + ≥7 位 base36（文档示例里的字面模板如 `#id` 不会被扫描注入——0.2.0 曾因正则过宽误扫，0.3.0 修复）。

## 安装

```powershell
# ① npm 包名直装（推荐——免构建授权步骤）
dsh plugin --profile web add dsh-code-quote

# ② GitHub Release 预构建 tarball
dsh plugin --profile web add https://github.com/hanrr92/dsh-code-quote/releases/download/v0.2.0/dsh-code-quote-0.2.0.tgz

# ③ GitHub 源码 tarball（pinned）
dsh plugin --profile web add https://codeload.github.com/hanrr92/dsh-code-quote/tar.gz/<sha>
```

国内网络下 npm 安装走 npmmirror 镜像即可；包本身无构建步骤，三种方式效果一致。

`cordis.patch.yml` 会经 `dsh.bundle.patch` 在 reconcile 时自动把插件加入 profile 组合；无需构建步骤（源码即 ESM 直发）。安装后需重启 profile：bundle 成员在启动时固定，重启后浏览器端 client bundle 重新下发即可生效。

## 卸载

卸载方法见 [UNINSTALL.md](./UNINSTALL.md)。最常用一行：

```powershell
dsh plugin --profile web remove dsh-code-quote
```

（推荐）之后重启 profile 即从运行组合移除。

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
| 首行 | `路径:行号` 或 `路径:起始-结束`（整行匹配，可含路径分隔符；先剥离首尾 markdown 围栏 \`\`\` 残留） |
| 代码体 | 至少 1 行非空代码；单行代码需 ≥40 字符 |
| 插入长度 | ≥30 字符且含换行 |
| 排除 | 纯文本无 header、已含 token 字符 `⟦` 的文本 |

折叠是异步确认的：快照落库成功且草稿未再变化才替换；期间你继续输入则放弃本次折叠。

## 行为边界

- 识别阈值偏保守：无 header 的纯代码粘贴不会折叠（后续版本可加）；
- 折叠后光标可能跳到输入框末尾；
- 快照保存失败不再静默：右下角出现「代码引用折叠失败」轻提示，4 秒自动消失；
- 快照持久化于 `<DSH_HOME>/storages/dsh-code-quote/snapshots.json`（上限 64 块 / 单块 128KB，LRU 淘汰），进程重启后自动载回；存储不可用时退化为内存 LRU，文件损坏/被删则回退「快照已失效」提示，不阻塞发送；
- 与会话内动态版插件（如 `quote-1`）**二选一**：两者都监听 `agent/pre-step`，同时启用会重复注入。

## 开发

```
src/plugin.js    Host 半：/dsh-code-quote/put 路由（same-origin 校验）+ agent/pre-step 注入 + 快照原子持久化（tmp+rename）
client/client.js 浏览器半：dock 条目、粘贴识别与折叠、fetch 存快照
cordis.patch.yml bundle 成员声明（reconcile 时插入 profile 组合）
test/persistence.test.mjs 持久化自测（put / 重启存活 / 失效回退 / 模板不误扫 / 多 token 合并 / 新旧形态兼容 / chipMode 默认开）
```

调整识别阈值：默认内置（插入 ≥30 字符、单行代码 ≥40 字符），可用环境变量 `DSH_CODE_QUOTE_MIN_INSERTED` / `DSH_CODE_QUOTE_MIN_SINGLE_LINE_CHARS` 覆盖；客户端启动时经 `GET /dsh-code-quote/config` 拉取一次，拉取失败沿用内置默认。token 形态若变化，需同步修改 `src/plugin.js` 的 `TOKEN_NEW_RE` / `TOKEN_OLD_RE` 与 `contextText`，并注意内核气泡芯片「取最后一个 `/` 段」的显示规则——header 必须含路径分隔符。

真 chip 模式（0.3.2 起默认开）：折叠产物在输入框中成为可退格删除的真引用 chip（文件图标 + 文件名:行号，`appearance: 'file'`），与内置 @ 引用共用同一条 `slash/input-insert-reference` 机制（draftRev CAS，失败自动回退 token 折叠）；发送时仍序列化为紧凑 token，host 快照注入链路不变。设环境变量 `DSH_CODE_QUOTE_CHIP_MODE=0` 退回 token 模式（输入框显示含完整路径的一行 token，较长）。若发现粘贴后原始代码未被替换，请关闭该开关并提 Issue 反馈。

持久化自测：`node test/persistence.test.mjs`。

## License

MIT
