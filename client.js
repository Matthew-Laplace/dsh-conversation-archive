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

    return {
      inject: ['slots'],
      apply(ctx) {
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
