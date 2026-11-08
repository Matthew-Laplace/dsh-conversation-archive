window.__ModuleLoader__.load({
  id: '@local/conversation-archive',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const LABELS = {
      zh: {
        title: '对话档案',
        hint: '来自外部编程助手的已归档对话。只读浏览；agent 可用 conversation_archive_send 把消息发回原 Codex 线程。',
        search: '搜索标题、目录、id',
        empty: '没有匹配的对话。',
        loading: '加载中…',
        chars: '字符',
        copy: '复制全文',
        copied: '已复制',
      },
      en: {
        title: 'Conversation archive',
        hint: 'Conversations archived from external coding agents. Read-only here; agent tools can send a message back into the original Codex thread.',
        search: 'Search title, directory or id',
        empty: 'No matching conversations.',
        loading: 'Loading…',
        chars: 'chars',
        copy: 'Copy transcript',
        copied: 'Copied',
      },
    }
    const lang = (document.documentElement.lang || navigator.language || 'zh').startsWith('zh')
      ? 'zh'
      : 'en'
    const T = LABELS[lang]

    function useDebounced(value, delay) {
      const [debounced, setDebounced] = React.useState(value)
      React.useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay)
        return () => clearTimeout(timer)
      }, [value, delay])
      return debounced
    }

    function formatDate(ms) {
      if (!ms) return ''
      const d = new Date(ms)
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    const styles = {
      root: { display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0', minHeight: 0, flex: 1 },
      hint: { fontSize: 12, opacity: 0.65, margin: 0 },
      search: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '8px 10px',
        borderRadius: 8,
        border: '1px solid color-mix(in oklab, currentColor 20%, transparent)',
        background: 'transparent',
        color: 'inherit',
        fontSize: 13,
        outline: 'none',
      },
      body: { display: 'flex', gap: 12, minHeight: 0, flex: 1 },
      list: {
        width: '38%',
        minWidth: 240,
        maxHeight: '60vh',
        overflowY: 'auto',
        border: '1px solid color-mix(in oklab, currentColor 14%, transparent)',
        borderRadius: 10,
      },
      row: (active) => ({
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '8px 10px',
        border: 'none',
        borderBottom: '1px solid color-mix(in oklab, currentColor 10%, transparent)',
        background: active ? 'color-mix(in oklab, currentColor 10%, transparent)' : 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        font: 'inherit',
      }),
      rowTitle: { fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      rowMeta: { fontSize: 11, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      detail: {
        flex: 1,
        minWidth: 0,
        maxHeight: '60vh',
        overflow: 'auto',
        border: '1px solid color-mix(in oklab, currentColor 14%, transparent)',
        borderRadius: 10,
        padding: 12,
      },
      detailHead: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 },
      detailTitle: { fontSize: 14, fontWeight: 600, margin: 0 },
      meta: { fontSize: 11, opacity: 0.6 },
      pre: {
        margin: 0,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      },
      button: {
        marginLeft: 'auto',
        padding: '3px 8px',
        borderRadius: 6,
        border: '1px solid color-mix(in oklab, currentColor 22%, transparent)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: 11,
      },
    }

    function ArchivePage() {
      const [query, setQuery] = React.useState('')
      const debounced = useDebounced(query, 250)
      const [items, setItems] = React.useState([])
      const [total, setTotal] = React.useState(0)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState('')
      const [selected, setSelected] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [copied, setCopied] = React.useState(false)

      React.useEffect(() => {
        let cancelled = false
        setLoading(true)
        const url = `/api/conversation-archive?op=list&limit=200&q=${encodeURIComponent(debounced)}`
        fetch(url)
          .then((res) => res.json())
          .then((data) => {
            if (cancelled) return
            if (data.error) throw new Error(data.error)
            setItems(data.conversations ?? [])
            setTotal(data.total ?? 0)
            setError('')
          })
          .catch((err) => !cancelled && setError(String(err.message || err)))
          .finally(() => !cancelled && setLoading(false))
        return () => {
          cancelled = true
        }
      }, [debounced])

      React.useEffect(() => {
        if (!selected) {
          setDetail(null)
          return
        }
        let cancelled = false
        fetch(`/api/conversation-archive?op=read&id=${encodeURIComponent(selected)}&limit=40000`)
          .then((res) => res.json())
          .then((data) => !cancelled && setDetail(data))
          .catch(() => !cancelled && setDetail(null))
        return () => {
          cancelled = true
        }
      }, [selected])

      const copy = React.useCallback(() => {
        if (!detail?.text) return
        navigator.clipboard.writeText(detail.text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }, [detail])

      return h(
        'div',
        { style: styles.root },
        h('p', { style: styles.hint }, T.hint),
        h('input', {
          style: styles.search,
          placeholder: T.search,
          value: query,
          onChange: (event) => setQuery(event.target.value),
        }),
        h(
          'div',
          { style: styles.body },
          h(
            'div',
            { style: styles.list },
            loading && items.length === 0
              ? h('div', { style: { ...styles.rowMeta, padding: 10 } }, T.loading)
              : items.length === 0
                ? h('div', { style: { ...styles.rowMeta, padding: 10 } }, T.empty)
                : items.map((item) =>
                    h(
                      'button',
                      {
                        key: `${item.source}:${item.id}`,
                        type: 'button',
                        style: styles.row(selected === item.id),
                        onClick: () => setSelected(item.id),
                      },
                      h('div', { style: styles.rowTitle }, item.title || item.id.slice(0, 8)),
                      h(
                        'div',
                        { style: styles.rowMeta },
                        `${formatDate(item.updated_at_ms)} · ${(item.chars / 1000).toFixed(1)}k ${T.chars}`,
                      ),
                    ),
                  ),
          ),
          h(
            'div',
            { style: styles.detail },
            error ? h('div', { style: { ...styles.meta, color: 'crimson' } }, error) : null,
            detail
              ? h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { style: styles.detailHead },
                    h('h3', { style: styles.detailTitle }, detail.title || detail.id),
                    h('span', { style: styles.meta }, `${detail.source} · ${detail.total_chars} ${T.chars}`),
                    h('button', { type: 'button', style: styles.button, onClick: copy }, copied ? T.copied : T.copy),
                  ),
                  h('pre', { style: styles.pre }, detail.text),
                )
              : h('div', { style: styles.meta }, total > 200 ? `${T.hint} (${total})` : ''),
          ),
        ),
      )
    }

    // ---- Codex 会话：侧边栏入口、会话行图标、添加会话弹窗 ----
    const CODEX_STORAGE_KEY = 'dsh-codex-session-ids'
    const codexSessionIds = new Set()
    const codexListeners = new Set()
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    function notifyCodexSessions() {
      for (const listener of [...codexListeners]) listener()
    }
    function replaceCodexSessions(ids) {
      codexSessionIds.clear()
      for (const id of ids) codexSessionIds.add(id)
      try {
        window.localStorage.setItem(CODEX_STORAGE_KEY, JSON.stringify([...codexSessionIds]))
      } catch {}
      notifyCodexSessions()
    }
    function addCodexSession(id) {
      if (!id) return
      codexSessionIds.add(id)
      try {
        window.localStorage.setItem(CODEX_STORAGE_KEY, JSON.stringify([...codexSessionIds]))
      } catch {}
      notifyCodexSessions()
    }
    function useCodexSessionIds() {
      const [, force] = React.useState(0)
      React.useEffect(() => {
        const listener = () => force((value) => value + 1)
        codexListeners.add(listener)
        return () => codexListeners.delete(listener)
      }, [])
      return codexSessionIds
    }
    function CodexMark({ size = 16 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true', style: { flex: '0 0 auto' } },
        h('rect', { x: 2, y: 2, width: 20, height: 20, rx: 5, fill: '#10a37f' }),
        h('path', { d: 'M7 9l3 3-3 3', fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M13 15h4', fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round' }),
      )
    }
    function parseCodexRef(input) {
      const value = String(input ?? '').trim()
      const match = /codex:\/\/threads\/([0-9a-fA-F-]{36})/.exec(value)
      const id = (match ? match[1] : value).trim()
      return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id) ? id : ''
    }

    async function createCodexSession(ctx, binding) {
      const sessions = ctx.get('sessions')
      const uiWorkspace = ctx.get('uiWorkspace')
      const workspaces = ctx.get('workspaces')
      const before = new Set()
      try {
        const snapshot = sessions?.list?.getSnapshot?.()
        for (const id of Object.keys(snapshot?.byId ?? {})) before.add(id)
      } catch {}
      let mainId
      try {
        mainId = uiWorkspace?.mainReference?.sessionId
      } catch {}
      let workspaceId
      try {
        const snapshot = workspaces?.list?.getSnapshot?.()
        const items = snapshot?.items ?? []
        workspaceId = (items.find((item) => item.sessionIds?.includes(mainId)) ?? items[0])?.workspaceId
      } catch {}
      let sessionId
      if (sessions?.create && workspaceId) {
        try {
          sessionId = await sessions.create({ workspaceId, agentPreset: 'codex' })
        } catch {
          sessionId = undefined
        }
      }
      if (!sessionId && uiWorkspace?.startSession) {
        uiWorkspace.startSession(undefined, { agentPreset: 'codex' })
        for (let attempt = 0; attempt < 60 && sessionId === undefined; attempt += 1) {
          await sleep(50)
          try {
            const snapshot = sessions?.list?.getSnapshot?.()
            sessionId = Object.keys(snapshot?.byId ?? {}).find((id) => !before.has(id))
          } catch {}
        }
      }
      if (!sessionId) throw new Error('创建 Codex 会话失败')
      await fetch('/api/conversation-archive?op=bind', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          threadId: binding?.threadId ?? '',
          title: binding?.title ?? '',
          cwd: binding?.cwd ?? '',
        }),
      }).catch(() => {})
      addCodexSession(sessionId)
      try {
        uiWorkspace?.openSession?.(sessionId)
      } catch {}
      return sessionId
    }

    const codexDialogStyles = {
      overlay: {
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.45)',
      },
      panel: {
        width: 'min(460px, calc(100vw - 32px))',
        maxHeight: 'min(560px, calc(100vh - 64px))',
        overflow: 'auto',
        borderRadius: 12,
        padding: 18,
        background: 'var(--dsw-alias-surface, #ffffff)',
        color: 'var(--dsw-alias-text, #1f2328)',
        boxShadow: '0 18px 60px rgba(0, 0, 0, 0.28)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      },
      title: { fontSize: 16, fontWeight: 600, margin: 0 },
      hint: { fontSize: 12, opacity: 0.7, margin: 0, lineHeight: 1.5 },
      row: { display: 'flex', gap: 8 },
      input: {
        flex: 1,
        minWidth: 0,
        padding: '7px 9px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border, #d0d7de)',
        background: 'transparent',
        color: 'inherit',
        fontSize: 13,
      },
      button: {
        padding: '7px 12px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border, #d0d7de)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 13,
        whiteSpace: 'nowrap',
      },
      primary: { background: '#10a37f', borderColor: '#10a37f', color: '#fff' },
      list: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, maxHeight: 240, overflow: 'auto' },
      item: {
        textAlign: 'left',
        padding: '7px 9px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border, #d0d7de)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 13,
      },
      meta: { fontSize: 11, opacity: 0.65, marginTop: 2 },
      error: { color: 'crimson', fontSize: 12 },
      footer: { display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '4px 6px', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13, borderRadius: 6 },
    }

    function CodexSessionsDialog({ ctx, onClose }) {
      const [input, setInput] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [loading, setLoading] = React.useState(false)
      const [threads, setThreads] = React.useState(null)
      async function create(binding) {
        setBusy(true)
        setError('')
        try {
          await createCodexSession(ctx, binding)
          onClose()
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          setBusy(false)
        }
      }
      async function fetchThreads() {
        setLoading(true)
        setError('')
        try {
          const response = await fetch('/api/conversation-archive?op=list&source=codex&limit=100&refresh=0')
          const data = await response.json()
          setThreads(Array.isArray(data.conversations) ? data.conversations : [])
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          setLoading(false)
        }
      }
      function submitDeepLink() {
        const id = parseCodexRef(input)
        if (!id) {
          setError('请输入 codex://threads/<id> 或 36 位会话 id')
          return
        }
        create({ threadId: id })
      }
      return h(
        'div',
        { style: codexDialogStyles.overlay, onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } },
        h(
          'div',
          { style: codexDialogStyles.panel },
          h('h2', { style: codexDialogStyles.title }, 'Codex 会话'),
          h('p', { style: codexDialogStyles.hint }, '这个会话的回复由 Codex 原生线程生成，DSH 只负责显示和转发。'),
          h('button', { type: 'button', style: { ...codexDialogStyles.button, ...codexDialogStyles.primary }, disabled: busy, onClick: () => create(null) }, '新建 Codex 会话'),
          h('div', { style: codexDialogStyles.row },
            h('input', { style: codexDialogStyles.input, value: input, placeholder: '粘贴 codex://threads/<id> 或会话 id', onChange: (event) => setInput(event.target.value) }),
            h('button', { type: 'button', style: codexDialogStyles.button, disabled: busy, onClick: submitDeepLink }, '接管'),
          ),
          h('div', { style: codexDialogStyles.row },
            h('button', { type: 'button', style: codexDialogStyles.button, disabled: loading, onClick: fetchThreads }, loading ? '抓取中…' : '一键抓取 Codex 会话'),
            h('button', { type: 'button', style: codexDialogStyles.button, disabled: busy, onClick: onClose }, '关闭'),
          ),
          error ? h('div', { style: codexDialogStyles.error }, error) : null,
          threads ? (threads.length === 0
            ? h('div', { style: codexDialogStyles.hint }, '没有找到未归档的 Codex 会话。')
            : h('div', { style: codexDialogStyles.list }, threads.map((item) => h('button', {
                key: item.id,
                type: 'button',
                style: codexDialogStyles.item,
                disabled: busy,
                onClick: () => create({ threadId: item.id, title: item.title ?? '', cwd: item.cwd ?? '' }),
              },
              h('div', null, item.title || item.id.slice(0, 8)),
              h('div', { style: codexDialogStyles.meta }, `${item.model || 'codex'} · ${item.cwd || ''}`),
            )))
          ) : null,
        ),
      )
    }

    function CodexFooterButton({ ctx }) {
      const [open, setOpen] = React.useState(false)
      return h(
        React.Fragment,
        null,
        h('button', { type: 'button', style: codexDialogStyles.footer, title: 'Codex 会话', onClick: () => setOpen(true) },
          h(CodexMark, { size: 16 }),
          h('span', null, 'Codex'),
        ),
        open ? h(CodexSessionsDialog, { ctx, onClose: () => setOpen(false) }) : null,
      )
    }

    function CodexRowIcon({ sessionId }) {
      const ids = useCodexSessionIds()
      if (!ids.has(sessionId)) return null
      return h('span', { title: 'Codex 会话', style: { display: 'inline-flex', alignItems: 'center', marginRight: 6, flex: '0 0 auto' } }, h(CodexMark, { size: 14 }))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          const saved = JSON.parse(window.localStorage.getItem(CODEX_STORAGE_KEY) || '[]')
          if (Array.isArray(saved)) replaceCodexSessions(saved)
        } catch {}
        fetch('/api/conversation-archive?op=bindings&refresh=0')
          .then((response) => response.json())
          .then((data) => {
            if (data && data.bindings) replaceCodexSessions(Object.keys(data.bindings))
          })
          .catch(() => {})
        ctx.effect(() =>
          ctx.slots.inject('sidebar.footer.action', () =>
            ctx.slots.register(
              { name: 'sidebar.footer.action', id: 'codex-sessions', order: 20 },
              () => h(CodexFooterButton, { ctx }),
            ),
          ),
        )
        ctx.effect(() =>
          ctx.slots.inject('sidebar.session.row.leading', () =>
            ctx.slots.register(
              { name: 'sidebar.session.row.leading', id: 'codex-session-icon', order: 20 },
              CodexRowIcon,
            ),
          ),
        )
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'conversation-archive',
              order: 60,
              label: T.title,
            },
            ArchivePage,
          ),
        )
      },
    }
  },
})
