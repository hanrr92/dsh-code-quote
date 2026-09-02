# dsh-code-quote 卸载

> 从 DSH profile（默认 `web`）卸载 `dsh-code-quote` 的几种方式。卸载后需**重启 profile**才真正从运行组合移除（bundle 成员在启动时固定）。该操作只影响本机 profile，不影响已发布的 npm 包与 GitHub 仓库，也不会影响其他人的使用。

## 方式一览

| 方式 | 命令 / 操作 | 效果 | 适用场景 |
| --- | --- | --- | --- |
| 1️⃣ 推荐 | `dsh plugin --profile web remove dsh-code-quote` | 移除依赖 + node_modules + bundle 记录 | 常规卸载 |
| 2️⃣ 手动清理 | 手动编辑 package.json + `pnpm install` | 同上，但手工执行 | 转发器异常 / 审计 |
| 3️⃣ 只停用 | 从 bundle 列表移除、保留依赖 | 组合不再加载，但不卸装 | 临时开关 / 对比测试 |

另外，本插件早期也曾以**会话内动态插件**形态运行（如 `quote-1`）——那属于会话级，卸载走会话工具，与这里的 profile 安装无关。

## 方式 1：dsh plugin remove（推荐）

`dsh plugin` 是 pnpm 的转发器：`remove` 会把 `dsh-code-quote` 从 profile 的 `package.json` 依赖与 `node_modules` 移除，并同步从 `dsh.profile.bundles` 删除记录。

```powershell
dsh plugin --profile web remove dsh-code-quote
```

完成后重启 profile 使其从运行组合中移除：

```powershell
dsh web    # 或按你平时的启动方式重启
```

## 方式 2：手动清理

1. 编辑 `%DSH_HOME%\profiles\web\package.json`：
   - 在 `dependencies` 中删除 `"dsh-code-quote": "^0.1.0"`
   - 在 `dsh.profile.bundles` 数组中删除 `"dsh-code-quote"`
2. 在 profile 目录执行 `pnpm install`（或 `dsh plugin --profile web install`）以清理 `node_modules`
3. 若 `/node_modules/dsh-code-quote` 仍有残留可手动删除
4. 重启 profile

## 方式 3：只停用、不卸载（保留依赖便于恢复）

把 `dsh.profile.bundles` 里的 `"dsh-code-quote"` 移除即可，**保留** `dependencies` 中的条目。重启后组合不再加载该插件，但要恢复时：

```powershell
dsh plugin --profile web add dsh-code-quote
```

## 清理快照数据（可选）

卸载不会删除已落盘的快照数据。如需彻底清理，删除目录：

```powershell
Remove-Item -Recurse -Force "$env:DSH_HOME\storages\dsh-code-quote"
```

（若设置了 `DSH_CODE_QUOTE_DATA_DIR` 覆盖路径，则删除该目录即可。）

## 通用验证

卸载并重启后，确认组合里已无该插件：

```bash
dsh --profile web --dump-config    # 不再出现 `- id: dsh-code-quote`
```

（可选）查看依赖是否已移除：

```bash
dsh plugin --profile web ls | findstr dsh-code-quote
```