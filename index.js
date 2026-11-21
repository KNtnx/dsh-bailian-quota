/**
 * Host half of the Bailian Token Plan quota bundle.
 *
 * The personal Essential plan's remaining allowance is not reachable with the
 * `sk-sp-` inference key, and there is no documented public endpoint for it.
 * The officially supported route is the Bailian CLI: `bl usage token-plan
 * --output json` authenticates with the console login the user already
 * performed, so this plugin never touches credentials — it only reads that
 * command's JSON and serves it to the browser.
 *
 * Two routes are registered on the Harness web server:
 *   GET  /api/bailian-quota/state    cached snapshot (+ history for the chart)
 *   POST /api/bailian-quota/refresh  force one CLI run now
 *
 * Both answer loopback callers only: the quota is account data, and the
 * browser that talks to this host runs on this machine.
 *
 * @module dsh-bailian-quota
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** The web server service this plugin needs; without it the row stays inactive. */
export const inject = ['webServer']

/** API prefix shared with the Client module. */
const API_PREFIX = '/api/bailian-quota'

/** How long one CLI result stays fresh; a manual refresh bypasses it. */
const CACHE_MS = 60_000

/** CLI per-run ceiling: the console round trip is normally under two seconds. */
const CLI_TIMEOUT_MS = 45_000

/** Points kept for the panel's sparkline (720 ≈ 12 h at one reading a minute). */
const HISTORY_LIMIT = 720

/** Readings closer than this to the previous one are not appended again. */
const HISTORY_MIN_GAP_MS = 55_000

/** A change smaller than this (0.05 percentage points) is noise, not a new point. */
const HISTORY_MIN_DELTA = 0.0005

/**
 * Resolve the `bl` executable.
 *
 * The harness process PATH does not always contain the version-manager shim a
 * login shell uses, so a bare `bl` can fail even though the user just ran it.
 * The environment override wins, then the well-known install locations, then
 * PATH as a last resort.
 *
 * @returns an executable path to spawn.
 */
function resolveBlPath() {
  const override = process.env.DSH_BAILIAN_BL
  if (override !== undefined && override.trim() !== '') return override
  const home = homedir()
  const candidates = [join(home, '.local', 'bin', 'bl'), '/usr/local/bin/bl', '/usr/bin/bl']
  try {
    const versions = join(home, '.local', 'share', 'fnm', 'node-versions')
    for (const version of readdirSync(versions)) {
      candidates.push(join(versions, version, 'installation', 'bin', 'bl'))
    }
  } catch {
    // No fnm installation: the remaining candidates decide.
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return 'bl'
}

/** Directory holding this plugin's own state; never the profile's config. */
function stateDir() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'bailian-quota')
}

/** @returns the retained sparkline points, or [] when absent or unreadable. */
function readHistory() {
  try {
    const parsed = JSON.parse(readFileSync(join(stateDir(), 'history.json'), 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((point) => typeof point?.t === 'number' && typeof point?.pct === 'number').slice(-HISTORY_LIMIT)
  } catch {
    return []
  }
}

/**
 * Persist the sparkline atomically so a crash mid-write cannot truncate it.
 * @param points - retained points.
 */
function writeHistory(points) {
  try {
    mkdirSync(stateDir(), { recursive: true })
    const target = join(stateDir(), 'history.json')
    const temp = `${target}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(points))
    renameSync(temp, target)
  } catch {
    // History is a nicety; a failed write never fails the request.
  }
}

/**
 * Run `bl usage token-plan --output json` once.
 * @returns the parsed quota fields.
 */
function runBl() {
  const bin = resolveBlPath()
  const args = ['usage', 'token-plan', '--output', 'json']
  const env = { ...process.env, PATH: `${dirname(bin)}:${process.env.PATH ?? ''}` }
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: CLI_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env, windowsHide: true }, (error, stdout, stderr) => {
      if (error !== null) {
        const detail = String(stderr ?? '').trim().slice(0, 300)
        reject(new Error(detail === '' ? `bl CLI 调用失败：${error.message}` : `bl CLI 调用失败：${detail}`))
        return
      }
      let parsed
      try {
        parsed = JSON.parse(stdout)
      } catch {
        reject(new Error(`bl CLI 输出不是合法 JSON：${String(stdout).slice(0, 200)}`))
        return
      }
      const used = Number(parsed?.per1MonthPercentage)
      if (!Number.isFinite(used)) {
        reject(new Error('bl CLI 输出里没有 per1MonthPercentage，套餐可能不是 Token Plan'))
        return
      }
      const reset = Number(parsed?.per1MonthResetTime)
      resolve({
        /** Fraction of the monthly allowance already spent, 0..1 (may exceed 1 when over budget). */
        usedFraction: used,
        /** Epoch milliseconds of the subscription-month reset, when reported. */
        resetAt: Number.isFinite(reset) && reset > 0 ? reset : null,
        /** False when the console answered without quota rows. */
        hasQuotaData: parsed?.hasQuotaData !== false,
      })
    })
  })
}

/* ------------------------------------------------------------------ */
/* Local token accounting                                             */
/* ------------------------------------------------------------------ */

/**
 * Plan traffic is counted from this machine's own session logs.
 *
 * The console's token figures belong to the Token Plan product and the CLI
 * cannot read them; `bl usage stats` reports the pay-as-you-go workspace
 * instead. So the card shows what this machine actually spent on the plan,
 * replayed from the harness's zstd-packed session logs at request time. The
 * replay is stateless: no counter to drift and nothing to double count when
 * the host restarts. Per-file buckets are cached by day so a date window can
 * be answered without decompressing an unchanged log again.
 */
const local = {
  /** Cached summaries keyed by `from|to`. */
  cache: new Map(),
  /** In-flight replays keyed by `from|to`. */
  inflight: new Map(),
  /** Per-file totals: { [path]: { mtimeMs, days: { 'YYYY-MM-DD': { 'provider/model': { tokens, calls } } } } }. */
  files: {},
  /** True once `files` was loaded from disk. */
  loaded: false,
}

/** A replay is trusted this long before the logs are stat'd again. */
const LOCAL_TTL_MS = 60_000

/** Providers counted as the Token Plan; the pi-ai route ids start this way. */
const PLAN_PROVIDER_PATTERN = /^qwen-token-plan/

/**
 * Local day key at a given instant.
 * @param now - epoch milliseconds.
 */
function localDayKey(now) {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Path of the per-file replay cache. */
function localCachePath() {
  return join(stateDir(), 'local-replay.json')
}

/** Load the per-file cache, tolerating absence and corruption. */
function readLocalCache() {
  if (local.loaded) return
  local.loaded = true
  try {
    const parsed = JSON.parse(readFileSync(localCachePath(), 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && parsed.files !== null && typeof parsed.files === 'object') {
      local.files = parsed.files
    }
  } catch {
    // First run or an unreadable cache: replay everything once.
  }
}

/** Persist the per-file cache atomically. */
function writeLocalCache() {
  try {
    mkdirSync(stateDir(), { recursive: true })
    const target = localCachePath()
    const temp = `${target}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify({ files: local.files }))
    renameSync(temp, target)
  } catch {
    // A failed cache write only costs a slower next replay.
  }
}

/**
 * Newest mtime across the profile's session logs.
 *
 * The replay itself is cached, but a call that just finished only shows up
 * once its log line is on disk. Statting the logs is cheap (no decompression),
 * so every read compares this stamp and recomputes when the logs moved.
 */
function sessionStamp() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const root = join(home, 'sessions')
  let newest = 0
  const walk = (dir, depth) => {
    if (depth > 3) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (entry.name !== 'session.v4.jsonl.zstd') continue
      try {
        const stat = statSync(full)
        if (stat.mtimeMs > newest) newest = stat.mtimeMs
      } catch {
        // A file that vanished mid-walk simply does not contribute.
      }
    }
  }
  walk(root, 0)
  return newest
}

/**
 * Replay the profile's session logs into per-day buckets.
 * @param fromMs - inclusive lower bound.
 * @param toMs - inclusive upper bound.
 */
async function replayLocalUsage(fromMs, toMs) {
  readLocalCache()
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const root = join(home, 'sessions')
  const files = []
  const walk = (dir, depth) => {
    if (depth > 3) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.name === 'session.v4.jsonl.zstd') files.push(full)
    }
  }
  walk(root, 0)

  let cacheChanged = false
  for (const file of files) {
    let stat
    try {
      stat = statSync(file)
    } catch {
      continue
    }
    if (stat.mtimeMs < fromMs) continue
    const cached = local.files[file]
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs) continue
    let text
    try {
      text = await new Promise((resolve, reject) => {
        execFile('zstd', ['-dc', file], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
          if (error !== null) reject(error)
          else resolve(stdout)
        })
      })
    } catch {
      continue
    }
    const days = {}
    let route
    for (const line of String(text).split('\n')) {
      if (line === '') continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      if (record.type === 'request/header' || record.type === 'request/context') {
        const header = record.type === 'request/header' ? record.data?.header?.config : record.data
        if (typeof header?.provider === 'string') route = { provider: header.provider, model: header.model ?? '' }
        continue
      }
      if (record.type !== 'assistant/message' || route === undefined) continue
      const usage = record.data?.usage
      if (usage === undefined || usage === null) continue
      if (!PLAN_PROVIDER_PATTERN.test(route.provider)) continue
      const at = typeof record.time === 'number' ? record.time : stat.mtimeMs
      const day = localDayKey(at)
      const key = `${route.provider}/${route.model || 'unknown'}`
      days[day] ??= {}
      const bucket = days[day][key] ?? { tokens: 0, calls: 0, input: 0, cacheRead: 0, output: 0 }
      const input = Number(usage.inputTokens) || 0
      const cacheRead = Number(usage.cacheReadTokens) || 0
      const output = Number(usage.outputTokens) || 0
      bucket.input += input
      bucket.cacheRead += cacheRead
      bucket.output += output
      bucket.tokens += input + cacheRead + output + (Number(usage.cacheWriteTokens) || 0)
      bucket.calls += 1
      days[day][key] = bucket
    }
    local.files[file] = { mtimeMs: stat.mtimeMs, days }
    cacheChanged = true
  }
  if (cacheChanged) writeLocalCache()
  return local.files
}

/**
 * Total the replayed buckets over a date range, per day and per provider.
 * @param fromMs - inclusive lower bound.
 * @param toMs - inclusive upper bound.
 */
async function summarizeRange(fromMs, toMs, selectedModels) {
  const files = await replayLocalUsage(fromMs, toMs)
  const wanted = new Set()
  for (let cursor = fromMs; cursor <= toMs; cursor += 86_400_000) wanted.add(localDayKey(cursor))

  // day → model → bucket, so a selection can be summed after the fact.
  const perDay = new Map()
  const modelTotals = new Map()
  const byProvider = new Map()
  for (const entry of Object.values(files)) {
    for (const [day, buckets] of Object.entries(entry.days ?? {})) {
      if (!wanted.has(day)) continue
      const dayBucket = perDay.get(day) ?? new Map()
      for (const [key, bucket] of Object.entries(buckets)) {
        const slash = key.indexOf('/')
        const provider = slash === -1 ? key : key.slice(0, slash)
        const model = slash === -1 ? 'unknown' : key.slice(slash + 1)
        if (!PLAN_PROVIDER_PATTERN.test(provider)) continue
        const cell = dayBucket.get(model) ?? { tokens: 0, calls: 0, input: 0, cacheRead: 0, output: 0 }
        cell.tokens += bucket.tokens
        cell.calls += bucket.calls
        cell.input += bucket.input ?? 0
        cell.cacheRead += bucket.cacheRead ?? 0
        cell.output += bucket.output ?? 0
        dayBucket.set(model, cell)

        const total = modelTotals.get(model) ?? { model, tokens: 0, calls: 0 }
        total.tokens += bucket.tokens
        total.calls += bucket.calls
        modelTotals.set(model, total)

        const providerRow = byProvider.get(provider) ?? { provider, tokens: 0, calls: 0 }
        providerRow.tokens += bucket.tokens
        providerRow.calls += bucket.calls
        byProvider.set(provider, providerRow)
      }
      perDay.set(day, dayBucket)
    }
  }

  const allModels = [...modelTotals.values()].sort((left, right) => right.tokens - left.tokens)
  const known = new Set(allModels.map((row) => row.model))
  // An unknown name in the query would silently blank the chart; fall back to
  // everything instead.
  const active = Array.isArray(selectedModels) && selectedModels.length > 0
    ? selectedModels.filter((model) => known.has(model))
    : []
  const activeSet = new Set(active)
  const isAll = activeSet.size === 0

  const series = []
  let totalTokens = 0
  let calls = 0
  for (const day of [...wanted].sort()) {
    const cellMap = perDay.get(day)
    const row = { date: day, tokens: 0, calls: 0, input: 0, cacheRead: 0, output: 0 }
    if (cellMap !== undefined) {
      for (const [model, cell] of cellMap) {
        if (!isAll && !activeSet.has(model)) continue
        row.tokens += cell.tokens
        row.calls += cell.calls
        row.input += cell.input
        row.cacheRead += cell.cacheRead
        row.output += cell.output
      }
    }
    totalTokens += row.tokens
    calls += row.calls
    series.push(row)
  }

  return {
    from: localDayKey(fromMs),
    to: localDayKey(toMs),
    days: Math.max(1, Math.round((toMs - fromMs) / 86_400_000) + 1),
    totalTokens,
    calls,
    models: isAll ? allModels.length : activeSet.size,
    selected: isAll ? [] : active,
    allModels,
    byProvider: [...byProvider.values()].sort((left, right) => right.tokens - left.tokens).slice(0, 4),
    series,
  }
}

/**
 * Cached range summary.
 * @param force - rescan even inside the cache window.
 * @param fromMs - inclusive lower bound.
 * @param toMs - inclusive upper bound.
 */
function localSummary(force, fromMs, toMs, selectedModels) {
  const key = `${fromMs}|${toMs}|${(selectedModels ?? []).join(',')}`
  const stamp = sessionStamp()
  const cached = local.cache.get(key)
  // A newer log line beats the TTL: the card should not sit on a stale model
  // list for a minute after a call completed.
  const fresh = cached !== undefined && cached.stamp === stamp && Date.now() - cached.at < LOCAL_TTL_MS
  if (!force && fresh) return Promise.resolve(cached.value)
  const running = local.inflight.get(key)
  if (running !== undefined) return running
  const started = summarizeRange(fromMs, toMs, selectedModels)
    .then((value) => {
      local.cache.set(key, { at: Date.now(), stamp: sessionStamp(), value })
      return value
    })
    .catch(() => ({ from: localDayKey(fromMs), to: localDayKey(toMs), days: 1, totalTokens: 0, calls: 0, models: 0, allModels: [], byProvider: [], series: [] }))
    .finally(() => {
      local.inflight.delete(key)
    })
  local.inflight.set(key, started)
  return started
}

/**
 * Build the token-level detail for a date range.
 * @param force - rescan instead of using the cached replay.
 * @param fromMs - inclusive lower bound.
 * @param toMs - inclusive upper bound.
 */
async function readDetail(force, fromMs, toMs, selectedModels) {
  const summary = await localSummary(force, fromMs, toMs, selectedModels)
  detail.at = Date.now()
  detail.error = null
  detail.data = { local: summary }
}

/** Cached snapshot plus the in-flight run, so a burst of callers shares one CLI run. */
const snapshot = {
  /** Epoch milliseconds of the last successful run, 0 when never. */
  updatedAt: 0,
  /** Last successful reading, or null. */
  data: null,
  /** Last failure message, cleared by the next success. */
  error: null,
  /** Points for the sparkline. */
  history: readHistory(),
}

/** The CLI run currently in flight, if any. */
let inflight

/**
 * Token-level detail folded from this machine's own session events. It costs
 * no network round trip, but it is kept behind its own route so the monthly
 * percentage stays a single fast CLI read.
 */
const detail = { at: 0, data: null, error: null }

/**
 * Read the quota, reusing the cache unless forced.
 * @param force - bypass the cache (the panel's refresh button).
 */
function readQuota(force) {
  const fresh = snapshot.data !== null && Date.now() - snapshot.updatedAt < CACHE_MS
  if (!force && fresh) return Promise.resolve()
  if (inflight !== undefined) return inflight
  inflight = runBl()
    .then((data) => {
      snapshot.updatedAt = Date.now()
      snapshot.data = data
      snapshot.error = null
      const previous = snapshot.history.at(-1)
      const moved = previous !== undefined && Math.abs(previous.pct - data.usedFraction) >= HISTORY_MIN_DELTA
      if (previous === undefined || snapshot.updatedAt - previous.t >= HISTORY_MIN_GAP_MS || moved) {
        snapshot.history.push({ t: snapshot.updatedAt, pct: data.usedFraction })
        if (snapshot.history.length > HISTORY_LIMIT) snapshot.history.splice(0, snapshot.history.length - HISTORY_LIMIT)
        writeHistory(snapshot.history)
      }
    })
    .catch((error) => {
      snapshot.error = error instanceof Error ? error.message : String(error)
    })
    .finally(() => {
      inflight = undefined
    })
  return inflight
}

/**
 * Whether a request may read account quota: the browser on this machine, or an
 * in-process caller with no socket.
 * @param req - the HTTP request.
 */
function isLoopback(req) {
  const address = req.socket?.remoteAddress
  if (address === undefined || address === '') return true
  return address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
}

/**
 * Write one JSON body.
 * @param res - the response.
 * @param status - HTTP status code.
 * @param body - serialisable body.
 */
function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/** The body both routes return. */
function view() {
  return {
    ok: snapshot.data !== null,
    updatedAt: snapshot.updatedAt,
    stale: snapshot.data !== null && Date.now() - snapshot.updatedAt >= CACHE_MS,
    data: snapshot.data,
    error: snapshot.error,
    history: snapshot.history.slice(-HISTORY_LIMIT),
  }
}

/**
 * GET /detail?days=7 — token figures for the popover. Answered after the two
 * CLI reads finish, because the popover shows a spinner while it waits.
 */
async function detailHandler(req, res) {
  if (!isLoopback(req)) {
    writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
    return
  }
  const dayStart = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const parseDay = (text) => {
    if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined
    const [year, month, day] = text.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    return Number.isFinite(date.getTime()) ? dayStart(date) : undefined
  }
  let toMs = dayStart(new Date())
  let fromMs = toMs - 6 * 86_400_000
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const askedTo = parseDay(url.searchParams.get('to') ?? '')
    const askedFrom = parseDay(url.searchParams.get('from') ?? '')
    if (askedTo !== undefined) toMs = askedTo
    if (askedFrom !== undefined) fromMs = askedFrom
    const days = Number(url.searchParams.get('days'))
    if (askedFrom === undefined && Number.isFinite(days) && days >= 1 && days <= 365) {
      fromMs = toMs - (Math.round(days) - 1) * 86_400_000
    }
  } catch {
    // A malformed query keeps the default week.
  }
  if (fromMs > toMs) [fromMs, toMs] = [toMs, fromMs]
  let selectedModels = []
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const raw = url.searchParams.get('models') ?? ''
    selectedModels = raw.split(',').map((value) => value.trim()).filter((value) => value !== '' && value.length <= 120).slice(0, 12)
  } catch {
    // Keep "all models" on a malformed query.
  }
  await readDetail(req.method === 'POST', fromMs, toMs, selectedModels)
  writeJson(res, 200, {
    ok: detail.data !== null,
    updatedAt: detail.at,
    ...(detail.data ?? {}),
    error: detail.error,
  })
}

/** GET /state — cached reading, refreshed in the background when stale. */
function stateHandler(req, res) {
  if (!isLoopback(req)) {
    writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
    return
  }
  // Answer at once with what is known, then let the stale read catch up; the
  // panel polls, so the next tick shows the fresh number instead of blocking.
  void readQuota(false)
  writeJson(res, 200, view())
}

/** POST /refresh — one forced CLI run, answered when it finishes. */
async function refreshHandler(req, res) {
  if (!isLoopback(req)) {
    writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
    return
  }
  await readQuota(true)
  writeJson(res, 200, view())
}

/**
 * Register the quota routes for this activation.
 * @param ctx - host context carrying the web server.
 */
export function apply(ctx) {
  // Warm the replay cache so the first press opens instantly instead of
  // waiting for the session logs to decompress.
  void localSummary(false, Date.now() - 6 * 86_400_000, Date.now())

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({ kind: 'exact', path: `${API_PREFIX}/state`, handler: stateHandler }),
      ctx.webServer.register({ kind: 'exact', path: `${API_PREFIX}/refresh`, handler: refreshHandler }),
      ctx.webServer.register({ kind: 'exact', path: `${API_PREFIX}/detail`, handler: detailHandler }),
    ]
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // Route fiber already gone during shutdown.
        }
      }
    }
  }, 'bailian-quota: routes')
}