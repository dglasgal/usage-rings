import type { Row } from './report'
import type { Source } from '../types'

// Turning log lines into rows. Only each response's id, time, model and token
// counts are read: never the text. The file walking lives in register.tsx.

export const DAY = 86_400_000
// Long enough to cover "this month" on its last day.
export const KEEP_DAYS = 35
export const MAX_DEPTH = 10
export const SKIP_DIRS = new Set(['node_modules', '.git'])
export const CACHE_KEY = 'scan-cache-v1'
export const JQ_CANDIDATES = ['/usr/bin/jq', '/opt/homebrew/bin/jq', '/usr/local/bin/jq']
export const READ_LIMIT = 4 * 1024 * 1024

// One line per response: [id, time, model, input, output, 5m writes, 1h writes,
// all cache writes, cache reads, speed, routing, working folder]; and one line per
// session name the person gave or Claude Code chose: ["~title", name]. Lines that
// are not JSON, or neither of those, are skipped.
export const JQ_PROGRAM = [
  'fromjson? | select(type == "object")',
  '| if .type == "custom-title" and (.customTitle | type) == "string" then ["~title", .customTitle]',
  'else select((.message | type) == "object")',
  '| .message as $m | select(($m.usage | type) == "object" and ($m.id | type) == "string")',
  '| $m.usage as $u',
  '| [$m.id, .timestamp, $m.model, ($u.input_tokens // 0), ($u.output_tokens // 0),',
  '($u.cache_creation.ephemeral_5m_input_tokens // null), ($u.cache_creation.ephemeral_1h_input_tokens // null),',
  '($u.cache_creation_input_tokens // 0), ($u.cache_read_input_tokens // 0),',
  '($u.speed // ""), ($u.inference_geo // ""), (.cwd // "")] end',
].join(' ')

// What one log file holds: its rows, and the session's name and folder when it says.
export type Parsed = { rows: Row[]; title?: string; cwd?: string }

export type FileCache = Parsed & { sig: string; size: number }
export type Cache = { files: Record<string, FileCache> }
export type Found = { path: string; source: Source; size: number; mtimeMs: number }

// Cowork keeps the person's own output files beside its logs, so there only its
// two log kinds are taken: audit.jsonl and the transcripts under .claude/projects.
export function isLog(source: Source, path: string, name: string): boolean {
  if (!name.endsWith('.jsonl')) return false
  if (source === 'code') return true
  return name === 'audit.jsonl' || path.includes('/.claude/projects/')
}

export function toRow(fields: unknown): Row | undefined {
  if (!Array.isArray(fields) || fields.length < 11) return undefined
  const [id, time, model, input, output, e5, e1, writes, reads, speed, geo] = fields
  const at = typeof time === 'string' ? Date.parse(time) : NaN
  if (typeof id !== 'string' || typeof model !== 'string' || model === '<synthetic>' || Number.isNaN(at)) return undefined
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const all = num(writes)
  const isSplit = e5 !== null || e1 !== null
  let w5 = isSplit ? num(e5) : all
  const w1 = isSplit ? num(e1) : 0
  if (w5 + w1 < all) w5 += all - w5 - w1
  const flags = (speed === 'fast' ? 1 : 0) | (geo === 'us' ? 2 : 0)
  return [id, at, model, num(input), num(output), w5, w1, num(reads), flags]
}

// A log writes each message on several lines; the one with the most output (the
// last streamed) is kept, so the store holds each message once.
export function keepLast(rows: readonly Row[]): Row[] {
  const byId = new Map<string, Row>()
  for (const row of rows) {
    const held = byId.get(row[0])
    if (held === undefined || row[4] >= held[4]) byId.set(row[0], row)
  }
  return [...byId.values()]
}

// Adds jq's output lines to `into`: rows, the newest name, the first folder.
export function parseJqLines(lines: readonly string[], into: Parsed): Parsed {
  for (const line of lines) {
    if (line.trim() === '') continue
    let fields: unknown
    try {
      fields = JSON.parse(line)
    } catch {
      continue // a line cut short
    }
    if (!Array.isArray(fields)) continue
    if (fields[0] === '~title') {
      if (typeof fields[1] === 'string' && fields[1].trim() !== '') into.title = fields[1].trim()
      continue
    }
    const row = toRow(fields)
    if (row === undefined) continue
    into.rows.push(row)
    if (into.cwd === undefined && typeof fields[11] === 'string' && fields[11] !== '') into.cwd = fields[11]
  }
  return into
}

// jq's output lines, as rows alone.
export function rowsFromJqLines(lines: readonly string[]): Row[] {
  return parseJqLines(lines, { rows: [] }).rows
}

// The same extraction in JavaScript, for a computer without jq. Reads whole files,
// so it is limited to the 4 MB a mod may read at once.
export function rowsFromText(text: string): Parsed {
  const parsed: Parsed = { rows: [] }
  const rows = parsed.rows
  for (const line of text.split('\n')) {
    if (line.includes('"custom-title"')) {
      try {
        const o = JSON.parse(line)
        if (o?.type === 'custom-title' && typeof o.customTitle === 'string') parsed.title = o.customTitle.trim()
      } catch {
        // a line cut short
      }
      continue
    }
    if (!line.includes('"usage"')) continue
    let o: any
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    const m = o?.message
    const u = m?.usage
    if (typeof m?.id !== 'string' || u === null || typeof u !== 'object') continue
    const row = toRow([
      m.id,
      o.timestamp,
      m.model,
      u.input_tokens ?? 0,
      u.output_tokens ?? 0,
      u.cache_creation?.ephemeral_5m_input_tokens ?? null,
      u.cache_creation?.ephemeral_1h_input_tokens ?? null,
      u.cache_creation_input_tokens ?? 0,
      u.cache_read_input_tokens ?? 0,
      u.speed ?? '',
      u.inference_geo ?? '',
    ])
    if (row === undefined) continue
    rows.push(row)
    if (parsed.cwd === undefined && typeof o.cwd === 'string' && o.cwd !== '') parsed.cwd = o.cwd
  }
  return parsed
}

// Which session a log belongs to. Claude Code names a transcript after its session
// and keeps its helper agents' transcripts in a folder of that name; Cowork keeps
// each session in a `local_...` folder, both of its logs inside.
export function sessionOf(source: Source, path: string): string {
  if (source === 'cowork') {
    const local = path.match(/\/(local_[^/]+)\//)
    if (local?.[1] !== undefined) return local[1]
  } else {
    const parent = path.match(/\/([^/]+)\/subagents\//)
    if (parent?.[1] !== undefined) return parent[1]
  }
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.replace(/\.jsonl$/, '')
}

// A short name for the folder a session worked in.
export function projectOf(cwd: string | undefined, path: string): string | undefined {
  if (cwd !== undefined && cwd !== '') {
    const parts = cwd.split(/[\\/]/).filter(part => part !== '')
    return parts[parts.length - 1]
  }
  const folder = path.match(/\/projects\/([^/]+)\//)?.[1]
  if (folder === undefined) return undefined
  const afterProjects = folder.split('-Projects-')[1]
  return (afterProjects ?? folder).replace(/-/g, ' ')
}
