# DSH × Codex：把 Codex CLI 拉成 DSH 里的可视化对话窗口

**dsh-conversation-archive** 是一个 DeepSeek Harness 插件。它把本机的 **Codex CLI** 接进 DSH，在 DSH 里重建一个 Codex 对话窗口：像在 GUI 里一样浏览线程、读上下文、选模型和推理档、发消息——但每一条请求都走 Codex CLI，DSH 只负责显示。

一句话：**Codex 只有命令行也能当图形界面用；Codex GUI 发不出消息时，用它接着原线程聊。**

## 为什么做这个插件

- **GUI 发不出消息，CLI 还能用**：额度用完、界面卡住、发送被拦时，`codex exec resume` / `codex queue` 往往还通。这个插件用 CLI 把原线程接出来，消息直接写回原对话，不新建会话、不换模型、不丢上下文。
- **把命令行变成可点击的界面**：不用记 `codex exec` 的参数、JSONL 输出和线程 ID，点开面板选对话就能继续聊。
- **跨系统、跨环境都能用**：Codex 跑在 WSL、远程开发机、容器或另一个操作系统里，只要 DSH 所在环境能调用到 `codex` 命令，就能用同一套可视化界面继续原有对话。终端-only 的环境也能得到接近 Codex GUI 的操作体验。
- **不消耗 DSH 的模型 token**：插件自己不调 DSH 模型，所有模型调用都由 Codex CLI 完成；DSH 只是外壳。

## 功能

- **三列面板**：侧边栏「Codex」图标打开。左列线程列表，中列对话，右列调用产物。
- **线程列表**：最近未归档线程，可按关键词过滤，可粘贴 `codex://threads/<id>` 或 36 位线程编号直达；按项目/工作目录分组，项目归属只做有依据展示（目录匹配才显示项目名，同一目录登记给多个项目时显示「项目未知」）。
- **对话视图**：默认只显示最近一轮（你 + Codex），可一键加载全部更早历史；回复按 Markdown 渲染（标题、列表、代码块、表格外的常用语法、链接），长文自动换行。
- **过程卡片**：每轮下面可折叠列出该轮执行的命令、文件改动、子代理、MCP 工具、联网搜索、计划等事件，默认收起。
- **右列产物**：子代理列表、涉及的文件（点击复制路径）、命令数量，一眼看清这轮 Codex 干了什么。
- **Composer**：模型选择（读 Codex 的模型目录，21 个模型）、推理强度（effort）、Sandbox、语音输入（DSH 语音服务转写）、发送/打断（发送中变停止按钮），发送失败显示 CLI 原始错误 + 可操作提示（额度重置时间 / 线程被占用 / 模型不可用）并带「重试」。
- **额度检查**：标题栏 ⚡ 按钮通过 Codex app-server 只读查询账户额度（需已登录 Codex）。
- **可选 app-server 后端**：默认 `codex exec resume`（稳）；在配置里设 `codex.transport: app-server` 可改用常驻 `codex app-server --stdio`（少一次进程启动、支持 interrupt/额度预读）。

## 安装

要求：已安装并登录 Codex CLI（`codex` 在 PATH 上，`codex exec --help` 可用）；DSH 0.2.x。

**从 npm 安装到 DSH profile：**

```sh
dsh plugin --profile desktop add dsh-conversation-archive
```

或直接在 DSH 的「插件」页搜索 `dsh-conversation-archive` 安装，然后重启/重载 DSH。

**本地开发安装：**

```sh
dsh plugin --profile desktop add /path/to/dsh-conversation-archive
```

插件启用后，第一次打开面板时会用包内 Python 适配器把本机 Codex 线程导出到 `~/.dsh/conversation-archive/`（只读 Codex 数据库，不写回）。

## 使用

1. 点左侧边栏的 Codex 图标打开面板。
2. 左列选一个线程（或粘贴线程 ID），中列显示最近一轮。
3. 在底部输入框写消息，Enter 发送；需要长文本用 Shift+Enter 换行。
4. 需要看历史就点「加载全部更早历史」；需要看执行细节就展开「过程」卡片。
5. 模型/推理档可在发送前切换；发送中可点 ■ 打断。

发送走两条 CLI 路径：线程空闲时 `codex exec resume <thread-id> --json`；线程被 GUI 占用（active writer）时回退 `codex queue --thread <thread-id>`。所有读写都通过本机 Codex 数据（`~/.codex/state_5.sqlite`、`~/.codex/thread_history_1.sqlite`），插件不修改 Codex 数据库，也不绕过任何 GUI 限制。

## 可选：app-server 后端

在 DSH profile 的 `cordis.patch.yml` 里给该插件加配置：

```yaml
- id: conversation-archive
  name: dsh-conversation-archive
  config:
    root: ~/.dsh/conversation-archive
    codex:
      transport: app-server
      appServerIdleMs: 600000
```

app-server 是实验接口：线程单写者、额度读取要求已登录的 ChatGPT 账号；初始化失败会自动回退 `exec resume`。

## 常见问题

- **发送报 `[CODEX_QUOTA]`**：Codex 侧额度/配额限制，按错误里的重置时间等待，或在 CC Switch 调整官方额度保护/切到支持该模型的 provider。
- **`[CODEX_BUSY]`**：线程正被 Codex App 或另一个 CLI 占用；先在 Codex 里关闭该线程，或稍后再发。
- **`[CODEX_AUTH]`**：Codex 登录态失效，先运行 `codex login`。
- **没有项目分组**：Codex 的 `threads.project_id` 可能为空，此时按工作目录分组（组标题带「目录」标签），未匹配到目录的归「未分组」。
- **⚡ 额度读取报 authentication required**：当前 Codex 账号环境不提供额度接口；不影响发送。

## 数据与边界

- 只读本机 Codex 数据；不写 Codex 数据库、不上传任何内容。
- 所有模型调用经 Codex CLI，插件不消耗 DSH 模型 token。
- 语音输入使用 DSH 自带的语音服务，首次使用需授权麦克风。
- 插件不试图绕过 Codex 的任何限制：GUI 发不出就是发不出，CLI 能发才发。

## 开发

```
index.js                     Host 半：HTTP 路由、CLI 调用、app-server JSON-RPC 后端
client.js                    Web 客户端：侧栏图标 + main 面板（三列布局）+ 设置页
cordis.patch.yml             bundle 补丁（一行 insert）
adapters/codex/export_codex_threads.py   Codex 数据导出（只读）
```

- 架构：DSH 槽位（`sidebar.panellist` 图标 + `main` 面板 + `settings.section` 设置页），客户端只渲染，数据全部来自 Host 同源路由。
- 不需要构建：`client.js` 是手写的 `__ModuleLoader__` 工厂，直接加载 React。
- 本地改动后：客户端热重载；Host 改动需在 DSH 插件页禁用再启用该 bundle。

## English

A DeepSeek Harness plugin that turns your local **Codex CLI** into a visual conversation window inside DSH: browse threads, read context, pick model/effort, and continue the original thread through the CLI. Useful when the Codex GUI can't send (quota/UI issues) but the CLI still works, or when Codex runs in WSL, a remote box, a container or another OS and you want a clickable interface for it. No DSH model tokens are used; DSH is only the shell.

Install: `dsh plugin --profile desktop add dsh-conversation-archive`.

## License

MIT
