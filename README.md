# dsh-conversation-archive

Browse, search, and **take over** conversations that were archived from another coding
agent (Codex today) inside [DeepSeek Harness](https://github.com/deepseek-ai) —
without touching the original client.

## Why

A hosted coding agent can hard-block its composer when the account's usage is exhausted,
even for conversations that a local provider serves
([openai/codex#48816](https://github.com/openai/codex/issues/48816),
[#59175](https://github.com/openai/codex/issues/59175)). That block is client-side and
cannot be configured away. This plugin takes the other path: mirror those conversations
into the Harness and continue the work there.

The original agent keeps its sessions untouched — the export is read-only, one-way.

## What you get

- A **Settings → Conversation archive** page: search, list, read, copy.
- Three agent tools: `conversation_archive_list`, `conversation_archive_read`,
  `conversation_archive_search`.
- A **takeover** tool: `conversation_archive_takeover` resolves a conversation by full id,
  unique id prefix, or title substring, and returns a handoff package (metadata plus the
  tail of the transcript) that the agent continues from.
- **Auto refresh**: when the source database is newer than the archive index, the adapter
  re-runs before the page or tool answers.

## Archive format

The plugin knows nothing about Codex. It reads a directory:

```
~/.dsh/conversation-archive/
  index.json                        # schema version 1
  conversations/<source>/<id>.md    # one Markdown transcript per conversation
```

`index.json`:

```json
{
  "version": 1,
  "generated_at": "2026-11-08 03:18",
  "sources": ["codex"],
  "count": 453,
  "conversations": [
    {
      "id": "01a1aff9-...",
      "source": "codex",
      "title": "注意，严禁防御性写作",
      "cwd": "/Users/me/Desktop",
      "model": "deepseek-flash",
      "created_at_ms": 1794078390089,
      "updated_at_ms": 1794078407924,
      "items": 4155,
      "chars": 2043635,
      "path": "conversations/codex/01a1aff9-....md"
    }
  ]
}
```

Any other tool can join by writing the same shape under a different `source`.

## Install

```sh
dsh plugin install dsh-conversation-archive
```

or through the plugin manager with the package name.

## Configure

```yaml
- insert:
    - id: conversation-archive
      name: dsh-conversation-archive
      config:
        root: ~/.dsh/conversation-archive
        refresh:
          script: ~/.dsh/conversation-archive/adapters/codex/export_codex_threads.py
```

`refresh.script` is optional. Without it the plugin serves whatever is already in `root`.

### Codex adapter

`adapters/codex/export_codex_threads.py` reads `~/.codex/state_5.sqlite`
(`threads.archived = 0`) and `~/.codex/thread_history_1.sqlite`, and writes the archive.
It only reads; it never writes to the Codex databases.

```sh
python3 adapters/codex/export_codex_threads.py
```

Tool output inside a transcript is truncated (head 1200 + tail 400 characters per item) and
`reasoning` items are skipped, which keeps a 226 MB projection down to roughly 35 MB of
readable text.

## HTTP surface

`GET /api/conversation-archive?op=…` with `op=list|read|search`. Same data as the tools.

## License

MIT
