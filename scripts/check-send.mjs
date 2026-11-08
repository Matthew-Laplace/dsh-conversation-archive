import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runLiveSend,
  buildCodexInvocation,
  parseQueueOutput,
} from '../index.js'

const THREAD = '01a1a4c3-7047-7351-924c-0870749c0526'

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-conv-archive-'))
  mkdirSync(join(root, 'conversations', 'codex'), { recursive: true })
  writeFileSync(
    join(root, 'index.json'),
    JSON.stringify({
      version: 1,
      sources: ['codex'],
      conversations: [
        {
          id: THREAD,
          source: 'codex',
          title: '天有四时',
          cwd: '/tmp',
          model: 'gpt-6-astra',
          updated_at_ms: 1,
          created_at_ms: 1,
          items: 1,
          chars: 10,
          path: 'conversations/codex/thread.md',
        },
      ],
    }),
  )
  writeFileSync(join(root, 'conversations', 'codex', 'thread.md'), '# thread\n')
  return root
}

function fakeExec({ appRunning = true, queue, resume } = {}) {
  const calls = []
  const fn = async (command, args) => {
    calls.push({ command, args })
    if (command === 'pgrep') return { ok: true, stdout: appRunning ? '123\n' : '', stderr: '' }
    if (command === 'sqlite3') return { ok: true, stdout: 'gpt-6-astra|0\n', stderr: '' }
    if (Array.isArray(args) && args[0] === 'queue') {
      return queue ?? { ok: true, stdout: `Queued message msg-1 for thread ${THREAD}\n`, stderr: '' }
    }
    if (Array.isArray(args) && args[0] === 'exec') {
      return resume ?? { ok: true, stdout: 'assistant: THREAD-OK\n', stderr: '' }
    }
    return { ok: false, error: `unexpected command ${command}`, stdout: '', stderr: '' }
  }
  fn.calls = calls
  return fn
}

test('buildCodexInvocation: queue uses queue subcommand', () => {
  const inv = buildCodexInvocation({ cli: '/x/codex', mode: 'queue', id: THREAD, message: 'hi' })
  assert.equal(inv.command, '/x/codex')
  assert.deepEqual(inv.args, ['queue', '--thread', THREAD, '--message', 'hi'])
})

test('buildCodexInvocation: resume carries model and message', () => {
  const inv = buildCodexInvocation({
    cli: '/x/codex',
    mode: 'resume',
    id: THREAD,
    message: 'hi',
    model: 'deepseek-flash',
  })
  assert.deepEqual(inv.args, [
    'exec',
    'resume',
    THREAD,
    '-m',
    'deepseek-flash',
    '-c',
    'sandbox_mode="read-only"',
    '--skip-git-repo-check',
    'hi',
  ])
})

test('parseQueueOutput parses queued id', () => {
  assert.deepEqual(parseQueueOutput('Queued message abc-1 for thread t-9'), {
    messageId: 'abc-1',
    threadId: 't-9',
  })
  assert.equal(parseQueueOutput('noise'), null)
})

test('auto mode with open app and no model queues', async () => {
  const exec = fakeExec({ appRunning: true })
  const result = await runLiveSend({
    root: makeRoot(),
    ref: THREAD,
    message: 'hello',
    exec,
    threadMeta: async () => ({ model: 'gpt-6-astra', archived: false }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.delivery, 'queue')
  assert.equal(result.queued_message_id, 'msg-1')
  assert.ok(exec.calls.some((call) => call.args[0] === 'queue'))
})

test('auto mode with model resumes and switches model', async () => {
  const exec = fakeExec({ appRunning: true })
  const result = await runLiveSend({
    root: makeRoot(),
    ref: THREAD,
    message: 'hello',
    model: 'deepseek-flash',
    exec,
    threadMeta: async () => ({ model: 'gpt-6-astra', archived: false }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.delivery, 'resume')
  const resumeCall = exec.calls.find((call) => call.args[0] === 'exec')
  assert.ok(resumeCall)
  assert.ok(resumeCall.args.includes('-m'))
  assert.ok(resumeCall.args.includes('deepseek-flash'))
})

test('active writer falls back from resume to queue', async () => {
  const queued = { ok: true, stdout: `Queued message fallback-1 for thread ${THREAD}\n`, stderr: '' }
  const exec = fakeExec({
    appRunning: true,
    resume: {
      ok: false,
      error: 'thread-store conflict: thread already has an active writer',
      stdout: '',
      stderr: '',
    },
    queue: queued,
  })
  const result = await runLiveSend({
    root: makeRoot(),
    ref: THREAD,
    message: 'hello',
    model: 'deepseek-flash',
    exec,
    threadMeta: async () => ({ model: 'gpt-6-astra', archived: false }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.delivery, 'queue')
  assert.equal(result.mode, 'queue')
  assert.equal(result.queued_message_id, 'fallback-1')
})

test('explicit queue failure is reported, not thrown', async () => {
  const exec = fakeExec({
    appRunning: false,
    queue: { ok: false, error: 'app not running', stdout: '', stderr: '' },
  })
  const result = await runLiveSend({
    root: makeRoot(),
    ref: THREAD,
    message: 'hello',
    mode: 'queue',
    exec,
    threadMeta: async () => ({ model: 'gpt-6-astra', archived: false }),
  })
  assert.equal(result.ok, false)
  assert.match(result.hint, /mode=resume/)
})

test('archived thread is rejected', async () => {
  await assert.rejects(
    runLiveSend({
      root: makeRoot(),
      ref: THREAD,
      message: 'hello',
      exec: fakeExec(),
      threadMeta: async () => ({ model: 'gpt-6-astra', archived: true }),
    }),
    /archived/,
  )
})

test('empty message is rejected', async () => {
  await assert.rejects(
    runLiveSend({
      root: makeRoot(),
      ref: THREAD,
      message: '   ',
      exec: fakeExec(),
      threadMeta: async () => ({ model: 'gpt-6-astra', archived: false }),
    }),
    /message is required/,
  )
})

test('unknown ref is rejected', async () => {
  await assert.rejects(
    runLiveSend({
      root: makeRoot(),
      ref: 'no-such-thread',
      message: 'hello',
      exec: fakeExec(),
      threadMeta: async () => ({ model: 'gpt-6-astra', archived: false }),
    }),
    /no archived conversation matches/,
  )
})
