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
- A **send** tool: `conversation_archive_send` sends a message back **into the original
  unarchived Codex thread** through the local Codex CLI, and can switch that thread's model
  before sending. Use it when the Codex desktop composer is blocked (for example by an
  exhausted account) but you still want the turn to land in the original conversation.
- **Auto refresh**: when the source database is newer than the archive index, the adapter
  re-runs before the page or tool answers.

## Send a message back into Codex

Codex CLI has two ways to append a turn to an unarchived thread:

- `codex queue --thread <id> --message <text>` — the thread is open in the Codex app; the
  message goes into the app queue and the app consumes it asynchronously.
- `codex exec resume <id> [-m <model>] "<text>"` — the thread is free; the CLI runs one
  turn and appends it. Pass `-m` to switch the thread's model first.

The plugin exposes both through one tool:

```json
{
  "ref": "天有四时",
  "message": "继续完成最后一项检查",
  "model": "deepseek-flash",
  "mode": "auto"
}
```

- `mode: "auto"` (default): if `model` is given, use `resume` (queue cannot switch models);
  otherwise use `queue` when the Codex app process is running, `resume` when it is not.
- `mode: "queue"` / `"resume"`: force one strategy.
- On `thread-store conflict ... already has an active writer` in auto mode, the tool falls
  back to `queue` and reports which delivery mode was used.

Notes:

- Only **unarchived Codex threads** can be messaged. The tool reads `threads.archived` and
  refuses archived conversations.
- The tool calls the Codex CLI; it never writes Codex's SQLite databases directly.
- If the Codex app is open, `queue` returns quickly and the reply appears when the app
  processes the queue. `resume` blocks until the CLI finishes the turn.
- The CLI path can be overridden with `config.codex.cli` or the `CODEX_CLI` environment
  variable.

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
