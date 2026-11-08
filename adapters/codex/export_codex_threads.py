#!/usr/bin/env python3
"""把 Codex **未归档**对话导出成 Markdown 档案，供 DSH 侧检索与续写。

数据源（只读，不写 Codex 的库）：
  ~/.codex/state_5.sqlite        threads 表：archived=0 的会话元数据（标题、目录、模型、时间）
  ~/.codex/thread_history_1.sqlite  thread_items 表：按 rollout_ordinal 排序的条目投影

输出：
  ~/.dsh/conversation-archive/conversations/codex/<thread_id>.md  每个会话一份 Markdown
  ~/.dsh/conversation-archive/index.json                          统一索引（schema v1）

索引是通用格式，插件只读它，不认 Codex。新增来源时写一个 adapter 产出同样的结构即可。

设计取舍：
  - 只导出未归档会话（archived=0）。Codex 归档后仍留在 archived_sessions/，按需求排除。
  - 工具输出按字节截断：单条 commandExecution 的 aggregatedOutput 可达数 MB，
    全量导出约 226 MB。截断后保留可读上下文，档案规模可控。
  - reasoning 条目跳过：数量最多（单看未归档集合就有数万条），且对续写无信息价值。
  - 幂等：重跑覆盖同名文件，index.json 全量重建。
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from typing import Any, Dict, List, Optional

CODEX_DIR = os.path.expanduser("~/.codex")
STATE_DB = os.path.join(CODEX_DIR, "state_5.sqlite")
HISTORY_DB = os.path.join(CODEX_DIR, "thread_history_1.sqlite")
OUT_ROOT = os.path.expanduser("~/.dsh/conversation-archive")
SOURCE = "codex"
OUT_DIR = os.path.join(OUT_ROOT, "conversations", SOURCE)

# 单条截断预算（字符）
OUTPUT_HEAD = 1200
OUTPUT_TAIL = 400
ARGS_MAX = 600
DIFF_HEAD = 400

SKIP_TYPES = {"reasoning", "imageView", "sleep", "contextCompaction"}


def _clip(text: str, head: int, tail: int = 0) -> str:
    text = text or ""
    if len(text) <= head + tail + 40:
        return text
    omitted = len(text) - head - tail
    if tail:
        return f"{text[:head]}\n…[省略 {omitted} 字符]…\n{text[-tail:]}"
    return f"{text[:head]}\n…[省略 {omitted} 字符]…"


def _json_clip(value: Any, limit: int = ARGS_MAX) -> str:
    try:
        text = json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        text = str(value)
    return _clip(text, limit)


def _text_blocks(content: Any) -> str:
    """把 userMessage.content 之类的块数组拼成纯文本。"""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: List[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if isinstance(block.get("text"), str):
            parts.append(block["text"])
        elif block.get("type") == "image":
            parts.append("[图片]")
    return "\n".join(p for p in parts if p)


def thread_display_title(thread: Dict[str, Any]) -> str:
    """Codex 里真正展示的名字优先：name → title → 首条用户消息 → preview。"""
    for key in ("name", "title", "first_user_message", "preview"):
        value = (thread.get(key) or "").strip()
        if not value:
            continue
        first = next((line.strip() for line in value.splitlines() if line.strip()), "")
        if not first:
            continue
        return first[:60] + ("…" if len(first) > 60 else "")
    return "(无标题)"


def render_item(item: Dict[str, Any]) -> Optional[str]:
    """把一条 thread_items.item_json 渲染成 Markdown 片段。"""
    kind = item.get("type")
    if kind in SKIP_TYPES:
        return None

    if kind == "userMessage":
        text = _text_blocks(item.get("content")).strip()
        return f"### 用户\n\n{text}\n" if text else None

    if kind == "agentMessage":
        text = (item.get("text") or "").strip()
        return f"### Codex\n\n{text}\n" if text else None

    if kind == "commandExecution":
        command = item.get("command") or ""
        output = item.get("aggregatedOutput") or ""
        status = item.get("status") or ""
        exit_code = item.get("exitCode")
        header = f"### 命令（{status}" + (f"，exit={exit_code}" if exit_code is not None else "") + "）"
        body = f"```sh\n{_clip(command, 800)}\n```"
        if output.strip():
            body += f"\n\n```\n{_clip(output, OUTPUT_HEAD, OUTPUT_TAIL)}\n```"
        return f"{header}\n\n{body}\n"

    if kind == "fileChange":
        changes = item.get("changes") or []
        lines = []
        for change in changes[:20]:
            if not isinstance(change, dict):
                continue
            path = change.get("path") or ""
            ctype = (change.get("kind") or {}).get("type") if isinstance(change.get("kind"), dict) else ""
            lines.append(f"- `{path}`（{ctype or 'change'}）")
            diff = change.get("diff") or ""
            if diff:
                lines.append("```diff\n" + _clip(diff, DIFF_HEAD) + "\n```")
        if not lines:
            return None
        return "### 文件改动\n\n" + "\n".join(lines) + "\n"

    if kind == "webSearch":
        query = item.get("query") or ""
        action = item.get("action") or {}
        url = action.get("url") if isinstance(action, dict) else None
        suffix = f"\n\n{url}" if url else ""
        return f"### 联网搜索\n\n{_clip(query, 400)}{suffix}\n"

    if kind == "mcpToolCall":
        server = item.get("server") or "?"
        tool = item.get("tool") or "?"
        args = _json_clip(item.get("arguments"))
        result = item.get("result")
        body = f"### MCP 工具 `{server}.{tool}`\n\n参数：`{args}`\n"
        if isinstance(result, (dict, list)):
            body += f"\n结果：\n```json\n{_json_clip(result, OUTPUT_HEAD)}\n```\n"
        elif isinstance(result, str) and result.strip():
            body += f"\n结果：\n```\n{_clip(result, OUTPUT_HEAD, OUTPUT_TAIL)}\n```\n"
        error = item.get("error")
        if error:
            body += f"\n错误：`{_json_clip(error, 300)}`\n"
        return body

    if kind == "dynamicToolCall":
        namespace = item.get("namespace") or "?"
        tool = item.get("tool") or "?"
        args = _json_clip(item.get("arguments"))
        body = f"### 工具 `{namespace}.{tool}`\n\n参数：`{args}`\n"
        texts = []
        for block in item.get("contentItems") or []:
            if isinstance(block, dict) and isinstance(block.get("text"), str):
                texts.append(block["text"])
        if texts:
            body += f"\n结果：\n```\n{_clip(chr(10).join(texts), OUTPUT_HEAD, OUTPUT_TAIL)}\n```\n"
        return body

    if kind in ("subAgentActivity", "collabAgentToolCall"):
        tool = item.get("tool") or item.get("kind") or "subagent"
        target = item.get("agentThreadId") or ",".join(item.get("receiverThreadIds") or [])
        return f"### 子代理 `{tool}`\n\n目标：`{target}`\n"

    if kind == "plan":
        return f"### 计划\n\n{_json_clip(item, 800)}\n"

    if kind == "contextCompaction":
        return "### （上下文压缩点）\n"

    # 其它类型保留一行摘要，便于追溯
    return f"### {kind}\n\n```json\n{_json_clip(item, 300)}\n```\n"


def export_thread(con: sqlite3.Connection, thread: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = con.execute(
        "select item_json from thread_items where thread_id = ? "
        "order by rollout_ordinal asc, created_at_ms asc",
        (thread["id"],),
    ).fetchall()

    parts: List[str] = []
    for (raw,) in rows:
        try:
            item = json.loads(raw)
        except (TypeError, ValueError):
            continue
        chunk = render_item(item)
        if chunk:
            parts.append(chunk)

    if not parts:
        return None

    created = thread.get("created_at_ms") or 0
    updated = thread.get("updated_at_ms") or 0
    title = thread_display_title(thread)
    project = (thread.get("project") or "").strip()
    header = [
        f"# {title}",
        "",
        f"- thread id: `{thread['id']}`",
        f"- 项目: {project or '-'}",
        f"- 工作目录: `{thread.get('cwd') or '-'}`",
        f"- 模型: `{thread.get('model') or '-'}`（provider: `{thread.get('model_provider') or '-'}`）",
        f"- 创建: {time.strftime('%Y-%m-%d %H:%M', time.localtime(created / 1000)) if created else '-'}",
        f"- 最后更新: {time.strftime('%Y-%m-%d %H:%M', time.localtime(updated / 1000)) if updated else '-'}",
        "",
        "---",
        "",
    ]
    body = "\n".join(header) + "\n".join(parts)
    path = os.path.join(OUT_DIR, f"{thread['id']}.md")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(body)

    return {
        "id": thread["id"],
        "source": SOURCE,
        "title": title,
        "project": project,
        "project_basis": thread.get("project_basis") or "none",
        "thread_source": thread.get("thread_source") or "user",
        "cwd": thread.get("cwd") or "",
        "model": thread.get("model") or "",
        "created_at_ms": created,
        "updated_at_ms": updated,
        "items": len(rows),
        "chars": len(body),
        "path": os.path.relpath(path, OUT_ROOT),
    }


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    state = sqlite3.connect(f"file:{STATE_DB}?mode=ro", uri=True)
    state.row_factory = sqlite3.Row
    project_roots: List[Dict[str, str]] = []
    try:
        for row in state.execute(
            "select r.project_id as project_id, r.path as path, coalesce(p.name, '') as name "
            "from project_roots r left join projects p on p.id = r.project_id "
            "order by length(r.path) desc"
        ):
            root = str(row["path"] or "").strip()
            name = str(row["name"] or "").strip()
            if root and name:
                project_roots.append({"path": root.rstrip("/"), "name": name})
    except sqlite3.Error:
        pass

    all_paths = [root["path"] for root in project_roots]

    def is_generic(root: str) -> bool:
        # 同时是别的项目根目录的祖先（如 /Users/syc/Desktop），只当容器不当项目名。
        return any(other != root and other.startswith(root + "/") for other in all_paths)

    specific_roots = [root for root in project_roots if not is_generic(root["path"])]

    def project_of(cwd: str) -> tuple[str, str]:
        """返回 (项目名, 依据)：dir=目录边界匹配；ambiguous=同目录多个项目；none=未匹配。"""
        target = str(cwd or "").strip().rstrip("/")
        if not target:
            return ("", "none")
        matches = []
        for root in specific_roots:
            base = root["path"]
            if target == base or target.startswith(base + "/"):
                matches.append(root)
        if not matches:
            return ("", "none")
        longest = max(len(root["path"]) for root in matches)
        winners = [root for root in matches if len(root["path"]) == longest]
        names = {root["name"] for root in winners}
        if len(names) > 1:
            return ("", "ambiguous")
        return (winners[0]["name"], "dir")

    threads = []
    for row in state.execute(
        "select id, title, name, first_user_message, preview, cwd, model, model_provider, "
        "created_at_ms, updated_at_ms, project_id, coalesce(thread_source, '') as thread_source "
        "from threads where archived = 0 "
        "and coalesce(thread_source, 'user') not in ('subagent', 'guardian_review') "
        "order by updated_at_ms desc"
    ):
        thread = dict(row)
        project, project_basis = project_of(thread.get("cwd") or "")
        thread["project"] = project
        thread["project_basis"] = project_basis
        threads.append(thread)
    state.close()

    history = sqlite3.connect(f"file:{HISTORY_DB}?mode=ro", uri=True)
    index: List[Dict[str, Any]] = []
    skipped = 0
    for thread in threads:
        entry = export_thread(history, thread)
        if entry is None:
            skipped += 1
            continue
        index.append(entry)
    history.close()

    index_path = os.path.join(OUT_ROOT, "index.json")
    merged = {}
    if os.path.exists(index_path):
        try:
            previous = json.load(open(index_path, encoding="utf-8"))
            if previous.get("version") == 1:
                for entry in previous.get("conversations", []):
                    if entry.get("source") != SOURCE:
                        merged[(entry.get("source"), entry.get("id"))] = entry
        except (OSError, ValueError):
            pass
    for entry in index:
        merged[(SOURCE, entry["id"])] = entry

    conversations = sorted(
        merged.values(),
        key=lambda e: e.get("updated_at_ms") or 0,
        reverse=True,
    )
    with open(index_path, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "version": 1,
                "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "sources": sorted({e.get("source") for e in conversations}),
                "count": len(conversations),
                "conversations": conversations,
            },
            handle,
            ensure_ascii=False,
            indent=2,
        )

    with open(os.path.join(OUT_ROOT, "README.md"), "w", encoding="utf-8") as handle:
        handle.write(
            "# 对话档案（conversation-archive）\n\n"
            "统一档案根，供 `conversation-archive` 插件检索与读取。\n\n"
            "## 来源：codex（未归档会话）\n\n"
            f"生成时间：{time.strftime('%Y-%m-%d %H:%M:%S')}\n\n"
            f"会话数：{len(index)}（跳过无内容 {skipped} 个）\n\n"
            "每个会话一份 Markdown，位于 `conversations/codex/<thread_id>.md`；元数据在 `index.json`。\n\n"
            "只包含 Codex 中 `archived = 0` 的会话。重新生成：\n\n"
            "```sh\npython3 export_codex_threads.py\n```\n\n"
            "新增来源：另写 adapter 产出 `conversations/<source>/<id>.md`，\n"
            "并在 `index.json` 的 `conversations` 里追加同结构条目（`source` 字段区分来源）。\n"
        )

    total_chars = sum(t["chars"] for t in index)
    print(f"导出 {len(index)} 个会话（跳过 {skipped}），总 {total_chars/1e6:.1f} MB 文本")
    print(f"输出目录：{OUT_DIR}")


if __name__ == "__main__":
    main()
