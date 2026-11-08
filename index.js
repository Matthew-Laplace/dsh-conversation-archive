import { execFile, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'conversation-archive'
export const inject = ['tools', 'webServer']

function expandHome(value) {
  const text = String(value ?? '')
  return text.startsWith('~/') ? join(homedir(), text.slice(2)) : text
}

const DEFAULT_ROOT = expandHome('~/.dsh/conversation-archive')

// 包内自带 Codex adapter：装好就能自动刷新，不需要额外配置路径。
const PACKAGED_ADAPTER = fileURLToPath(
  new URL('./adapters/codex/export_codex_threads.py', import.meta.url),
)

let cachedIndex = { path: '', mtime: 0, data: null }

const DEFAULT_REFRESH = {
  script: '',
  stateDb: join(homedir(), '.codex', 'state_5.sqlite'),
  historyDb: join(homedir(), '.codex', 'thread_history_1.sqlite'),
  timeoutMs: 180000,
}

let refreshing = null

// ---- Codex CLI：面板通过 CLI 继续原线程 ----
const CODEX_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODEX_CLI_CANDIDATES = [
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
  '/Applications/Codex.app/Contents/Resources/codex',
]
const CODEX_STATE_DB = join(homedir(), '.codex', 'state_5.sqlite')
const DEFAULT_CODEX_CONFIG = {
  cli: '',
  resumeTimeoutMs: 900000,
  modelCatalog: '',
  // exec：每次 codex exec resume 起一个进程（默认，稳）；app-server：常驻 JSON-RPC 进程。
  transport: 'exec',
  appServerIdleMs: 600000,
}

// 面板同一时刻只允许一个 CLI 回合；打断按钮 kill 这个子进程。
const panelTurn = { child: null, threadId: '', startedAt: 0 }

function newestMtime(paths) {
  let newest = 0
  for (const path of paths) {
    try {
      newest = Math.max(newest, statSync(path).mtimeMs)
    } catch {
      // 文件不存在时忽略
    }
  }
  return newest
}

/**
 * Codex 侧有新的调试记录时，自动重跑导出脚本，保证面板里看到的是最新的。
 * 失败不阻断读取：用已有档案继续服务，并把错误回传给界面。
 */
function maybeRefresh(root, refresh) {
  if (!refresh || !refresh.script || !existsSync(refresh.script)) return Promise.resolve(null)
  const index = indexPath(root)
  const indexMtime = existsSync(index) ? statSync(index).mtimeMs : 0
  const sourceMtime = newestMtime([refresh.stateDb, refresh.historyDb].filter(Boolean))
  if (sourceMtime <= indexMtime) return Promise.resolve(null)
  if (refreshing) return refreshing
  refreshing = new Promise((resolve) => {
    execFile(
      'python3',
      [refresh.script],
      { timeout: refresh.timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        refreshing = null
        if (error) {
          resolve({ ok: false, error: String(error.message || error), stderr: String(stderr || '').slice(0, 500) })
          return
        }
        resolve({ ok: true, output: String(stdout || '').trim().slice(0, 500) })
      },
    )
  })
  return refreshing
}

function indexPath(root) {
  return join(root, 'index.json')
}

function loadIndex(root) {
  const path = indexPath(root)
  let mtime = 0
  try {
    mtime = statSync(path).mtimeMs
  } catch {
    return { version: 1, sources: [], conversations: [] }
  }
  if (cachedIndex.path === path && cachedIndex.mtime === mtime) return cachedIndex.data
  const data = JSON.parse(readFileSync(path, 'utf8'))
  cachedIndex = { path, mtime, data }
  return data
}

function safeResolve(root, relative) {
  const base = root.endsWith('/') ? root : `${root}/`
  const target = join(root, relative)
  if (!target.startsWith(base)) throw new Error('archive path escapes the archive root')
  return target
}

function listConversations(root, { query = '', source = '', limit = 30, offset = 0 }) {
  const index = loadIndex(root)
  const needle = String(query ?? '').trim().toLowerCase()
  let items = index.conversations ?? []
  if (source) items = items.filter((item) => item.source === source)
  if (needle) {
    items = items.filter((item) =>
      [item.title, item.cwd, item.id, item.model]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle)),
    )
  }
  const total = items.length
  const page = items.slice(offset, offset + limit)
  return {
    total,
    offset,
    limit,
    sources: index.sources ?? [],
    conversations: page.map((item) => ({
      id: item.id,
      source: item.source,
      title: item.title,
      project: item.project ?? '',
      project_basis: item.project_basis ?? 'none',
      cwd: item.cwd,
      model: item.model,
      updated_at_ms: item.updated_at_ms,
      chars: item.chars,
      path: item.path,
    })),
  }
}

function resolveConversation(root, ref) {
  const index = loadIndex(root)
  const items = index.conversations ?? []
  const input = String(ref ?? '').trim()
  if (!input) throw new Error('conversation id is required')
  const idPrefix = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f-]+$/i.test(input)

  const exact = items.find((item) => item.id === input)
  if (exact) return exact

  if (idPrefix) {
    const byPrefix = items.filter((item) => item.id.startsWith(input))
    if (byPrefix.length === 1) return byPrefix[0]
    if (byPrefix.length > 1) {
      throw new Error(`"${input}" is an ambiguous id prefix (${byPrefix.length} matches); use the full id`)
    }
  }

  const needle = input.toLowerCase()
  const candidates = []
  for (const item of items) {
    const haystack = [item.title, item.cwd]
      .filter(Boolean)
      .map((field) => String(field).toLowerCase())
    if (haystack.some((field) => field.includes(needle))) candidates.push(item)
  }
  if (candidates.length === 1) return candidates[0]
  if (candidates.length === 0) throw new Error(`conversation "${input}" not found in the archive index`)
  throw new Error(
    `"${input}" matches ${candidates.length} conversations, be more specific: ` +
      candidates.slice(0, 5).map((item) => `${item.id} (${item.title})`).join(' | '),
  )
}

function readConversation(root, { id, offset = 0, limit = 20000 }) {
  const entry = resolveConversation(root, id)
  const path = safeResolve(root, entry.path)
  const text = readFileSync(path, 'utf8')
  const start = Math.max(0, offset)
  const end = Math.min(text.length, start + Math.max(1, limit))
  return {
    id: entry.id,
    source: entry.source,
    title: entry.title,
    project: entry.project ?? '',
    project_basis: entry.project_basis ?? 'none',
    cwd: entry.cwd,
    total_chars: text.length,
    offset: start,
    text: text.slice(start, end),
    truncated: end < text.length,
  }
}

function searchConversations(root, { query, source = '', limit = 30, context = 120 }) {
  if (!query || !query.trim()) throw new Error('query is required')
  const index = loadIndex(root)
  const sources = (index.conversations ?? []).filter((item) => !source || item.source === source)
  const regex = /^\/.*\/[a-z]*$/.test(query)
    ? new RegExp(query.slice(1, query.lastIndexOf('/')), query.slice(query.lastIndexOf('/') + 1))
    : null
  const needle = regex ? null : query.toLowerCase()
  const results = []
  const maxOut = 2000
  for (const entry of sources) {
    let text
    try {
      text = readFileSync(safeResolve(root, entry.path), 'utf8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (let index = 0, size = lines.length; index < size; index += 1) {
      const line = lines[index]
      const hit = regex ? regex.test(line) : line.toLowerCase().includes(needle)
      if (!hit) continue
      results.push({
        id: entry.id,
        title: entry.title,
        source: entry.source,
        line: index + 1,
        text: line.trim().slice(0, maxOut),
        snippet: line.trim().slice(Math.max(0, (line.trim().length - context) / 2), context).trim(),
      })
      if (results.length >= limit) break
    }
    if (results.length >= limit) break
  }
  return { total: results.length, limit, matches: results }
}

function runFile(command, args, { timeoutMs = 60000, maxBuffer = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolvePromise) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer, env: process.env }, (error, stdout, stderr) => {
      resolvePromise({
        ok: !error,
        error: error ? String(error.message || error) : '',
        code: error?.code ?? null,
        killed: Boolean(error?.killed),
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      })
    })
  })
}

function resolveCodexCli(config = {}) {
  const configured = String(config.cli || config.codex?.cli || process.env.CODEX_CLI || '').trim()
  for (const candidate of [configured, ...CODEX_CLI_CANDIDATES].filter(Boolean)) {
    const path = expandHome(candidate)
    if (existsSync(path)) return path
  }
  return 'codex'
}

async function readCodexThreadMeta(id, exec = runFile) {
  if (!CODEX_UUID_RE.test(String(id ?? ''))) return null
  if (!existsSync(CODEX_STATE_DB)) return null
  const sql = `select model, archived, cwd from threads where id='${id}';`
  const result = await exec(
    'sqlite3',
    ['-readonly', '-noheader', '-separator', '|', CODEX_STATE_DB, sql],
    { timeoutMs: 5000 },
  )
  if (!result.ok) return null
  const line = result.stdout.trim().split('\n').pop() ?? ''
  if (!line) return null
  const [model, archived, cwd] = line.split('|')
  return {
    model: String(model ?? '').trim(),
    archived: String(archived ?? '').trim() === '1',
    cwd: String(cwd ?? '').trim(),
  }
}

function tailText(text, limit = 6000) {
  const value = String(text ?? '')
  return value.length > limit ? value.slice(-limit) : value
}

/** 从档案 Markdown 里取第 N 轮（用户输入 + Codex 回复 + 过程事件）；offset = 跳过尾部多少轮。 */
function parseRecentTurns(markdown, { chars = 4000, turns = 1, offset = 0 } = {}) {
  const lines = String(markdown ?? '').split('\n')
  const blocks = []
  let current = null
  for (const line of lines) {
    const match = /^###\s+(.+?)\s*$/.exec(line)
    if (match) {
      current = { header: match[1].trim(), lines: [] }
      blocks.push(current)
      continue
    }
    if (current) current.lines.push(line)
  }
  const eventSpecs = [
    { prefix: '命令', kind: 'command', label: '命令' },
    { prefix: '文件改动', kind: 'files', label: '文件改动' },
    { prefix: '子代理', kind: 'subagent', label: '子代理' },
    { prefix: 'MCP 工具', kind: 'mcp', label: 'MCP 工具' },
    { prefix: '联网搜索', kind: 'search', label: '联网搜索' },
    { prefix: '计划', kind: 'plan', label: '计划' },
    { prefix: '工具 `', kind: 'tool', label: '工具' },
    { prefix: '（上下文压缩点）', kind: 'compaction', label: '上下文压缩点' },
  ]
  const toEvent = (block) => {
    for (const spec of eventSpecs) {
      if (!block.header.startsWith(spec.prefix)) continue
      const rest = block.header.slice(spec.prefix.length).replace(/`/g, '').trim()
      let title = spec.label
      if (spec.kind === 'subagent') title = `子代理 ${rest}`.trim()
      else if (spec.kind === 'command') title = `命令 ${rest}`.trim()
      else if (spec.kind === 'mcp') title = rest ? `MCP ${rest}` : 'MCP 工具'
      else if (spec.kind === 'tool') title = rest ? `工具 ${rest}` : '工具'
      return { kind: spec.kind, title, detail: block.lines.join('\n').trim() }
    }
    return null
  }
  const list = []
  let turn = null
  for (const block of blocks) {
    if (block.header === '用户') {
      const text = block.lines.join('\n').trim()
      if (text.startsWith('<codex_delegation>')) {
        turn = null
        continue
      }
      turn = { user: text, replies: [], events: [] }
      list.push(turn)
      continue
    }
    if (!turn) continue
    if (block.header === 'Codex') {
      const text = block.lines.join('\n').trim()
      if (text) turn.replies.push(text)
      continue
    }
    const event = toEvent(block)
    if (event && event.detail) turn.events.push(event)
  }
  const rawTurns = list
    .map((item) => ({ user: item.user, reply: item.replies.join('\n\n').trim(), events: item.events }))
    .filter((item) => item.user || item.reply || item.events.length > 0)
  const withReply = rawTurns.filter((item) => item.reply)
  const pairs = withReply.length > 0 ? withReply : rawTurns
  const limitChars = Math.max(200, Number(chars) || 4000)
  const keep = Math.max(1, Math.min(50, Number(turns) || 1))
  const skip = Math.max(0, Math.min(10000, Number(offset) || 0))
  const end = Math.max(0, pairs.length - skip)
  const begin = Math.max(0, end - keep)
  const clamp = (text) => {
    const value = String(text ?? '')
    if (value.length <= limitChars) return { text: value, truncated: false }
    return { text: value.slice(value.length - limitChars), truncated: true }
  }
  return {
    turns: pairs.slice(begin, end).map((item) => ({
      user: clamp(item.user),
      reply: clamp(item.reply),
      events: item.events.slice(-40).map((event) => ({
        kind: event.kind,
        title: event.title,
        detail: event.detail.length > 1600 ? `${event.detail.slice(0, 1600)}…` : event.detail,
      })),
    })),
    hasMore: begin > 0,
  }
}

/** 从档案 Markdown 里提取该线程调用过的子代理与涉及的文件。 */
function extractArtifacts(markdown) {
  const lines = String(markdown ?? '').split('\n')
  const subagents = []
  const files = []
  const seenFiles = new Set()
  let section = ''
  let commandCount = 0
  const pushFile = (kind, path) => {
    const value = String(path ?? '').trim()
    if (!value || seenFiles.has(value)) return
    seenFiles.add(value)
    files.push({ kind, path: value })
  }
  for (const line of lines) {
    const heading = /^###\s+(.+?)\s*$/.exec(line)
    if (heading) {
      const label = heading[1].trim()
      if (label.startsWith('子代理')) {
        section = 'subagent'
        subagents.push({ label: label.replace(/^子代理\s*/, '').replace(/`/g, '').trim(), target: '' })
        continue
      }
      if (label.startsWith('文件改动')) {
        section = 'files'
        continue
      }
      if (label.startsWith('命令')) {
        commandCount += 1
        section = 'command'
        continue
      }
      section = ''
      continue
    }
    if (section === 'subagent' && subagents.length > 0) {
      const target = /目标[：:]\s*`?([0-9a-f-]{8,})`?/i.exec(line)
      if (target) subagents[subagents.length - 1].target = target[1]
      continue
    }
    if (section === 'files') {
      const change = /^\s*[-*]\s+`([^`]+)`\s*(?:[（(]([^）)]+)[）)])?\s*$/.exec(line)
      if (change) pushFile(change[2] || 'change', change[1])
    }
  }
  const citeRe = /:codex-file-citation\{path="([^"]+)"/g
  let match
  while ((match = citeRe.exec(markdown))) pushFile('citation', match[1])
  return { subagents, files, commandCount }
}

function recentPayload(root, params) {
  const entry = resolveConversation(root, params.get('id') ?? '')
  const path = safeResolve(root, entry.path)
  const markdown = readFileSync(path, 'utf8')
  const parsed = parseRecentTurns(markdown, {
    chars: Number(params.get('chars') ?? 4000),
    turns: Number(params.get('turns') ?? 1),
    offset: Number(params.get('offset') ?? 0),
  })
  const artifacts = extractArtifacts(markdown)
  return {
    id: entry.id,
    source: entry.source,
    title: entry.title,
    project: entry.project ?? '',
    project_basis: entry.project_basis ?? 'none',
    cwd: entry.cwd,
    model: entry.model,
    updated_at_ms: entry.updated_at_ms,
    total_chars: markdown.length,
    turns: parsed.turns,
    hasMore: parsed.hasMore,
    artifacts,
  }
}

function modelsPayload({ configPath = '' } = {}) {
  const result = { models: [], reasoningEfforts: [], source: '', defaultModel: '', defaultEffort: '' }
  try {
    const configText = readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf8')
    const configured = /^\s*model_catalog_json\s*=\s*"([^"]+)"/m.exec(configText)
    const modelLine = /^\s*model\s*=\s*"([^"]+)"/m.exec(configText)
    if (modelLine) result.defaultModel = modelLine[1]
    const path = expandHome(String(configPath || configured?.[1] || ''))
    if (!path || !existsSync(path)) return result
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const rawModels = Array.isArray(data.models) ? data.models : []
    const seen = new Set()
    for (const item of rawModels) {
      const id = String(item.slug ?? item.id ?? item.model ?? '').trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      const efforts = (item.supported_reasoning_levels ?? [])
        .map((level) => String(level.effort ?? level.id ?? level ?? '').trim())
        .filter(Boolean)
      if (efforts.length === 0) {
        result.models.push({ id, name: String(item.display_name ?? item.name ?? id), efforts: [] })
        continue
      }
      result.models.push({
        id,
        name: String(item.display_name ?? item.name ?? id),
        efforts,
        defaultEffort: String(item.default_reasoning_level ?? '').trim(),
      })
    }
    const effortSet = new Set()
    for (const model of result.models) for (const effort of model.efforts ?? []) effortSet.add(effort)
    result.reasoningEfforts = [...effortSet]
    result.source = path
  } catch {
    // 模型清单只是辅助信息，读不到时面板仍可用「跟随 Codex 配置」。
  }
  return result
}

/** 把 CLI 原始错误归类成 { code, hint }，前端负责展示原文 + 提示。 */
function classifyPanelError(text) {
  const raw = String(text ?? '')
  if (/quota|额度|usage limit|rate limit|HTTP 403|403 Forbidden|429/i.test(raw)) {
    const reset = /([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.\d+)?(?:Z|[+-][0-9]{2}:[0-9]{2})?)/.exec(raw)
    return {
      code: 'CODEX_QUOTA',
      hint: reset
        ? `额度/配额限制，重置时间约 ${reset[1]}；可等重置，或到 CC Switch 调整官方额度保护 / 切到支持该模型的第三方 provider。`
        : '额度/配额限制：可等额度重置，或到 CC Switch 调整官方额度保护 / 切到支持该模型的第三方 provider。',
    }
  }
  if (/active writer|thread-store conflict|already has an active writer/i.test(raw)) {
    return {
      code: 'CODEX_BUSY',
      hint: '该 Codex 线程正被其它 writer 占用（Codex App 或另一个 CLI）；先在 Codex 里关闭该线程，或稍后再发。',
    }
  }
  if (/authentication required|not logged in|login required|unauthorized|401/i.test(raw)) {
    return {
      code: 'CODEX_AUTH',
      hint: 'Codex CLI 还没有完成登录（或登录态失效）；先在本机执行 `codex login`，或用 Codex App 重新登录后再试。',
    }
  }
  if (/not supported when using Codex|model.*not (?:found|available)|unknown model/i.test(raw)) {
    return {
      code: 'CODEX_MODEL_UNAVAILABLE',
      hint: '当前 Codex 账号/provider 不支持这条线程的模型；在 CC Switch 切到支持的 provider，或改用支持该模型的线程。',
    }
  }
  return {
    code: 'CODEX_CLI_ERROR',
    hint: '检查 Codex CLI 是否已登录、CC Switch 当前 provider 是否支持该模型；错误原文见上。',
  }
}

function buildPanelResumeArgs({ cli, id, message, model, sandbox, reasoningEffort }) {
  const args = ['exec', 'resume', id, '--json', '--skip-git-repo-check']
  if (model) args.push('-m', model)
  if (sandbox) args.push('-c', `sandbox_mode="${sandbox}"`)
  if (reasoningEffort) args.push('-c', `model_reasoning_effort="${reasoningEffort}"`)
  args.push(message)
  return { command: cli, args }
}

/** 跑一轮 `codex exec resume`，把 assistant 文本收集起来；期间可由 interruptPanelTurn 打断。 */
function runPanelResume({ command, args, cwd, timeoutMs = 900000 }) {
  return new Promise((resolvePromise) => {
    let settled = false
    let killedByInterrupt = false
    let timedOut = false
    let stderrTail = ''
    let stdoutTail = ''
    const failureTexts = []
    const replies = []
    const finish = (payload) => {
      if (settled) return
      settled = true
      panelTurn.child = null
      resolvePromise(payload)
    }
    let child
    try {
      child = spawn(command, args, {
        cwd: cwd && existsSync(cwd) ? cwd : process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      finish({ ok: false, error: String(error?.message ?? error), reply: '', raw: '' })
      return
    }
    panelTurn.child = child
    panelTurn.startedAt = Date.now()
    panelTurn.threadId = ''
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGTERM')
      } catch {}
    }, Math.max(10000, Number(timeoutMs) || 900000))
    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let cut
      while ((cut = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, cut).trim()
        buffer = buffer.slice(cut + 1)
        if (!line) continue
        stdoutTail = `${stdoutTail}\n${line}`.slice(-6000)
        let event
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }
        if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
          const text = String(event.item.text ?? '').trim()
          if (text) replies.push(text)
          continue
        }
        if (event.type === 'error' && event.message) {
          failureTexts.push(String(event.message))
          continue
        }
        if (event.type === 'turn.failed') {
          failureTexts.push(String(event.error?.message ?? 'Codex 回合失败'))
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-4000)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      finish({ ok: false, error: String(error?.message ?? error), reply: '', raw: '' })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const reply = replies.join('\n\n').trim()
      const failed = failureTexts.length > 0
      const errorText = [
        killedByInterrupt ? '已打断当前回合（CLI 进程被终止）。' : '',
        timedOut ? '回合超时，已终止 CLI 进程。' : '',
        ...(failed ? failureTexts : []),
        !reply && !failed && !killedByInterrupt && !timedOut ? stderrTail.trim() : '',
      ]
        .filter(Boolean)
        .join('\n')
        .trim()
      finish({
        ok: Boolean(reply) && !failed && !killedByInterrupt && !timedOut,
        reply,
        error: errorText,
        exitCode: code ?? null,
        signal: signal ?? '',
        raw: stdoutTail.slice(-4000),
        interrupted: killedByInterrupt,
        timedOut,
      })
    })
    // 供外部打断：把 kill 挂到 panelTurn 上
    panelTurn.kill = () => {
      killedByInterrupt = true
      try {
        child.kill('SIGTERM')
      } catch {}
    }
  })
}

async function interruptPanelTurn() {
  if (appServer.rpc && appServer.activeTurn?.turnId) {
    const { threadId, turnId } = appServer.activeTurn
    try {
      await appServer.rpc.request('turn/interrupt', { threadId, turnId }, { timeoutMs: 15000 })
      return { ok: true, interrupted: true, mode: 'app-server' }
    } catch (error) {
      return {
        ok: false,
        interrupted: false,
        hint: `app-server interrupt 失败：${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
  if (!panelTurn.child || typeof panelTurn.kill !== 'function') {
    return { ok: false, interrupted: false, hint: '当前没有正在跑的回合' }
  }
  panelTurn.kill()
  panelTurn.child = null
  return { ok: true, interrupted: true, mode: 'exec' }
}

async function runPanelSend({
  root,
  threadId,
  message,
  sandbox = '',
  model = '',
  reasoningEffort = '',
  config = {},
  timeoutMs,
} = {}) {
  const id = String(threadId ?? '').trim()
  if (!CODEX_UUID_RE.test(id)) {
    throw new Error('线程编号格式不对：需要 36 位 UUID（可带 codex://threads/ 前缀）')
  }
  const text = String(message ?? '').trim()
  if (!text) throw new Error('消息不能为空')
  if (text.length > 40000) throw new Error('消息太长（上限 40000 字符）')
  const mode = String(sandbox ?? '').trim()
  if (mode && !['read-only', 'workspace-write', 'danger-full-access'].includes(mode)) {
    throw new Error(`sandbox 只能是 read-only / workspace-write / danger-full-access，收到 "${mode}"`)
  }
  const effort = String(reasoningEffort ?? '').trim()
  if (effort && !/^[A-Za-z0-9_-]{1,32}$/.test(effort)) {
    throw new Error(`推理强度不合法："${effort}"`)
  }
  let entry
  try {
    entry = resolveConversation(root, id)
  } catch (error) {
    throw new Error(`档案索引里没有这个线程：${error instanceof Error ? error.message : String(error)}`)
  }
  const meta = await readCodexThreadMeta(id)
  if (meta?.archived) throw new Error('这个线程已归档，先在 Codex 里取消归档再继续')
  const transport = String(config.transport || 'exec').toLowerCase()
  let appServerFallback = ''
  if (transport === 'app-server') {
    try {
      return await runAppServerSend({
        threadId: id,
        message: text,
        model: String(model ?? '').trim(),
        reasoningEffort: effort,
        config,
        timeoutMs,
        cwd: entry.cwd || meta?.cwd || '',
      })
    } catch (error) {
      appServerFallback = `app-server 不可用（${error instanceof Error ? error.message : String(error)}），已回退 exec resume。`
    }
  }
  const cli = resolveCodexCli(config)
  const cwd = (entry.cwd || meta?.cwd || '').trim()
  const invocation = buildPanelResumeArgs({
    cli,
    id,
    message: text,
    model: String(model ?? '').trim(),
    sandbox: mode,
    reasoningEffort: effort,
  })
  const result = await runPanelResume({
    command: invocation.command,
    args: invocation.args,
    cwd,
    timeoutMs: timeoutMs || config.resumeTimeoutMs,
  })
  if (result.ok) {
    return {
      ok: true,
      mode: 'resume',
      threadId: id,
      reply: result.reply,
      model: meta?.model ?? String(model ?? ''),
      raw: result.raw,
    }
  }
  const rawError = [result.error, result.error ? '' : result.raw].filter(Boolean).join('\n').trim()
  const activeWriter = /active writer|thread-store conflict/i.test(rawError)
  if (activeWriter) {
    const queueResult = await runFile(cli, ['queue', '--thread', id, '--message', text], { timeoutMs: 60000 })
    if (queueResult.ok) {
      return {
        ok: true,
        mode: 'queue',
        threadId: id,
        reply: '',
        queued: true,
        raw: tailText(queueResult.stdout, 2000),
      }
    }
    return {
      ok: false,
      mode: 'queue',
      threadId: id,
      code: 'CODEX_BUSY',
      hint: '该线程正被其它 writer 占用，queue 回退也失败了；先在 Codex 里关闭该线程再试。',
      error: rawError.slice(0, 4000),
      queueError: tailText(`${queueResult.error}\n${queueResult.stderr}`, 2000),
    }
  }
  const classified = classifyPanelError(rawError)
  return {
    ok: false,
    mode: 'resume',
    threadId: id,
    code: classified.code,
    hint: classified.hint,
    error: rawError.slice(0, 4000),
    raw: result.raw,
  }
}

// ---- Codex app-server 后端（可选，config.codex.transport = "app-server"） ----
const APP_SERVER_CLIENT_INFO = {
  clientInfo: { name: 'dsh-conversation-archive', title: 'DSH Codex Panel', version: '0.4.0' },
  capabilities: { experimentalApi: false, requestAttestation: false },
}

const appServer = {
  key: '',
  child: null,
  rpc: null,
  ready: null,
  idleTimer: null,
  activeTurn: null,
  sessions: new Map(),
}

class JsonRpcError extends Error {
  constructor(message, { code = null, data = null } = {}) {
    super(message)
    this.name = 'JsonRpcError'
    this.code = code
    this.data = data
  }
}

/** 新行分隔的 JSON-RPC 2.0 客户端（app-server 线上不带 jsonrpc 字段）。 */
class JsonRpcClient {
  constructor({ stdin, stdout, onNotification, onServerRequest }) {
    this.stdin = stdin
    this.stdout = stdout
    this.onNotification = onNotification ?? (() => {})
    this.onServerRequest = onServerRequest ?? (() => ({}))
    this.pending = new Map()
    this.nextId = 1
    this.closed = false
    this.lineReader = createInterface({ input: stdout, crlfDelay: Infinity })
    this.lineReader.on('line', (line) => this.handleLine(line))
    this.lineReader.on('close', () => this.failAll(new JsonRpcError('json-rpc stream closed', { code: 'STREAM_CLOSED' })))
    stdout.on?.('error', (error) => this.failAll(error))
  }

  request(method, params, { timeoutMs = 60000 } = {}) {
    if (this.closed) return Promise.reject(new JsonRpcError('json-rpc client is closed', { code: 'CLOSED' }))
    const id = this.nextId++
    const message = { id, method }
    if (params !== undefined) message.params = params
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => finish(reject, new JsonRpcError(`${method} timed out after ${timeoutMs}ms`, { code: 'TIMEOUT' })), timeoutMs)
        : null
      timer?.unref?.()
      const finish = (fn, value) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        this.pending.delete(id)
        fn(value)
      }
      this.pending.set(id, {
        resolve: (value) => finish(resolve, value),
        reject: (error) => finish(reject, error),
      })
      try {
        this.stdin.write(`${JSON.stringify(message)}\n`)
      } catch (error) {
        finish(reject, error)
      }
    })
  }

  notify(method, params) {
    const message = { method }
    if (params !== undefined) message.params = params
    if (!this.closed) this.stdin.write(`${JSON.stringify(message)}\n`)
  }

  handleLine(line) {
    const text = typeof line === 'string' ? line.trim() : ''
    if (!text) return
    let message
    try {
      message = JSON.parse(text)
    } catch {
      return
    }
    if (message.id !== undefined && message.method === undefined) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      if (message.error) {
        pending.reject(new JsonRpcError(message.error.message ?? 'rpc error', {
          code: message.error.code ?? null,
          data: message.error.data ?? null,
        }))
      } else {
        pending.resolve(message.result)
      }
      return
    }
    if (message.id !== undefined && message.method) {
      let result
      try {
        result = this.onServerRequest(message.method, message.params) ?? {}
      } catch {
        result = {}
      }
      try {
        this.stdin.write(`${JSON.stringify({ id: message.id, result })}\n`)
      } catch {}
      return
    }
    if (message.method) {
      try {
        this.onNotification(message.method, message.params)
      } catch {}
    }
  }

  failAll(error) {
    this.closed = true
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  close() {
    this.closed = true
    try {
      this.stdin.end()
    } catch {}
  }
}

function appServerEnv() {
  const keep = [
    'PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'CODEX_HOME',
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  ]
  const env = {}
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key]
  return env
}

function failAppServerSessions(error) {
  for (const session of appServer.sessions.values()) session.fail(error)
  appServer.sessions.clear()
  appServer.activeTurn = null
}

function closeAppServer() {
  if (appServer.idleTimer) clearTimeout(appServer.idleTimer)
  appServer.idleTimer = null
  appServer.ready = null
  failAppServerSessions(new JsonRpcError('codex app-server 已关闭', { code: 'CLOSED' }))
  const rpc = appServer.rpc
  appServer.rpc = null
  if (rpc) rpc.close()
  const child = appServer.child
  appServer.child = null
  if (child) {
    try {
      child.kill('SIGTERM')
    } catch {}
  }
}

function scheduleAppServerIdleClose(config = {}) {
  if (appServer.idleTimer) clearTimeout(appServer.idleTimer)
  const idleMs = Math.max(60000, Number(config.appServerIdleMs) || DEFAULT_CODEX_CONFIG.appServerIdleMs)
  appServer.idleTimer = setTimeout(() => closeAppServer(), idleMs)
  appServer.idleTimer.unref?.()
}

function handleAppServerNotification(method, params) {
  const threadId = params?.threadId
  const session = threadId ? appServer.sessions.get(threadId) : undefined
  if (session) session.handle(method, params)
}

function handleAppServerServerRequest(method, params) {
  if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
    const available = params?.availableDecisions
    if (Array.isArray(available)) {
      if (available.includes('decline')) return { decision: 'decline' }
      if (available.includes('cancel')) return { decision: 'cancel' }
    }
    return { decision: 'decline' }
  }
  if (method === 'item/permissions/requestApproval') return { permissions: {}, scope: 'turn' }
  if (method === 'item/tool/requestUserInput') return { answers: {} }
  return {}
}

async function ensureAppServer(config = {}) {
  const cli = resolveCodexCli(config)
  if (appServer.ready) {
    if (appServer.idleTimer) clearTimeout(appServer.idleTimer)
    appServer.idleTimer = null
    return appServer.ready
  }
  appServer.key = cli
  appServer.ready = (async () => {
    const child = spawn(cli, ['app-server', '--stdio'], {
      env: appServerEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stderr?.setEncoding?.('utf8')
    child.stderr?.on('data', () => {})
    const rpc = new JsonRpcClient({
      stdin: child.stdin,
      stdout: child.stdout,
      onNotification: handleAppServerNotification,
      onServerRequest: handleAppServerServerRequest,
    })
    child.on('exit', () => {
      appServer.child = null
      appServer.rpc = null
      appServer.ready = null
      failAppServerSessions(new JsonRpcError('codex app-server 进程退出', { code: 'EXITED' }))
    })
    await rpc.request('initialize', APP_SERVER_CLIENT_INFO, { timeoutMs: 120000 })
    rpc.notify('initialized')
    appServer.child = child
    appServer.rpc = rpc
    return appServer
  })().catch((error) => {
    appServer.ready = null
    throw error
  })
  return appServer.ready
}

async function appServerQuota(config = {}) {
  try {
    const server = await ensureAppServer(config)
    const result = await server.rpc.request('account/rateLimits/read', undefined, { timeoutMs: 30000 })
    return { ok: true, rateLimits: result ?? null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const classified = classifyPanelError(message)
    return { ok: false, code: classified.code, error: message, hint: classified.hint }
  } finally {
    scheduleAppServerIdleClose(config)
  }
}

function createAppServerTurn(threadId) {
  let turnId = null
  const buffer = []
  let settled = false
  let finalAnswer = null
  let partialAnswer = null
  let status = null
  let error = null
  let resolveOnce
  const completion = new Promise((resolve) => {
    resolveOnce = resolve
  })
  const apply = (method, params) => {
    if (method === 'item/completed') {
      if (params?.turnId && turnId && params.turnId !== turnId) return
      const item = params?.item ?? {}
      if (item.type === 'agentMessage') {
        const text = typeof item.text === 'string' ? item.text : ''
        if (item.phase === 'final_answer') finalAnswer = text
        else if (item.phase === 'partial_answer') partialAnswer = text
        else if (item.phase === null || item.phase === undefined) partialAnswer = text
      }
      return
    }
    if (settled) return
    const turn = params?.turn ?? {}
    if (turnId && turn.id && turn.id !== turnId) return
    settled = true
    status = turn.status ?? 'failed'
    error = turn.error ?? null
    resolveOnce({ answer: finalAnswer ?? partialAnswer, status, error })
  }
  return {
    threadId,
    get turnId() {
      return turnId
    },
    setTurnId(value) {
      turnId = value
      for (const [method, params] of buffer.splice(0)) apply(method, params)
    },
    handle(method, params) {
      if (method === 'turn/started') {
        if (!turnId && params?.turn?.id) turnId = params.turn.id
        return
      }
      if (method === 'item/completed' || method === 'turn/completed') {
        if (!turnId) {
          buffer.push([method, params])
          return
        }
        apply(method, params)
      }
    },
    wait(timeoutMs) {
      return Promise.race([
        completion,
        new Promise((resolve) => {
          const timer = setTimeout(() => {
            resolve({ answer: finalAnswer ?? partialAnswer, status: 'timeout', error: { message: '等待 app-server 回合超时' } })
          }, Math.max(15000, Number(timeoutMs) || 900000))
          timer.unref?.()
        }),
      ])
    },
    fail(reason) {
      if (settled) return
      settled = true
      status = 'failed'
      error = { message: reason?.message ?? String(reason ?? 'app-server 回合失败') }
      resolveOnce({ answer: finalAnswer ?? partialAnswer, status, error })
    },
  }
}

async function runAppServerSend({ threadId, message, model, reasoningEffort, config = {}, timeoutMs, cwd }) {
  const server = await ensureAppServer(config)
  const rpc = server.rpc
  try {
    await rpc.request('thread/resume', { threadId }, { timeoutMs: 60000 })
  } catch (error) {
    const raw = `app-server thread/resume 失败：${error instanceof Error ? error.message : String(error)}`
    const classified = classifyPanelError(raw)
    return { ok: false, mode: 'app-server', threadId, code: classified.code, hint: classified.hint, error: raw }
  }
  const session = createAppServerTurn(threadId)
  appServer.sessions.set(threadId, session)
  try {
    const params = {
      threadId,
      input: [{ type: 'text', text: message, text_elements: [] }],
    }
    if (model) params.model = model
    if (reasoningEffort) params.effort = reasoningEffort
    const result = await rpc.request('turn/start', params, { timeoutMs: 60000 })
    const turnId = result?.turn?.id ?? result?.turnId
    if (!turnId) throw new Error('turn/start 没有返回 turn id')
    session.setTurnId(turnId)
    appServer.activeTurn = { threadId, turnId }
  } catch (error) {
    appServer.sessions.delete(threadId)
    const raw = `app-server turn/start 失败：${error instanceof Error ? error.message : String(error)}`
    const classified = classifyPanelError(raw)
    return { ok: false, mode: 'app-server', threadId, code: classified.code, hint: classified.hint, error: raw }
  }
  const outcome = await session.wait(timeoutMs || config.resumeTimeoutMs)
  appServer.sessions.delete(threadId)
  appServer.activeTurn = null
  scheduleAppServerIdleClose(config)
  if (outcome.status === 'completed' && outcome.answer) {
    return { ok: true, mode: 'app-server', threadId, reply: String(outcome.answer), raw: '' }
  }
  const raw = outcome.error?.message
    ? String(outcome.error.message)
    : `app-server 回合结束状态：${outcome.status ?? 'unknown'}`
  const classified = classifyPanelError(raw)
  return { ok: false, mode: 'app-server', threadId, code: classified.code, hint: classified.hint, error: raw }
}

function dispatch(root, params) {
  const op = params.get('op') ?? 'list'
  if (op === 'list') {
    return listConversations(root, {
      query: params.get('q') ?? params.get('query') ?? '',
      source: params.get('source') ?? '',
      limit: Number(params.get('limit') ?? 30),
      offset: Number(params.get('offset') ?? 0),
    })
  }
  if (op === 'read') {
    return readConversation(root, {
      id: params.get('id') ?? '',
      offset: Number(params.get('offset') ?? 0),
      limit: Number(params.get('limit') ?? 20000),
    })
  }
  if (op === 'models') {
    return modelsPayload({ configPath: params.get('config') ?? '' })
  }
  if (op === 'search') {
    return searchConversations(root, {
      query: params.get('q') ?? params.get('query') ?? '',
      source: params.get('source') ?? '',
      limit: Number(params.get('limit') ?? 30),
      context: Number(params.get('context') ?? 120),
    })
  }
  throw new Error(`unknown op "${op}"`)
}

function jsonText(value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function readJsonBody(req) {
  return new Promise((resolvePromise) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1024 * 1024) req.destroy()
    })
    req.on('end', () => {
      try {
        resolvePromise(raw.trim() ? JSON.parse(raw) : {})
      } catch {
        resolvePromise({})
      }
    })
    req.on('error', () => resolvePromise({}))
  })
}

export function apply(ctx, config = {}) {
  const root = expandHome(config.root || DEFAULT_ROOT)
  const refresh = {
    ...DEFAULT_REFRESH,
    ...(config.refresh || {}),
    script: config.refresh?.script
      ? expandHome(config.refresh.script)
      : existsSync(PACKAGED_ADAPTER)
        ? PACKAGED_ADAPTER
        : '',
  }

  const codex = { ...DEFAULT_CODEX_CONFIG, ...(config.codex || {}) }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: '/api/conversation-archive',
      async handler(req, res) {
        try {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1')
          const op = url.searchParams.get('op') ?? ''
          let payload
          if (req.method === 'POST') {
            const body = await readJsonBody(req)
            if (op === 'send') {
              payload = await runPanelSend({
                root,
                threadId: body.threadId,
                message: body.message,
                sandbox: body.sandbox,
                model: body.model,
                reasoningEffort: body.reasoningEffort,
                timeoutMs: body.timeout_ms,
                config: codex,
              })
            } else if (op === 'interrupt') {
              payload = await interruptPanelTurn()
            } else {
              throw new Error(`unknown op "${op}"`)
            }
          } else {
            if (op === 'models') {
              payload = modelsPayload({ configPath: codex.modelCatalog || '' })
            } else if (op === 'quota') {
              payload = await appServerQuota(codex)
            } else {
              if (url.searchParams.get('refresh') !== '0') await maybeRefresh(root, refresh)
              payload = op === 'recent' ? recentPayload(root, url.searchParams) : dispatch(root, url.searchParams)
            }
          }
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(JSON.stringify(payload))
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'conversation_archive_list',
      description:
        'List archived coding-agent conversations (Codex and other sources) with their titles, ' +
        'working directories, models and sizes. Use it before reading one to pick a thread.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Case-insensitive substring over title, cwd, id and model.' },
          source: { type: 'string', description: 'Restrict to one source, such as "codex".' },
          limit: { type: 'integer', description: 'Page size, default 30.' },
          offset: { type: 'integer', description: 'Zero-based page offset, default 0.' },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            conversations: { type: 'array', items: { type: 'object' } },
          },
        },
        render(_args, value) {
          return jsonText(value)
        },
      },
      async execute(args) {
        await maybeRefresh(root, refresh)
        return listConversations(root, args ?? {})
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'conversation_archive_read',
      description:
        'Read one archived conversation as Markdown. Accepts an exact id or a unique prefix. ' +
        'Use offset/limit to page through long transcripts.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Conversation id, or a unique prefix of it.' },
          offset: { type: 'integer', description: 'Start character offset, default 0.' },
          limit: { type: 'integer', description: 'Maximum characters to return, default 20000.' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            text: { type: 'string' },
            truncated: { type: 'boolean' },
          },
        },
        render(_args, value) {
          return jsonText(value)
        },
      },
      async execute(args) {
        await maybeRefresh(root, refresh)
        return readConversation(root, args ?? {})
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'conversation_archive_takeover',
      description:
        'Take over an archived conversation by id, unique id prefix, or title substring. Returns the ' +
        'handoff package: metadata plus the tail of the transcript, which is what you continue from. ' +
        'Call it when the user says "take over <id or title>" or asks to continue an archived thread.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Conversation id, unique id prefix, or a distinctive title substring.' },
          budget: { type: 'integer', description: 'Tail characters of the transcript to return, default 40000.' },
        },
        required: ['ref'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            handoff: { type: 'string' },
          },
        },
        render(_args, value) {
          return jsonText(value)
        },
      },
      async execute(args) {
        await maybeRefresh(root, refresh)
        const entry = resolveConversation(root, args?.ref)
        const text = readFileSync(safeResolve(root, entry.path), 'utf8')
        const budget = Math.max(2000, Number(args?.budget ?? 40000))
        const tail = text.slice(Math.max(0, text.length - budget))
        const head = [
          `# 接管：${entry.title || entry.id}`,
          '',
          `- 原来源：${entry.source}`,
          `- 会话 id：${entry.id}`,
          `- 工作目录：${entry.cwd || '-'}`,
          `- 模型：${entry.model || '-'}`,
          `- 档案总长：${text.length} 字符，下面只给最后 ${tail.length} 字符`,
          '',
          '继续之前先确认：最后一条用户要求是什么、Codex 已经改到哪一步、还有什么没做完。',
          '需要更早的上下文时，用 conversation_archive_read 按 offset 往前翻。',
          '',
          '---',
          '',
        ].join('\n')
        return {
          id: entry.id,
          title: entry.title,
          source: entry.source,
          cwd: entry.cwd,
          model: entry.model,
          total_chars: text.length,
          handoff_chars: tail.length,
          handoff: head + tail,
        }
      },
    }),
  )

  ctx.effect(() =>
    ctx.tools.register({
      name: 'conversation_archive_search',
      description:
        'Search archived conversations. Plain text or /regex/ syntax; returns the matching line and ' +
        'a snippet per hit so you can locate the thread and offset to read from.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Plain substring, or /pattern/flags for a regular expression.' },
          source: { type: 'string', description: 'Restrict to one source, such as "codex".' },
          limit: { type: 'integer', description: 'Maximum hits, default 30.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            matches: { type: 'array', items: { type: 'object' } },
          },
        },
        render(_args, value) {
          return jsonText(value)
        },
      },
      async execute(args) {
        await maybeRefresh(root, refresh)
        return searchConversations(root, args ?? {})
      },
    }),
  )
}
