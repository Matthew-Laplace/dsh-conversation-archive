import { readFileSync, statSync, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

export const name = 'conversation-archive'

export const inject = ['tools', 'webServer']

function expandHome(value) {
  return value.startsWith('~') ? join(homedir(), value.slice(1)) : value
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

// ---- Codex CLI：把消息发回未归档的原会话 ----
const CODEX_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODEX_CLI_CANDIDATES = [
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
  '/Applications/Codex.app/Contents/Resources/codex',
]
const CODEX_APP_PATTERNS = [
  '^/Applications/ChatGPT\\.app/Contents/MacOS/ChatGPT',
  '^/Applications/Codex\\.app/Contents/MacOS/Codex',
]
const CODEX_STATE_DB = join(homedir(), '.codex', 'state_5.sqlite')
const DEFAULT_CODEX_CONFIG = {
  cli: '',
  queueTimeoutMs: 60000,
  resumeTimeoutMs: 900000,
}

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
 * Codex 侧有新的调试记录时，自动重跑导出脚本，保证 DSH 里看到的是最新的。
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
  if (!existsSync(path)) return { version: 1, conversations: [] }
  const mtime = statSync(path).mtimeMs
  if (cachedIndex.path === path && cachedIndex.mtime === mtime) return cachedIndex.data
  const data = JSON.parse(readFileSync(path, 'utf8'))
  cachedIndex = { path, mtime, data }
  return data
}

function safeResolve(root, relative) {
  const base = resolve(root)
  const target = resolve(base, relative)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`path escapes the archive root: ${relative}`)
  }
  return target
}

function listConversations(root, { query = '', source = '', limit = 30, offset = 0 }) {
  const index = loadIndex(root)
  const needle = query.trim().toLowerCase()
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
      cwd: item.cwd,
      model: item.model,
      updated_at_ms: item.updated_at_ms,
      created_at_ms: item.created_at_ms,
      items: item.items,
      chars: item.chars,
    })),
  }
}

/**
 * 按「完整 id / 唯一前缀 / 标题子串」解析一条档案。
 * 接管走的就是这条路径：用户说一个 id 或一个标题就能定位。
 */
function resolveConversation(root, ref) {
  const index = loadIndex(root)
  const key = String(ref ?? '').trim()
  if (!key) throw new Error('conversation reference is required')
  const all = index.conversations ?? []
  const exact = all.filter((item) => item.id === key)
  if (exact.length === 1) return exact[0]
  const prefix = all.filter((item) => item.id.startsWith(key))
  if (prefix.length === 1) return prefix[0]
  const lowered = key.toLowerCase()
  const byTitle = all.filter((item) => String(item.title ?? '').toLowerCase().includes(lowered))
  if (byTitle.length === 1) return byTitle[0]
  const candidates = prefix.length > 1 ? prefix : byTitle
  if (candidates.length === 0) throw new Error(`no archived conversation matches "${key}"`)
  throw new Error(
    `"${key}" matches ${candidates.length} conversations, be more specific: ` +
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
  for (const entry of sources) {
    let text
    try {
      text = readFileSync(safeResolve(root, entry.path), 'utf8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    let hits = 0
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      const matched = regex ? regex.test(line) : line.toLowerCase().includes(needle)
      if (!matched) continue
      hits += 1
      results.push({
        id: entry.id,
        source: entry.source,
        title: entry.title,
        line: i + 1,
        snippet: line.length > context * 2 ? `${line.slice(0, context * 2)}…` : line,
      })
      if (hits >= 5) break
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

async function detectCodexAppRunning(exec = runFile) {
  for (const pattern of CODEX_APP_PATTERNS) {
    const result = await exec('pgrep', ['-f', pattern], { timeoutMs: 5000 })
    if (result.ok && result.stdout.trim() !== '') return true
  }
  return false
}

function buildCodexInvocation({ cli, mode, id, message, model }) {
  if (mode === 'queue') {
    return { command: cli, args: ['queue', '--thread', id, '--message', message] }
  }
  const args = ['exec', 'resume', id]
  if (model) args.push('-m', model)
  args.push('-c', 'sandbox_mode="read-only"', '--skip-git-repo-check', message)
  return { command: cli, args }
}

function parseQueueOutput(stdout) {
  const match = /Queued message\s+(\S+)\s+for thread\s+(\S+)/i.exec(String(stdout || ''))
  return match ? { messageId: match[1], threadId: match[2] } : null
}

async function readCodexThreadMeta(id, exec = runFile) {
  if (!CODEX_UUID_RE.test(String(id ?? ''))) return null
  if (!existsSync(CODEX_STATE_DB)) return null
  const sql = `select model, archived from threads where id='${id}';`
  const result = await exec(
    'sqlite3',
    ['-readonly', '-noheader', '-separator', '|', CODEX_STATE_DB, sql],
    { timeoutMs: 5000 },
  )
  if (!result.ok) return null
  const line = result.stdout.trim().split('\n').pop() ?? ''
  if (!line) return null
  const [model, archived] = line.split('|')
  return { model: String(model ?? '').trim(), archived: String(archived ?? '').trim() === '1' }
}

function tailText(text, limit = 6000) {
  const value = String(text ?? '')
  return value.length > limit ? value.slice(-limit) : value
}

/**
 * 把一条用户消息发回 Codex 的原线程（未归档）。
 *
 * 两种交付方式：
 * - queue：线程正被 Codex app 打开时用 `codex queue`，消息进 app 的队列，由 app 消费；
 * - resume：线程没有活跃 writer 时用 `codex exec resume`，CLI 直接跑一轮并追加到原会话。
 * `mode=auto` 时：指定 model 走 resume（queue 不能切模型）；否则看 app 是否在跑。
 *
 * 失败语义：返回 `{ ok: false, error, hint }`，不抛异常，方便模型接着判断。
 */
async function runLiveSend({
  root,
  ref,
  message,
  model = '',
  mode = 'auto',
  timeoutMs,
  config = {},
  exec = runFile,
  appRunning,
  threadMeta,
} = {}) {
  const entry = resolveConversation(root, ref)
  if (!CODEX_UUID_RE.test(entry.id)) {
    throw new Error(`"${entry.id}" is not a Codex thread id; only Codex conversations can be messaged`)
  }
  const text = String(message ?? '').trim()
  if (!text) throw new Error('message is required')
  if (text.length > 40000) throw new Error('message is too long (max 40000 characters)')
  const modelId = String(model ?? '').trim()
  if (modelId && !/^[A-Za-z0-9._:@/+\-]+$/.test(modelId)) throw new Error(`invalid model id "${modelId}"`)
  const desiredMode = ['auto', 'queue', 'resume'].includes(mode) ? mode : 'auto'
  const meta = await (threadMeta ? threadMeta(entry.id) : readCodexThreadMeta(entry.id, exec))
  if (meta?.archived) {
    throw new Error(`conversation ${entry.id} is archived; only unarchived Codex threads can be messaged`)
  }
  const running = typeof appRunning === 'boolean' ? appRunning : await detectCodexAppRunning(exec)
  const selected = desiredMode === 'auto' ? (modelId ? 'resume' : running ? 'queue' : 'resume') : desiredMode
  const cli = resolveCodexCli(config)
  const queueTimeoutMs = Math.max(5000, Number(config.queueTimeoutMs || DEFAULT_CODEX_CONFIG.queueTimeoutMs))
  const resumeTimeoutMs = Math.max(10000, Number(timeoutMs || config.resumeTimeoutMs || DEFAULT_CODEX_CONFIG.resumeTimeoutMs))
  const base = {
    id: entry.id,
    title: entry.title,
    source: entry.source,
    app_running: running,
    requested_mode: desiredMode,
    mode: selected,
    model: modelId || meta?.model || '',
    command: cli,
  }
  const queueInvocation = buildCodexInvocation({ cli, mode: 'queue', id: entry.id, message: text })
  const resumeInvocation = buildCodexInvocation({ cli, mode: 'resume', id: entry.id, message: text, model: modelId })

  if (selected === 'queue') {
    const queueResult = await exec(queueInvocation.command, queueInvocation.args, {
      timeoutMs: queueTimeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    })
    if (queueResult.ok) {
      const parsed = parseQueueOutput(queueResult.stdout)
      const latest = await readCodexThreadMeta(entry.id, exec)
      return {
        ok: true,
        ...base,
        delivery: 'queue',
        queued_message_id: parsed?.messageId ?? '',
        thread_model: latest?.model ?? base.model,
        output_tail: tailText(queueResult.stdout + queueResult.stderr, 2000),
        hint: 'Message queued to the open Codex thread; the app consumes it asynchronously.',
      }
    }
    if (desiredMode === 'queue') {
      return {
        ok: false,
        ...base,
        delivery: 'queue',
        error: tailText(queueResult.error + queueResult.stderr, 2000),
        hint: 'The Codex app is probably not running or the thread is not open; retry with mode=resume.',
      }
    }
  }

  const resumeResult = await exec(resumeInvocation.command, resumeInvocation.args, {
    timeoutMs: resumeTimeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (resumeResult.ok) {
    const latest = await readCodexThreadMeta(entry.id, exec)
    return {
      ok: true,
      ...base,
      delivery: 'resume',
      thread_model: latest?.model ?? (modelId || base.model),
      output_tail: tailText(resumeResult.stdout, 6000),
      hint: 'The thread was resumed by the Codex CLI; the message and reply are appended to the original conversation.',
    }
  }
  const combined = `${resumeResult.error}\n${resumeResult.stderr}`.trim()
  const activeWriter = /active writer|thread-store conflict/i.test(combined)
  if (activeWriter) {
    if (desiredMode === 'resume') {
      return {
        ok: false,
        ...base,
        delivery: 'resume',
        error: tailText(combined, 2000),
        hint: 'The thread is held by another writer. Use mode=queue for an open thread, or close it in Codex first.',
      }
    }
    const fallback = await exec(queueInvocation.command, queueInvocation.args, {
      timeoutMs: queueTimeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    })
    if (fallback.ok) {
      const parsed = parseQueueOutput(fallback.stdout)
      const latest = await readCodexThreadMeta(entry.id, exec)
      return {
        ok: true,
        ...base,
        mode: 'queue',
        delivery: 'queue',
        queued_message_id: parsed?.messageId ?? '',
        thread_model: latest?.model ?? base.model,
        output_tail: tailText(fallback.stdout, 2000),
        hint: 'The thread is held by the app, so the message was queued instead; the app consumes it asynchronously.',
      }
    }
    return {
      ok: false,
      ...base,
      delivery: 'resume',
      error: tailText(combined, 2000),
      fallback_error: tailText(fallback.error + fallback.stderr, 1000),
      hint: 'The thread is held by another writer and queueing also failed.',
    }
  }
  return {
    ok: false,
    ...base,
    delivery: 'resume',
    error: tailText(combined, 4000),
    hint: 'Codex CLI could not append the message; check the model id, account quota and Codex CLI path.',
  }
}

export { runLiveSend, buildCodexInvocation, parseQueueOutput, detectCodexAppRunning, readCodexThreadMeta, resolveCodexCli }

function dispatch(root, params) {
  const op = params.get('op') ?? 'list'
  if (op === 'list') {
    return listConversations(root, {
      query: params.get('q') ?? '',
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
  if (op === 'search') {
    return searchConversations(root, {
      query: params.get('q') ?? '',
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
          const refreshed = url.searchParams.get('refresh') === '0' ? null : await maybeRefresh(root, refresh)
          const payload = dispatch(root, url.searchParams)
          const body = JSON.stringify(refreshed ? { ...payload, refreshed } : payload)
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(body)
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

  ctx.effect(() =>
    ctx.tools.register({
      name: 'conversation_archive_send',
      description:
        'Send a message back into an UNARCHIVED Codex conversation (the original live thread) through ' +
        'the local Codex CLI. mode=queue: the thread is open in the Codex app, so the message is queued ' +
        'and the app consumes it. mode=resume: the thread is free, so the CLI runs one turn and appends ' +
        'it; pass model to switch the thread model first. mode=auto picks between them. ' +
        'Requires the Codex CLI and app on this Mac; it never writes the Codex databases directly.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Conversation id, unique id prefix, or a distinctive title substring.' },
          message: { type: 'string', description: 'Text to send as the next user turn.' },
          model: { type: 'string', description: 'Optional model id; resume mode switches the thread to it before sending.' },
          mode: { type: 'string', enum: ['auto', 'queue', 'resume'], description: 'Delivery strategy; default auto.' },
          timeout_ms: { type: 'integer', description: 'Resume timeout in milliseconds; default 900000.' },
        },
        required: ['ref', 'message'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            id: { type: 'string' },
            delivery: { type: 'string' },
            thread_model: { type: 'string' },
            output_tail: { type: 'string' },
            error: { type: 'string' },
            hint: { type: 'string' },
          },
        },
        render(_args, value) {
          return jsonText(value)
        },
      },
      async execute(args) {
        await maybeRefresh(root, refresh)
        return runLiveSend({
          root,
          ref: args?.ref,
          message: args?.message,
          model: args?.model,
          mode: args?.mode ?? 'auto',
          timeoutMs: args?.timeout_ms,
          config: codex,
        })
      },
    }),
  )
}
