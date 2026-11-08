window.__ModuleLoader__.load({
  id: 'dsh-conversation-archive',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const LABELS = {
      zh: {
        title: '对话档案',
        hint: '来自外部编程助手的已归档对话，只读浏览。要接着聊，用左侧「Codex」面板。',
        search: '搜索标题、目录、id',
        empty: '没有匹配的对话。',
        loading: '加载中…',
        chars: '字符',
        copy: '复制全文',
        copied: '已复制',
      },
      en: {
        title: 'Conversation archive',
        hint: 'Conversations archived from external coding agents, read-only. To continue one, use the Codex panel on the left.',
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

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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

    // ---------- 设置 → 对话档案（只读页） ----------
    const baseButton = {
      padding: '5px 10px',
      borderRadius: 6,
      border: '1px solid color-mix(in oklab, currentColor 22%, transparent)',
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      font: 'inherit',
      fontSize: 12,
    }
    const bordered = { border: '1px solid color-mix(in oklab, currentColor 14%, transparent)', borderRadius: 10 }
    const textInput = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '8px 10px',
      borderRadius: 8,
      border: '1px solid color-mix(in oklab, currentColor 20%, transparent)',
      background: 'transparent',
      color: 'inherit',
      fontSize: 13,
      outline: 'none',
      font: 'inherit',
    }
    const mono = {
      margin: 0,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.5,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }
    const styles = {
      root: { display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0', minHeight: 0, flex: 1 },
      hint: { fontSize: 12, opacity: 0.65, margin: 0 },
      search: textInput,
      body: { display: 'flex', gap: 12, minHeight: 0, flex: 1 },
      list: { width: '38%', minWidth: 240, maxHeight: '60vh', overflowY: 'auto', ...bordered },
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
      detail: { flex: 1, minWidth: 0, maxHeight: '60vh', overflow: 'auto', ...bordered, padding: 12 },
      detailHead: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 },
      detailTitle: { fontSize: 14, fontWeight: 600, margin: 0 },
      meta: { fontSize: 11, opacity: 0.6 },
      pre: mono,
      button: { marginLeft: 'auto', ...baseButton, fontSize: 11, padding: '3px 8px' },
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

    // ---------- Codex 图标 ----------
    function CodexMark({ size = 16 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true', style: { flex: '0 0 auto' } },
        h('rect', { x: 2, y: 2, width: 20, height: 20, rx: 5, fill: '#10a37f' }),
        h('path', { d: 'M7 9l3 3-3 3', fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M13 15h4', fill: 'none', stroke: '#fff', strokeWidth: 2, strokeLinecap: 'round' }),
      )
    }

    function dirBasename(cwd) {
      const value = String(cwd ?? '').trim().replace(/[\\/]+$/, '')
      if (!value) return ''
      const parts = value.split(/[\\/]/)
      return parts[parts.length - 1] || ''
    }

    function groupKeyOf(item) {
      const project = String(item?.project || '').trim()
      if (project) return `p:${project}`
      const dir = dirBasename(item?.cwd)
      return dir ? `d:${dir}` : ''
    }

    function renderInline(text, keyPrefix) {
      const nodes = []
      const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\s]+\))/g
      let cursor = 0
      let index = 0
      let match
      while ((match = pattern.exec(text))) {
        if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
        const token = match[0]
        const key = `${keyPrefix}-i${index++}`
        if (token.startsWith('`')) {
          nodes.push(h('code', { key }, token.slice(1, -1)))
        } else if (token.startsWith('**')) {
          nodes.push(h('strong', { key }, token.slice(2, -2)))
        } else if (token.startsWith('*')) {
          nodes.push(h('em', { key }, token.slice(1, -1)))
        } else {
          const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
          nodes.push(
            h('a', { key, href: link?.[2], target: '_blank', rel: 'noreferrer' }, link?.[1] ?? token),
          )
        }
        cursor = match.index + token.length
      }
      if (cursor < text.length) nodes.push(text.slice(cursor))
      return nodes
    }

    function renderMarkdown(text) {
      const source = String(text ?? '')
      if (!source.trim()) return []
      const blocks = []
      let key = 0
      const pushText = (value) => {
        const lines = value.split('\n')
        let index = 0
        while (index < lines.length) {
          const line = lines[index]
          if (!line.trim()) {
            index += 1
            continue
          }
          const heading = /^(#{1,4})\s+(.*)$/.exec(line)
          if (heading) {
            const level = Math.min(4, heading[1].length)
            blocks.push(h(`h${level}`, { key: `b${key++}` }, ...renderInline(heading[2], `h${key}`)))
            index += 1
            continue
          }
          if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
            const ordered = /^\s*\d+[.)]\s+/.test(line)
            const items = []
            while (index < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[index])) {
              items.push(lines[index].replace(/^\s*([-*]|\d+[.)])\s+/, ''))
              index += 1
            }
            blocks.push(
              h(
                ordered ? 'ol' : 'ul',
                { key: `b${key++}` },
                items.map((item, itemIndex) =>
                  h('li', { key: `li${itemIndex}` }, ...renderInline(item, `li${itemIndex}`)),
                ),
              ),
            )
            continue
          }
          if (/^>\s?/.test(line)) {
            const quote = []
            while (index < lines.length && /^>\s?/.test(lines[index])) {
              quote.push(lines[index].replace(/^>\s?/, ''))
              index += 1
            }
            blocks.push(h('blockquote', { key: `b${key++}` }, ...renderInline(quote.join('\n'), 'q')))
            continue
          }
          if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
            blocks.push(h('hr', { key: `b${key++}` }))
            index += 1
            continue
          }
          const paragraph = []
          while (
            index < lines.length &&
            lines[index].trim() &&
            !/^(#{1,4})\s+/.test(lines[index]) &&
            !/^\s*([-*]|\d+[.)])\s+/.test(lines[index]) &&
            !/^>\s?/.test(lines[index])
          ) {
            paragraph.push(lines[index])
            index += 1
          }
          blocks.push(h('p', { key: `b${key++}` }, ...renderInline(paragraph.join('\n'), 'p')))
        }
      }
      const fence = /```([^\n]*)\n?([\s\S]*?)```/g
      let cursor = 0
      let match
      while ((match = fence.exec(source))) {
        if (match.index > cursor) pushText(source.slice(cursor, match.index))
        blocks.push(
          h('pre', { key: `b${key++}` }, h('code', null, match[2].replace(/\n$/, ''))),
        )
        cursor = match.index + match[0].length
      }
      if (cursor < source.length) pushText(source.slice(cursor))
      return blocks
    }

    // ---------- 过程事件（命令/文件/子代理/MCP/搜索…） ----------
    const EVENT_META = {
      command: { icon: '⚙', label: '命令' },
      files: { icon: '📄', label: '文件改动' },
      subagent: { icon: '🤖', label: '子代理' },
      mcp: { icon: '🔧', label: 'MCP' },
      search: { icon: '🔎', label: '搜索' },
      plan: { icon: '🗒', label: '计划' },
      tool: { icon: '🛠', label: '工具' },
      compaction: { icon: '🗜', label: '压缩' },
    }

    function eventMeta(kind) {
      return EVENT_META[kind] ?? { icon: '•', label: String(kind || '事件') }
    }

    function eventSummary(events) {
      const counts = new Map()
      for (const event of events ?? []) {
        const meta = eventMeta(event.kind)
        counts.set(meta.label, (counts.get(meta.label) ?? 0) + 1)
      }
      return [...counts].map(([label, count]) => `${label} ${count}`).join(' · ')
    }

    // ---------- Codex CLI 面板（样式走主题 token） ----------
    const PANEL_ID = 'codex-archive'
    const SETTINGS_KEY = 'dsh-codex-panel-settings'
    const DEFAULT_SETTINGS = {
      turns: 1,
      chars: 4000,
      sandbox: 'inherit',
      model: '',
      reasoningEffort: '',
      language: 'zh',
    }

    const PANEL_CSS = `
.dca-panel{display:flex;gap:12px;padding:12px;box-sizing:border-box;height:100%;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;position:relative}
.dca-panel *{box-sizing:border-box}
.dca-left{width:232px;min-width:206px;display:flex;flex-direction:column;gap:8px;min-height:0;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.dca-center{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;min-height:0}
.dca-right{width:208px;min-width:180px;display:flex;flex-direction:column;gap:8px;min-height:0;overflow-y:auto;padding-right:2px}
.dca-brand{display:flex;align-items:center;gap:8px}
.dca-title{font-size:15px;font-weight:650;margin:0;letter-spacing:.01em}
.dca-sub{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin:0;line-height:1.4}
.dca-spacer{flex:1}
.dca-btn{height:26px;padding:0 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;transition:background .12s ease,color .12s ease,border-color .12s ease}
.dca-btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.dca-btn:disabled{opacity:.45;cursor:default}
.dca-icon-btn{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:14px;transition:background .12s ease,color .12s ease}
.dca-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dca-input{width:100%;height:28px;padding:0 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:inherit;font:inherit;font-size:12px;outline:none;transition:border-color .12s ease,box-shadow .12s ease}
.dca-input:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in oklab,var(--dsw-alias-brand-primary) 20%,transparent)}
.dca-input-row{display:flex;gap:5px}
.dca-list{flex:1;overflow-y:auto;min-height:0;display:flex;flex-direction:column;padding:3px 0;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow-x:hidden}
.dca-group{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:5px;padding:9px 9px 4px;font-size:11px;font-weight:700;letter-spacing:.01em;color:var(--dsw-alias-label-primary);background:color-mix(in oklab,var(--dsw-alias-bg-layer-1) 92%,transparent);backdrop-filter:blur(4px);border-left:2px solid transparent;transition:color .12s ease,border-color .12s ease,background .12s ease}
.dca-group-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dca-group-tag{flex:0 0 auto;font-weight:500;font-size:9px;line-height:1.5;padding:0 4px;border-radius:4px;background:color-mix(in oklab,var(--dsw-alias-label-secondary) 14%,transparent);color:var(--dsw-alias-label-secondary)}
.dca-group-count{flex:0 0 auto;margin-left:auto;font-weight:600;font-size:9.5px;color:var(--dsw-alias-label-secondary)}
.dca-group.active{color:var(--dsw-alias-label-primary);border-left-color:var(--dsw-alias-brand-primary);background:color-mix(in oklab,var(--dsw-alias-brand-primary) 9%,var(--dsw-alias-bg-layer-1))}
.dca-group-items{margin:0 0 2px 9px;padding-left:4px;border-left:1px solid var(--dsw-alias-border-l1)}
.dca-item{display:block;width:calc(100% - 8px);margin:1px 4px;text-align:left;padding:5px 8px;border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer;font:inherit}
.dca-item:hover{background:var(--dsw-alias-bg-layer-2)}
.dca-item.active{background:color-mix(in oklab,var(--dsw-alias-brand-primary) 13%,transparent)}
.dca-item-title{font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dca-item-meta{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dca-head{display:flex;align-items:center;gap:8px;min-height:22px;padding:0 2px}
.dca-chip{font-size:10px;padding:1px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dca-thread-title{font-size:14px;font-weight:600;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dca-thread-meta{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dca-thread{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:2px 4px 2px 2px}
.dca-turn{display:flex;flex-direction:column;gap:6px}
.dca-msg{display:flex;flex-direction:column;gap:4px}
.dca-msg-user{align-items:flex-end}
.dca-user-bubble{max-width:78%;padding:9px 13px;border-radius:18px;border-bottom-right-radius:6px;background:color-mix(in oklab,var(--dsw-alias-brand-primary) 10%,var(--dsw-alias-bg-layer-1));font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.dca-msg-codex{align-items:stretch;padding:2px 2px 0}
.dca-codex-head{display:flex;align-items:center;gap:5px;font-size:10.5px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:2px}
.dca-codex-glyph{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dca-md{font-size:13px;line-height:1.68;color:var(--dsw-alias-label-primary);word-break:break-word}
.dca-md>p{margin:0 0 9px}
.dca-md>p:last-child{margin-bottom:0}
.dca-md h1,.dca-md h2,.dca-md h3,.dca-md h4{margin:12px 0 6px;line-height:1.35;font-weight:650}
.dca-md h1{font-size:17px}.dca-md h2{font-size:15.5px}.dca-md h3{font-size:14px}.dca-md h4{font-size:13px}
.dca-md ul,.dca-md ol{margin:2px 0 9px;padding-left:20px}
.dca-md li{margin:2px 0}
.dca-md hr{border:none;border-top:1px solid var(--dsw-alias-border-l1);margin:10px 0}
.dca-md code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:color-mix(in oklab,var(--dsw-alias-label-secondary) 12%,transparent);border-radius:4px;padding:1px 4px}
.dca-md pre{margin:7px 0;padding:9px 11px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);overflow:auto}
.dca-md pre code{background:none;padding:0;font-size:11px;line-height:1.55}
.dca-md blockquote{margin:7px 0;padding:2px 0 2px 11px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.dca-md a{color:var(--dsw-alias-label-primary);text-decoration:underline;text-underline-offset:2px}
.dca-trunc{font-size:10px;color:var(--dsw-alias-label-secondary);margin-top:4px}
.dca-process{margin-top:2px;border:1px dashed var(--dsw-alias-border-l1);border-radius:10px;padding:5px 8px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dca-process>summary{cursor:pointer;list-style:none;font-weight:600;user-select:none;padding:1px 0}
.dca-process>summary::-webkit-details-marker{display:none}
.dca-process>summary::before{content:'▸';display:inline-block;margin-right:5px;transition:transform .12s ease}
.dca-process[open]>summary::before{transform:rotate(90deg)}
.dca-process[open]>summary{margin-bottom:5px}
.dca-event{border-top:1px solid var(--dsw-alias-border-l1);padding:4px 0}
.dca-event-title{font-size:10.5px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:2px}
.dca-event-body{margin:0;max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;line-height:1.45;color:var(--dsw-alias-label-secondary)}
.dca-sep{font-size:10px;color:var(--dsw-alias-label-secondary);text-align:center;opacity:.55;margin:1px 0}
.dca-loadmore{align-self:center;margin:2px auto 4px;height:24px;padding:0 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
.dca-loadmore:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.dca-loadmore:disabled{opacity:.5;cursor:default}
.dca-composer{display:flex;flex-direction:column;gap:4px;padding:10px 14px 12px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.dca-composer-card{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.05)}
.dca-bar{display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:0 2px 2px}
.dca-select{height:26px;max-width:190px;padding:0 8px;border-radius:999px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;outline:none;cursor:pointer;text-overflow:ellipsis;transition:background .12s ease,color .12s ease}
.dca-select:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dca-select.model{max-width:200px}
.dca-select.effort{max-width:130px}
.dca-textarea{width:100%;min-height:44px;max-height:190px;resize:none;padding:8px 6px 2px;border:none;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:1.6;outline:none}
.dca-textarea::placeholder{color:var(--dsw-alias-label-secondary);opacity:.7}
.dca-textarea:disabled{opacity:.6}
.dca-sendrow{display:flex;align-items:center;gap:6px;padding:0 2px}
.dca-hint{font-size:10px;color:var(--dsw-alias-label-secondary);opacity:.65}
.dca-send{width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:none;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff);font:inherit;font-size:15px;font-weight:700;cursor:pointer;transition:filter .12s ease,opacity .12s ease}
.dca-send:hover{filter:brightness(1.05)}
.dca-send:disabled{opacity:.45;cursor:default}
.dca-stop{background:color-mix(in oklab,var(--dsw-alias-state-error-primary) 18%,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-state-error-primary)}
.dca-btn-ghost{height:26px;padding:0 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
.dca-btn-ghost:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.dca-mic{width:26px;padding:0}
.dca-mic.recording{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:color-mix(in oklab,var(--dsw-alias-state-error-primary) 12%,transparent)}
.dca-error{border:1px solid color-mix(in oklab,var(--dsw-alias-state-error-primary) 38%,transparent);background:color-mix(in oklab,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-state-error-primary);border-radius:9px;padding:7px 9px;font-size:11px;white-space:pre-wrap;word-break:break-word;max-height:120px;overflow:auto}
.dca-info{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.dca-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:8px}
.dca-card-title{margin:0 0 5px;font-size:10.5px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.02em}
.dca-artifact{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;padding:1px 0}
.dca-artifact:hover{color:var(--dsw-alias-label-primary)}
.dca-empty{font-size:10px;color:var(--dsw-alias-label-secondary);opacity:.65}
.dca-settings{position:absolute;top:54px;right:14px;z-index:40;width:252px;display:flex;flex-direction:column;gap:9px;padding:11px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-overlay);box-shadow:0 12px 32px rgba(0,0,0,.32)}
.dca-settings label{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dca-list::-webkit-scrollbar,.dca-thread::-webkit-scrollbar,.dca-right::-webkit-scrollbar{width:8px;height:8px}
.dca-list::-webkit-scrollbar-thumb,.dca-thread::-webkit-scrollbar-thumb,.dca-right::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l1);border-radius:8px}
.dca-list::-webkit-scrollbar-track,.dca-thread::-webkit-scrollbar-track,.dca-right::-webkit-scrollbar-track{background:transparent}
`

    function loadSettings() {
      try {
        const saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || 'null')
        if (saved && typeof saved === 'object') {
          return {
            turns: Math.max(1, Math.min(10, Number(saved.turns) || DEFAULT_SETTINGS.turns)),
            chars: Math.max(200, Math.min(40000, Number(saved.chars) || DEFAULT_SETTINGS.chars)),
            sandbox: typeof saved.sandbox === 'string' ? saved.sandbox : DEFAULT_SETTINGS.sandbox,
            model: typeof saved.model === 'string' ? saved.model : DEFAULT_SETTINGS.model,
            reasoningEffort:
              typeof saved.reasoningEffort === 'string' ? saved.reasoningEffort : DEFAULT_SETTINGS.reasoningEffort,
            language: typeof saved.language === 'string' ? saved.language : DEFAULT_SETTINGS.language,
          }
        }
      } catch {}
      return { ...DEFAULT_SETTINGS }
    }

    function saveSettings(settings) {
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
      } catch {}
    }

    function parseThreadRef(input) {
      const value = String(input ?? '').trim()
      const match = /codex:\/\/threads\/([0-9a-fA-F-]{36})/.exec(value)
      const id = (match ? match[1] : value).trim()
      return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id) ? id : ''
    }

    async function fetchJson(url, options) {
      const response = await fetch(url, options)
      const data = await response.json().catch(() => null)
      if (!data) throw new Error(`接口没有返回 JSON（HTTP ${response.status}）`)
      if (data.error) {
        const prefix = data.code ? `[${data.code}] ` : ''
        const hint = data.hint ? `\n\n提示：${data.hint}` : ''
        throw new Error(`${prefix}${data.error}${hint}`)
      }
      return data
    }

    // ---------- 语音输入：录音 → 16k 单声道 WAV → DSH 语音服务 ----------
    function encodeWavBase64(samples, sampleRate) {
      const buffer = new ArrayBuffer(44 + samples.length * 2)
      const view = new DataView(buffer)
      const writeText = (offset, text) => {
        for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
      }
      writeText(0, 'RIFF')
      view.setUint32(4, 36 + samples.length * 2, true)
      writeText(8, 'WAVE')
      writeText(12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, 1, true)
      view.setUint16(22, 1, true)
      view.setUint32(24, sampleRate, true)
      view.setUint32(28, sampleRate * 2, true)
      view.setUint16(32, 2, true)
      view.setUint16(34, 16, true)
      writeText(36, 'data')
      view.setUint32(40, samples.length * 2, true)
      for (let i = 0; i < samples.length; i += 1) view.setInt16(44 + i * 2, samples[i], true)
      const bytes = new Uint8Array(buffer)
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
      }
      return btoa(binary)
    }

    async function blobToWavBase64(blob, targetRate = 16000) {
      const arrayBuffer = await blob.arrayBuffer()
      const decodeContext = new (window.AudioContext || window.webkitAudioContext)()
      let decoded
      try {
        decoded = await decodeContext.decodeAudioData(arrayBuffer.slice(0))
      } finally {
        decodeContext.close().catch(() => {})
      }
      const channels = Math.max(1, decoded.numberOfChannels)
      const ratio = decoded.sampleRate / targetRate
      const length = Math.max(1, Math.floor(decoded.duration * targetRate))
      const samples = new Int16Array(length)
      const channelData = []
      for (let ch = 0; ch < channels; ch += 1) channelData.push(decoded.getChannelData(ch))
      for (let i = 0; i < length; i += 1) {
        const position = i * ratio
        const left = Math.min(decoded.length - 1, Math.floor(position))
        const right = Math.min(decoded.length - 1, left + 1)
        const fraction = position - left
        let sample = 0
        for (let ch = 0; ch < channels; ch += 1) {
          const data = channelData[ch]
          sample += (data[left] ?? 0) * (1 - fraction) + (data[right] ?? 0) * fraction
        }
        sample /= channels
        const clamped = Math.max(-1, Math.min(1, sample))
        samples[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
      }
      return encodeWavBase64(samples, targetRate)
    }

    function CodexPanel({ speechRef }) {
      const [settings, setSettings] = React.useState(loadSettings)
      const [settingsOpen, setSettingsOpen] = React.useState(false)
      const [threads, setThreads] = React.useState([])
      const [filter, setFilter] = React.useState('')
      const [listLoading, setListLoading] = React.useState(true)
      const [listError, setListError] = React.useState('')
      const [refInput, setRefInput] = React.useState('')
      const [selectedId, setSelectedId] = React.useState('')
      const [recent, setRecent] = React.useState(null)
      const [olderTurns, setOlderTurns] = React.useState([])
      const [hasMoreTurns, setHasMoreTurns] = React.useState(false)
      const [historyLoading, setHistoryLoading] = React.useState(false)
      const [recentLoading, setRecentLoading] = React.useState(false)
      const [recentError, setRecentError] = React.useState('')
      const [draft, setDraft] = React.useState('')
      const [sending, setSending] = React.useState(false)
      const [sendError, setSendError] = React.useState('')
      const [info, setInfo] = React.useState('')
      const [modelCatalog, setModelCatalog] = React.useState({ models: [], reasoningEfforts: [] })
      const [voiceState, setVoiceState] = React.useState('idle')
      const [voiceError, setVoiceError] = React.useState('')
      const [quotaLoading, setQuotaLoading] = React.useState(false)
      const voice = React.useRef({ recorder: null, stream: null, chunks: [], timer: null, catalog: null })
      const pollTimer = React.useRef(null)
      const scrollRef = React.useRef(null)
      const stickRef = React.useRef(true)

      const loadList = React.useCallback(async (withRefresh) => {
        setListLoading(true)
        try {
          const refresh = withRefresh ? '' : '&refresh=0'
          const data = await fetchJson(`/api/conversation-archive?op=list&source=codex&limit=15${refresh}`)
          setThreads(data.conversations ?? [])
          setListError('')
        } catch (error) {
          setListError(String(error?.message ?? error))
        } finally {
          setListLoading(false)
        }
      }, [])

      const fetchRecentData = React.useCallback(
        async (id, options = {}) => {
          const target = String(id ?? '').trim()
          if (!target) return null
          const offset = Math.max(0, Number(options.offset ?? 0))
          const turns = Math.max(1, Number(options.turns ?? settings.turns))
          return await fetchJson(
            `/api/conversation-archive?op=recent&id=${encodeURIComponent(target)}` +
              `&chars=${settings.chars}&turns=${turns}&offset=${offset}`,
          )
        },
        [settings.chars, settings.turns],
      )

      const scrollToBottom = React.useCallback(() => {
        requestAnimationFrame(() => {
          const element = scrollRef.current
          if (element) element.scrollTop = element.scrollHeight
        })
      }, [])

      const loadRecent = React.useCallback(
        async (id, options = {}) => {
          const offset = Math.max(0, Number(options.offset ?? 0))
          setRecentLoading(true)
          try {
            const data = await fetchRecentData(id, options)
            if (offset === 0) {
              const previousLatest = recent?.turns ?? []
              const previousReply = String(previousLatest.at(-1)?.reply?.text ?? '')
              const nextReply = String(data?.turns?.at(-1)?.reply?.text ?? '')
              if (nextReply !== previousReply && olderTurns.length > 0 && previousLatest.length > 0) {
                // 刷新到新回复时，把旧的最新一轮并入已加载历史，避免只剩一轮。
                setOlderTurns((history) => [...history, ...previousLatest])
              } else if (olderTurns.length === 0) {
                setOlderTurns([])
                setHasMoreTurns(Boolean(data?.hasMore))
              }
              setRecent(data)
              if (stickRef.current) scrollToBottom()
            } else {
              setOlderTurns((prev) => [...(data.turns ?? []), ...prev])
              setHasMoreTurns(Boolean(data?.hasMore))
            }
            setRecentError('')
            return data
          } catch (error) {
            // 失败降级：保留上一次的内容，只提示错误，不把面板清空。
            setRecentError(String(error?.message ?? error))
            return null
          } finally {
            setRecentLoading(false)
          }
        },
        [fetchRecentData, scrollToBottom, olderTurns, recent],
      )

      React.useEffect(() => {
        loadList(false)
        fetchJson('/api/conversation-archive?op=models')
          .then((data) => setModelCatalog({ models: data.models ?? [], reasoningEfforts: data.reasoningEfforts ?? [] }))
          .catch(() => {})
        return () => {
          if (pollTimer.current) clearTimeout(pollTimer.current)
          stopVoiceCapture(true)
        }
      }, [loadList])

      const lastReplyText = React.useCallback((data) => {
        const turns = data?.turns ?? []
        if (turns.length === 0) return ''
        return String(turns[turns.length - 1]?.reply?.text ?? '')
      }, [])

      async function waitForReply(threadId, previousReply) {
        if (pollTimer.current) clearTimeout(pollTimer.current)
        const started = Date.now()
        const tick = async () => {
          if (Date.now() - started > 90000) {
            setInfo('等待回复超时：CLI 已发送，但 90 秒内没看到新回复；可以点刷新重试。')
            setSending(false)
            return
          }
          const data = await loadRecent(threadId)
          if (data && lastReplyText(data) !== previousReply) {
            setInfo('')
            setSending(false)
            loadList(false)
            return
          }
          pollTimer.current = setTimeout(tick, 2500)
        }
        pollTimer.current = setTimeout(tick, 1500)
      }

      async function selectThread(id) {
        const target = String(id ?? '').trim()
        if (!target) return
        setSelectedId(target)
        setSendError('')
        setInfo('')
        setDraft('')
        setOlderTurns([])
        stickRef.current = true
        await loadRecent(target)
      }

      function openRef() {
        const id = parseThreadRef(refInput)
        if (!id) {
          setSendError('编号格式不对：请输入 codex://threads/<uuid> 或 36 位 uuid')
          return
        }
        setSendError('')
        selectThread(id)
      }

      async function loadAllEarlier(options = {}) {
        if (!selectedId || historyLoading || !hasMoreTurns) return
        setHistoryLoading(true)
        const element = scrollRef.current
        const beforeHeight = element?.scrollHeight ?? 0
        const beforeTop = element?.scrollTop ?? 0
        try {
          let loaded = (recent?.turns?.length ?? 0) + olderTurns.length
          let more = true
          let collected = []
          while (more) {
            const data = await fetchRecentData(selectedId, { offset: loaded, turns: 100 })
            const turns = data?.turns ?? []
            if (turns.length === 0) {
              more = false
              break
            }
            collected = [...turns, ...collected]
            loaded += turns.length
            more = Boolean(data?.hasMore)
            setOlderTurns((prev) => [...turns, ...prev])
          }
          setHasMoreTurns(false)
          requestAnimationFrame(() => {
            const node = scrollRef.current
            if (!node) return
            node.scrollTop = node.scrollHeight - beforeHeight + beforeTop
          })
        } catch (error) {
          setRecentError(String(error?.message ?? error))
        } finally {
          setHistoryLoading(false)
        }
      }

      function onThreadScroll() {
        const element = scrollRef.current
        if (!element) return
        stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
        if (element.scrollTop < 48 && hasMoreTurns && !historyLoading) loadAllEarlier()
      }

      async function checkQuota() {
        if (quotaLoading) return
        setQuotaLoading(true)
        setSendError('')
        try {
          const data = await fetchJson('/api/conversation-archive?op=quota')
          const text = JSON.stringify(data.rateLimits ?? {})
          setInfo(`额度：${text.length > 600 ? `${text.slice(0, 600)}…` : text}`)
        } catch (error) {
          setSendError(String(error?.message ?? error))
        } finally {
          setQuotaLoading(false)
        }
      }

      async function send() {
        if (sending) return
        if (!selectedId) {
          setSendError('先选一个对话，或粘贴线程编号')
          return
        }
        const text = draft.trim()
        if (!text) {
          setSendError('消息不能为空')
          return
        }
        setSendError('')
        setVoiceError('')
        setInfo('')
        setSending(true)
        stickRef.current = true
        scrollToBottom()
        const previousReply = lastReplyText(recent)
        try {
          const data = await fetchJson('/api/conversation-archive?op=send', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              threadId: selectedId,
              message: text,
              sandbox: settings.sandbox === 'inherit' ? '' : settings.sandbox,
              model: settings.model,
              reasoningEffort: settings.reasoningEffort,
            }),
          })
          setDraft('')
          if (data.mode === 'queue') {
            setInfo('已排队，等 Codex 处理完会自动刷新。')
            waitForReply(selectedId, previousReply)
            return
          }
          setInfo(data.reply ? '已发送，正在刷新对话…' : '已发送，等待回复…')
          const target = String(previousReply)
          const latest = await loadRecent(selectedId)
          if (latest && lastReplyText(latest) !== target) {
            setInfo('')
            setSending(false)
            loadList(false)
            return
          }
          waitForReply(selectedId, target)
        } catch (error) {
          setSendError(String(error?.message ?? error))
          setSending(false)
        }
      }

      async function interrupt() {
        try {
          await fetchJson('/api/conversation-archive?op=interrupt', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
          setInfo('已打断当前回合')
        } catch (error) {
          setSendError(String(error?.message ?? error))
        } finally {
          setSending(false)
        }
      }

      const updateSettings = (patch) => {
        const next = { ...settings, ...patch }
        setSettings(next)
        saveSettings(next)
      }

      // ---------- 语音输入 ----------
      async function ensureSpeechCatalog() {
        if (voice.current.catalog) return voice.current.catalog
        const speech = speechRef?.api
        if (!speech?.catalog) throw new Error('语音输入不可用：DSH 语音插件没有挂载')
        const result = await speech.catalog()
        if (!result || result.ok !== true) {
          throw new Error(result?.error?.message ? `语音服务不可用：${result.error.message}` : '语音服务不可用')
        }
        voice.current.catalog = result.value
        return result.value
      }

      async function stopVoiceCapture(discard) {
        const active = voice.current
        if (!active.recorder) return null
        const recorder = active.recorder
        active.recorder = null
        if (active.timer) clearTimeout(active.timer)
        active.timer = null
        const blobPromise = new Promise((resolve) => {
          recorder.onstop = () => resolve(new Blob(active.chunks, { type: recorder.mimeType || 'audio/webm' }))
        })
        try {
          recorder.stop()
        } catch {}
        const blob = await blobPromise
        for (const track of active.stream?.getTracks?.() ?? []) track.stop()
        active.stream = null
        active.chunks = []
        if (discard) return null
        return blob
      }

      async function toggleVoice() {
        setVoiceError('')
        if (voiceState === 'recording') {
          setVoiceState('transcribing')
          try {
            const blob = await stopVoiceCapture(false)
            if (!blob) throw new Error('没有录到声音')
            const audioBase64 = await blobToWavBase64(blob)
            const catalog = await ensureSpeechCatalog()
            const speech = speechRef?.api
            if (!speech?.transcribe) throw new Error('语音输入不可用：DSH 语音插件没有挂载')
            const result = await speech.transcribe({
              audioBase64,
              providerId: catalog.selection?.providerId,
              language: catalog.selection?.language || settings.language,
            })
            if (!result || result.ok !== true) {
              throw new Error(result?.error?.message ? `转写失败：${result.error.message}` : '转写失败')
            }
            const text = String(result.value?.text ?? '').trim()
            if (!text) throw new Error('没有识别到语音内容')
            setDraft((current) => (current ? `${current}\n${text}` : text))
          } catch (error) {
            setVoiceError(String(error?.message ?? error))
          } finally {
            setVoiceState('idle')
          }
          return
        }
        if (voiceState === 'requesting') return
        setVoiceState('requesting')
        try {
          const catalog = await ensureSpeechCatalog()
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          const recorder = new MediaRecorder(stream)
          voice.current = { ...voice.current, recorder, stream, chunks: [], catalog, timer: null }
          recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) voice.current.chunks.push(event.data)
          }
          recorder.start()
          setVoiceState('recording')
          const limit = Math.min(180, Math.max(5, Number(catalog.maxDurationSeconds) || 60))
          voice.current.timer = setTimeout(() => {
            if (voice.current.recorder) toggleVoice()
          }, limit * 1000)
        } catch (error) {
          setVoiceState('idle')
          setVoiceError(String(error?.message ?? error))
        }
      }

      // 拖拽设置面板：点击空白关闭
      React.useEffect(() => {
        if (!settingsOpen) return
        const close = (event) => {
          if (!event.target?.closest?.('.dca-settings') && !event.target?.closest?.('.dca-settings-btn')) {
            setSettingsOpen(false)
          }
        }
        document.addEventListener('mousedown', close)
        return () => document.removeEventListener('mousedown', close)
      }, [settingsOpen])

      const visibleThreads = filter.trim()
        ? threads.filter((item) => {
            const needle = filter.trim().toLowerCase()
            return [item.title, item.cwd, item.id, item.project].some((value) =>
              String(value ?? '').toLowerCase().includes(needle),
            )
          })
        : threads

      const selectedGroupKey = React.useMemo(() => {
        const item = threads.find((thread) => thread.id === selectedId)
        return item ? groupKeyOf(item) : ''
      }, [threads, selectedId])

      const projectGroups = React.useMemo(() => {
        const map = new Map()
        for (const item of visibleThreads) {
          const project = String(item.project || '').trim()
          const dir = dirBasename(item.cwd)
          const key = project ? `p:${project}` : dir ? `d:${dir}` : ''
          const entry = map.get(key) ?? {
            key,
            label: project || dir || '未分组',
            kind: project ? 'project' : dir ? 'dir' : 'none',
            items: [],
          }
          entry.items.push(item)
          map.set(key, entry)
        }
        const ordered = [...map.values()]
        ordered.sort((left, right) => {
          if (left.kind === 'none') return 1
          if (right.kind === 'none') return -1
          return (right.items[0]?.updated_at_ms ?? 0) - (left.items[0]?.updated_at_ms ?? 0)
        })
        return ordered
      }, [visibleThreads])

      const shownTurns = [...olderTurns, ...(recent?.turns ?? [])]
      const artifacts = recent?.artifacts ?? { subagents: [], files: [], commandCount: 0 }
      const effortOptions = Array.from(
        new Set([
          ...(modelCatalog.reasoningEfforts ?? []),
          ...((modelCatalog.models ?? []).find((item) => item.id === settings.model)?.efforts ?? []),
        ]),
      )

      return h(
        'div',
        { className: 'dca-panel' },
        // -------- 左列 --------
        h(
          'aside',
          { className: 'dca-left' },
          h(
            'div',
            { className: 'dca-brand' },
            h(CodexMark, { size: 18 }),
            h('h2', { className: 'dca-title' }, 'Codex'),
            h('span', { className: 'dca-spacer' }),
            h('button', { type: 'button', className: 'dca-icon-btn', title: '刷新列表', onClick: () => loadList(true) }, '↻'),
          ),
          h('p', { className: 'dca-sub' }, '只调用 Codex CLI，不经过 DSH 模型'),
          h(
            'div',
            { className: 'dca-input-row' },
            h('input', {
              className: 'dca-input',
              placeholder: 'codex://threads/… 或 uuid',
              value: refInput,
              onChange: (event) => setRefInput(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') openRef()
              },
            }),
            h('button', { type: 'button', className: 'dca-btn', onClick: openRef }, '打开'),
          ),
          h('input', {
            className: 'dca-input',
            placeholder: '过滤对话…',
            value: filter,
            onChange: (event) => setFilter(event.target.value),
          }),
          h(
            'div',
            { className: 'dca-list' },
            listError ? h('div', { className: 'dca-error', style: { margin: 6 } }, listError) : null,
            listLoading && visibleThreads.length === 0
              ? h('div', { className: 'dca-empty', style: { padding: 8 } }, '加载中…')
              : visibleThreads.length === 0
                ? h('div', { className: 'dca-empty', style: { padding: 8 } }, '没有匹配的对话')
                : projectGroups.map((group) =>
                    h(
                      'div',
                      { key: `group-${group.key || 'ungrouped'}`, className: 'dca-group-block' },
                      h(
                        'div',
                        {
                          className: `dca-group${selectedId && group.key === selectedGroupKey ? ' active' : ''}`,
                          title:
                            group.kind === 'project'
                              ? '项目依据：Codex project_roots 目录匹配'
                              : group.kind === 'dir'
                                ? '按工作目录归类：Codex 项目注册表里没有明确归属'
                                : '没有可用工作目录，无法归类',
                        },
                        h('span', { className: 'dca-group-name' }, group.label),
                        group.kind === 'dir' ? h('span', { className: 'dca-group-tag' }, '目录') : null,
                        h('span', { className: 'dca-group-count' }, String(group.items.length)),
                      ),
                      h(
                        'div',
                        { className: 'dca-group-items' },
                        group.items.map((item) =>
                          h(
                            'button',
                            {
                              key: item.id,
                              type: 'button',
                              className: `dca-item${selectedId === item.id ? ' active' : ''}`,
                              onClick: () => selectThread(item.id),
                              title:
                                `${item.title || item.id}\n${item.cwd || ''}\n所属：` +
                                (item.project ||
                                  (dirBasename(item.cwd)
                                    ? `目录 ${dirBasename(item.cwd)}（未匹配到 Codex 项目）`
                                    : '未分组')),
                            },
                            h('div', { className: 'dca-item-title' }, item.title || item.id.slice(0, 8)),
                            h('div', { className: 'dca-item-meta' }, formatDate(item.updated_at_ms)),
                          ),
                        ),
                      ),
                    ),
                  ),
          ),
        ),
        // -------- 中列 --------
        h(
          'main',
          { className: 'dca-center' },
          h(
            'div',
            { className: 'dca-head' },
            recent?.project
              ? h(
                  'span',
                  { className: 'dca-chip', title: '项目依据：Codex project_roots 目录匹配' },
                  recent.project,
                )
              : recent && dirBasename(recent.cwd)
                ? h(
                    'span',
                    { className: 'dca-chip', title: '按工作目录归类（Codex 项目注册表里没有明确归属）' },
                    `目录 · ${dirBasename(recent.cwd)}`,
                  )
                : null,
            h('h3', { className: 'dca-thread-title' }, recent?.title || '选择一个 Codex 对话'),
            recent ? h('span', { className: 'dca-thread-meta' }, `${recent.model || '未知模型'} · ${recent.cwd || '-'}`) : null,
            h('span', { className: 'dca-spacer' }),
            recent ? h('span', { className: 'dca-thread-meta' }, `${recent.total_chars} 字符`) : null,
            recent
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'dca-icon-btn',
                    title: '复制 codex://threads/<id>',
                    onClick: () => navigator.clipboard.writeText(`codex://threads/${recent.id}`).catch(() => {}),
                  },
                  '⧉',
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'dca-icon-btn',
                title: '检查 Codex 额度（app-server）',
                disabled: quotaLoading,
                onClick: checkQuota,
              },
              quotaLoading ? '…' : '⚡',
            ),
            h(
              'button',
              { type: 'button', className: 'dca-icon-btn dca-settings-btn', title: '设置', onClick: () => setSettingsOpen((v) => !v) },
              '⚙',
            ),
          ),
          h(
            'div',
            { className: 'dca-thread', ref: scrollRef, onScroll: onThreadScroll },
            !selectedId
              ? h('p', { className: 'dca-thread-meta' }, '左边选一个对话，或在上方粘贴线程编号。')
              : null,
            hasMoreTurns
              ? h(
                  'button',
                  { type: 'button', className: 'dca-loadmore', onClick: loadAllEarlier, disabled: historyLoading },
                  historyLoading ? '加载中…' : '加载全部更早历史',
                )
              : null,
            recentLoading && !recent ? h('p', { className: 'dca-thread-meta' }, '加载中…') : null,
            recentError ? h('div', { className: 'dca-error' }, recentError) : null,
            shownTurns.length === 0 && selectedId && !recentLoading && !recentError
              ? h('p', { className: 'dca-thread-meta' }, '这个线程没有可显示的消息。')
              : null,
            shownTurns.map((turn, index) =>
              h(
                'div',
                { className: 'dca-turn', key: `turn-${index}` },
                index > 0 ? h('div', { className: 'dca-sep' }, '· · ·') : null,
                h(
                  'div',
                  { className: 'dca-msg dca-msg-user' },
                  h(
                    'div',
                    { className: 'dca-user-bubble' },
                    turn.user?.text || '（空）',
                    turn.user?.truncated ? h('div', { className: 'dca-trunc' }, '（已按上限截断）') : null,
                  ),
                ),
                h(
                  'div',
                  { className: 'dca-msg dca-msg-codex' },
                  h(
                    'div',
                    { className: 'dca-codex-head' },
                    h('span', { className: 'dca-codex-glyph' }, '▣'),
                    h('span', null, 'Codex'),
                  ),
                  h(
                    'div',
                    { className: 'dca-md' },
                    ...(turn.reply?.text
                      ? renderMarkdown(turn.reply.text)
                      : [h('p', { key: 'empty-reply' }, '（这一轮还没有回复）')]),
                  ),
                  turn.reply?.truncated ? h('div', { className: 'dca-trunc' }, '（已按上限截断）') : null,
                ),
                turn.events && turn.events.length > 0
                  ? h(
                      'details',
                      { className: 'dca-process' },
                      h('summary', null, `过程（${eventSummary(turn.events)}）`),
                      turn.events.map((event, eventIndex) =>
                        h(
                          'div',
                          { className: 'dca-event', key: `event-${eventIndex}` },
                          h('div', { className: 'dca-event-title' }, `${eventMeta(event.kind).icon} ${event.title}`),
                          h('pre', { className: 'dca-event-body' }, event.detail),
                        ),
                      ),
                    )
                  : null,
              ),
            ),
          ),
          sendError
            ? h(
                'div',
                { className: 'dca-error' },
                h('div', null, sendError),
                draft.trim() && selectedId
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'dca-btn-ghost',
                        style: { marginTop: 6 },
                        onClick: send,
                        disabled: sending,
                      },
                      sending ? '重试中…' : '重试',
                    )
                  : null,
              )
            : null,
          voiceError ? h('div', { className: 'dca-error' }, voiceError) : null,
          info ? h('div', { className: 'dca-info' }, info) : null,
          h(
            'footer',
            { className: 'dca-composer' },
            h(
              'div',
              { className: 'dca-composer-card' },
              h('textarea', {
                className: 'dca-textarea',
                placeholder: selectedId ? '发给这个 Codex 线程…' : '先选择一个对话',
                value: draft,
                disabled: !selectedId,
                onChange: (event) => setDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.nativeEvent?.isComposing || event.keyCode === 229) return
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    send()
                  }
                },
              }),
              h(
                'div',
                { className: 'dca-bar' },
                h(
                  'select',
                  {
                    className: 'dca-select model',
                    value: settings.model,
                    onChange: (event) => updateSettings({ model: event.target.value, reasoningEffort: '' }),
                    title: settings.model || '跟随 Codex 配置',
                  },
                  h('option', { value: '' }, '模型：跟随配置'),
                  ...(modelCatalog.models ?? []).map((item) =>
                    h('option', { key: item.id, value: item.id }, item.name || item.id),
                  ),
                ),
                h(
                  'select',
                  {
                    className: 'dca-select effort',
                    value: settings.reasoningEffort,
                    onChange: (event) => updateSettings({ reasoningEffort: event.target.value }),
                    title: settings.reasoningEffort || '跟随配置',
                  },
                  h('option', { value: '' }, '推理：跟随配置'),
                  ...effortOptions.map((effort) => h('option', { key: effort, value: effort }, effort)),
                ),
                h('button', { type: 'button', className: 'dca-btn-ghost', onClick: () => setSettingsOpen((v) => !v) }, '更多'),
                h('span', { className: 'dca-spacer' }),
                sending
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'dca-send dca-stop',
                        title: '打断这一回合',
                        onClick: interrupt,
                      },
                      '■',
                    )
                  : h(
                      'button',
                      {
                        type: 'button',
                        className: 'dca-send',
                        disabled: !selectedId || !draft.trim(),
                        title: '发送（Enter）',
                        onClick: send,
                      },
                      '↑',
                    ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: `dca-btn-ghost dca-mic${voiceState === 'recording' ? ' recording' : ''}`,
                    title: voiceState === 'recording' ? '停止录音并转写' : '语音输入',
                    onClick: toggleVoice,
                    disabled: voiceState === 'transcribing' || !selectedId,
                  },
                  voiceState === 'recording' ? '●' : voiceState === 'transcribing' ? '…' : '🎙',
                ),
              ),
            ),
            h(
              'div',
              { className: 'dca-sendrow' },
              h(
                'span',
                { className: 'dca-hint' },
                sending ? '发送中… 右侧 ■ 可打断' : 'Enter 发送 · Shift+Enter 换行',
              ),
            ),
          ),
        ),
        // -------- 右列：调用产物 --------
        h(
          'aside',
          { className: 'dca-right' },
          h(
            'div',
            { className: 'dca-card' },
            h('h4', { className: 'dca-card-title' }, `子代理 · ${artifacts.subagents?.length ?? 0}`),
            (artifacts.subagents ?? []).length === 0
              ? h('div', { className: 'dca-empty' }, '无')
              : (artifacts.subagents ?? []).slice(-8).reverse().map((item, index) =>
                  h(
                    'div',
                    { key: `subagent-${index}`, className: 'dca-artifact', title: item.target || item.label },
                    `· ${item.label || '子代理'}${item.target ? ` → ${item.target.slice(0, 10)}` : ''}`,
                  ),
                ),
          ),
          h(
            'div',
            { className: 'dca-card' },
            h('h4', { className: 'dca-card-title' }, `文件 · ${artifacts.files?.length ?? 0}`),
            (artifacts.files ?? []).length === 0
              ? h('div', { className: 'dca-empty' }, '无')
              : (artifacts.files ?? []).slice(-20).reverse().map((item, index) =>
                  h(
                    'div',
                    {
                      key: `file-${index}`,
                      className: 'dca-artifact',
                      title: item.path,
                      onClick: () => navigator.clipboard.writeText(item.path).catch(() => {}),
                    },
                    `· ${item.path.split('/').pop() || item.path}`,
                  ),
                ),
          ),
          h(
            'div',
            { className: 'dca-card' },
            h('h4', { className: 'dca-card-title' }, `命令 · ${artifacts.commandCount ?? 0}`),
            h('div', { className: 'dca-empty' }, artifacts.commandCount ? '可在中列历史里查看' : '无'),
          ),
        ),
        // -------- 设置弹层 --------
        settingsOpen
          ? h(
              'div',
              { className: 'dca-settings' },
              h('div', { style: { fontSize: 12, fontWeight: 600 } }, '面板设置'),
              h(
                'label',
                null,
                '单条字符上限',
                h('input', {
                  className: 'dca-input',
                  type: 'number',
                  min: 200,
                  max: 40000,
                  step: 200,
                  value: settings.chars,
                  onChange: (event) => updateSettings({ chars: Number(event.target.value) || 4000 }),
                }),
              ),
              h(
                'label',
                null,
                'Sandbox（queue 模式忽略）',
                h(
                  'select',
                  {
                    className: 'dca-select',
                    style: { maxWidth: 'none', width: '100%' },
                    value: settings.sandbox,
                    onChange: (event) => updateSettings({ sandbox: event.target.value }),
                  },
                  h('option', { value: 'inherit' }, '跟随 Codex 配置'),
                  h('option', { value: 'read-only' }, 'read-only'),
                  h('option', { value: 'workspace-write' }, 'workspace-write'),
                  h('option', { value: 'danger-full-access' }, 'danger-full-access'),
                ),
              ),
            )
          : null,
      )
    }

    function CodexPanelIcon({ size = 18 }) {
      return h(CodexMark, { size })
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const speechRef = { api: null }
        const Panel = (props) => h(CodexPanel, { ...(props ?? {}), speechRef })
        // 主题样式表：面板只用 DSH 主题 token，跟随明暗主题。
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = 'dsh-conversation-archive'
          style.textContent = PANEL_CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'conversation-archive: panel styles')
        // 语音服务由 DSH 语音插件挂载；可用时启用，缺席时面板其余功能照常工作。
        ctx.inject(['remote', 'remote.speech'], (voiceCtx) => {
          speechRef.api = voiceCtx.remote.speech
          return () => {
            speechRef.api = null
          }
        })
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'conversation-archive', order: 60, label: T.title },
            ArchivePage,
          ),
        )
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel))
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 10, label: () => 'Codex' }, CodexPanelIcon),
        )
      },
    }
  },
})
