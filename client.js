/**
 * Client half of the Bailian Token Plan quota bundle.
 *
 * Two surfaces share one reading and one window choice:
 *   - a pill in the composer tool row that opens a compact card,
 *   - a Settings page with the same figures plus a per-day token chart and the
 *     window picker that both surfaces obey.
 *
 * The monthly percentage comes from the Host's `bl usage token-plan` read; the
 * token figures are the Host's replay of this machine's own session logs.
 *
 * @module dsh-bailian-quota/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-bailian-quota',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    /** Optional: the popover portals to the document so no ancestor clips it. */
    let createPortal
    try {
      createPortal = require('react-dom').createPortal
    } catch {
      createPortal = undefined
    }
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'bl-quota'
    const POLL_MS = 60_000

    const ZH = {
      nav: '百炼额度',
      title: '套餐额度',
      subtitle: '阿里云百炼 · Token Plan 个人版',
      refresh: '刷新',
      refreshing: '刷新中…',
      plan: '套餐',
      planName: 'Token Plan · 个人版',
      used: '已用',
      left: '剩余',
      reset: '重置',
      updated: '更新',
      never: '尚未读取',
      pillLabel: '套餐',
      popHint: '点击外部关闭',
      countdown: '倒计时',
      localTitle: 'Token 用量',
      localBadge: 'DSH 统计',
      totalTokens: '总 token',
      calls: '成功调用',
      modelsCalled: '调用模型数',
      window: '统计窗口',
      windowToday: '今天',
      window7: '近 7 天',
      window30: '近 30 天',
      windowMonth: '本月',
      windowLastMonth: '上月',
      windowCustom: '自定义',
      allModels: '全部模型',
      modelsFilter: '按模型查看',
      from: '开始',
      to: '结束',
      trend: '每日 Token 消耗',
      trendPeak: '峰值',
      tipCached: '输入（命中缓存）',
      tipInput: '输入（未命中缓存）',
      tipOutput: '输出',
      trendEmpty: '这个窗口没有记录到用量',
      detailError: '用量读取失败',
      source: '额度来自 bl CLI；token 为本机 DSH 统计',
      errorTitle: '读取失败',
      errorHint: '确认已执行 bl auth login，且 bl 在 PATH 中；也可以用 DSH_BAILIAN_BL 指定可执行文件。',
      noQuota: '控制台没有返回配额数据，可能这个 key 不属于 Token Plan。',
      failTitle: '读取失败',
      failAuth: 'bl 未登录或登录已过期，请在终端执行 bl auth login',
      failMissing: '找不到 bl 可执行文件，可设置 DSH_BAILIAN_BL 指向它',
      failTimeout: 'bl 响应超时，稍后会自动重试',
      failNetwork: '连不上百炼控制台，检查网络或代理',
      failOutput: 'bl 输出异常，可能版本不匹配',
      failUnknown: 'bl 报错，原因见下方原文',
      failStale: '显示的是最后一次成功读取的数据',
      retry: '重试',
      shortAuth: 'bl 未登录或登录已过期',
      shortMissing: '找不到 bl 可执行文件',
      shortTimeout: 'bl 响应超时',
      shortNetwork: '连不上百炼控制台',
      shortOutput: 'bl 输出异常',
      shortUnknown: 'bl 读取失败',
      dataStopped: '数据停在',
    }

    const EN = {
      nav: 'Bailian quota',
      title: 'Plan allowance',
      subtitle: 'Aliyun Model Studio · Token Plan personal',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      plan: 'Plan',
      planName: 'Token Plan · personal',
      used: 'Used',
      left: 'Left',
      reset: 'Resets',
      updated: 'Updated',
      never: 'Not read yet',
      pillLabel: 'Plan',
      popHint: 'click outside to close',
      countdown: 'Countdown',
      localTitle: 'Token usage',
      localBadge: 'DSH stats',
      totalTokens: 'Total tokens',
      calls: 'Successful calls',
      modelsCalled: 'Models called',
      window: 'Window',
      windowToday: 'Today',
      window7: 'Last 7 days',
      window30: 'Last 30 days',
      windowMonth: 'This month',
      windowLastMonth: 'Last month',
      windowCustom: 'Custom',
      allModels: 'All models',
      modelsFilter: 'Filter by model',
      from: 'From',
      to: 'To',
      trend: 'Tokens per day',
      trendPeak: 'Peak',
      tipCached: 'Input (cached)',
      tipInput: 'Input (uncached)',
      tipOutput: 'Output',
      trendEmpty: 'No usage recorded in this window',
      detailError: 'Usage read failed',
      source: 'Quota from the bl CLI; tokens counted by DSH on this machine',
      errorTitle: 'Could not read the quota',
      errorHint: 'Make sure bl auth login has run and bl is on PATH, or set DSH_BAILIAN_BL to the executable.',
      noQuota: 'The console returned no quota rows; this key may not belong to a Token Plan.',
      failTitle: 'Read failed',
      failAuth: 'bl is not logged in or the session expired — run bl auth login in a terminal',
      failMissing: 'bl binary not found; set DSH_BAILIAN_BL to its path',
      failTimeout: 'bl timed out; it will retry automatically',
      failNetwork: 'Cannot reach the Bailian console — check network or proxy',
      failOutput: 'Unexpected bl output; the CLI version may have changed',
      failUnknown: 'bl failed; the raw message is below',
      failStale: 'Showing the last successful read',
      retry: 'Retry',
      shortAuth: 'bl is not logged in',
      shortMissing: 'bl binary not found',
      shortTimeout: 'bl timed out',
      shortNetwork: 'console unreachable',
      shortOutput: 'unexpected bl output',
      shortUnknown: 'bl read failed',
      dataStopped: 'data from',
    }

    /** Dictionary used when the slot handed no translator. */
    function fallbackDict() {
      try {
        return String(navigator.language ?? '').toLowerCase().startsWith('zh') ? ZH : EN
      } catch {
        return EN
      }
    }

    /**
     * Bind a translator with a local fallback.
     * @param t - optional locale-bound translator from the slot.
     */
    function useTranslator(t) {
      return useCallback((key) => {
        if (typeof t === 'function') {
          const value = t(key)
          if (typeof value === 'string' && value !== '' && value !== key) return value
        }
        return fallbackDict()[key] ?? key
      }, [t])
    }

    /** `0.0173` → `1.73%`, always two decimals. */
    function percent(fraction) {
      if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return '—'
      const value = fraction * 100
      if (value === 0) return '0.00%'
      if (value < 0.01) return '<0.01%'
      return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
    }

    /** `8897` → `8.9K`, `129510000` → `129.51M`. */
    function tokens(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
      if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
      if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
      return String(Math.round(value))
    }

    /** A local `YYYY-MM-DD HH:mm` stamp. */
    function stamp(milliseconds) {
      if (typeof milliseconds !== 'number' || milliseconds <= 0) return '—'
      try {
        return new Date(milliseconds).toLocaleString(undefined, {
          year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        })
      } catch {
        return '—'
      }
    }

    /** `30 天 5 小时` until a moment. */
    function countdown(target, now) {
      if (typeof target !== 'number' || !Number.isFinite(target)) return '—'
      const delta = target - now
      if (delta <= 0) return '即将重置'
      const minutes = Math.floor(delta / 60_000)
      const days = Math.floor(minutes / 1440)
      const hours = Math.floor((minutes % 1440) / 60)
      if (days > 0) return `${days} 天 ${hours} 小时`
      if (hours > 0) return `${hours} 小时 ${minutes % 60} 分钟`
      return `${Math.max(1, minutes)} 分钟`
    }

    /** Locale key for the short form of a failure classification. */
    const FAILURE_SHORT = {
      auth: 'shortAuth',
      missing: 'shortMissing',
      timeout: 'shortTimeout',
      network: 'shortNetwork',
      output: 'shortOutput',
      unknown: 'shortUnknown',
    }

    /** Locale key for a failure classification. */
    const FAILURE_TEXT = {
      auth: 'failAuth',
      missing: 'failMissing',
      timeout: 'failTimeout',
      network: 'failNetwork',
      output: 'failOutput',
      unknown: 'failUnknown',
    }

    /** Severity of an allowance, used for the dot, bar and figures. */
    function tone(fraction) {
      if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return 'calm'
      if (fraction >= 0.9) return 'over'
      if (fraction >= 0.7) return 'hot'
      if (fraction >= 0.5) return 'warm'
      return 'calm'
    }

    /* ---------------------------------------------------------------- */
    /* Window choice: one setting both surfaces read                      */
    /* ---------------------------------------------------------------- */

    const WINDOW_KEY = 'dsh.bailianQuota.window'
    const WINDOW_EVENT = 'blq:window'

    /** `YYYY-MM-DD` for a Date in local time. */
    function dayKey(date) {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }

    /** Today at local midnight, shifted by `offset` days. */
    function midnight(offset) {
      const now = new Date()
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + (offset ?? 0))
    }

    /** The default window: the last seven days. */
    function defaultWindow() {
      return { preset: '7', from: dayKey(midnight(-6)), to: dayKey(midnight(0)) }
    }

    /** Read the stored choice (window + model filter), falling back on damage. */
    function readWindow() {
      try {
        const parsed = JSON.parse(localStorage.getItem(WINDOW_KEY) ?? 'null')
        if (parsed !== null && typeof parsed === 'object' && typeof parsed.preset === 'string') {
          const models = Array.isArray(parsed.models) ? parsed.models.filter((value) => typeof value === 'string') : []
          if (parsed.preset === 'custom') {
            if (/^\d{4}-\d{2}-\d{2}$/.test(parsed.from ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(parsed.to ?? '')) {
              return { ...parsed, models }
            }
          } else {
            return { ...rangeOf(parsed.preset), preset: parsed.preset, models }
          }
        }
      } catch {
        // Private mode or corrupt value: the default applies.
      }
      return defaultWindow()
    }

    /** Resolve a preset into concrete day keys. */
    function rangeOf(preset) {
      const today = midnight(0)
      if (preset === 'today') return { from: dayKey(today), to: dayKey(today) }
      if (preset === '30') return { from: dayKey(midnight(-29)), to: dayKey(today) }
      if (preset === 'month') return { from: dayKey(new Date(today.getFullYear(), today.getMonth(), 1)), to: dayKey(today) }
      if (preset === 'lastMonth') {
        const first = new Date(today.getFullYear(), today.getMonth() - 1, 1)
        const last = new Date(today.getFullYear(), today.getMonth(), 0)
        return { from: dayKey(first), to: dayKey(last) }
      }
      return { from: dayKey(midnight(-6)), to: dayKey(today) }
    }

    /** Persist a window and wake every mounted surface. */
    function saveWindow(next) {
      try {
        localStorage.setItem(WINDOW_KEY, JSON.stringify(next))
      } catch {
        // Private mode: the choice lasts for this page only.
      }
      try {
        window.dispatchEvent(new CustomEvent(WINDOW_EVENT))
      } catch {
        // No CustomEvent (older engine): the caller still re-renders locally.
      }
    }

    /** Subscribe to the shared window choice. */
    function useWindowChoice() {
      const [value, setValue] = useState(readWindow)
      useEffect(() => {
        const sync = () => setValue(readWindow())
        window.addEventListener(WINDOW_EVENT, sync)
        window.addEventListener('storage', sync)
        return () => {
          window.removeEventListener(WINDOW_EVENT, sync)
          window.removeEventListener('storage', sync)
        }
      }, [])
      const choose = useCallback((next) => {
        saveWindow(next)
        setValue(next)
      }, [])
      return [value, choose]
    }

    /** Presets offered in the card's window menu, in display order. */
    const POPOVER_WINDOWS = ['today', '7', '30', 'month', 'lastMonth', 'custom']

    /** Preset id → the locale key naming it. */
    const WINDOW_LABEL_KEYS = {
      today: 'windowToday',
      7: 'window7',
      30: 'window30',
      month: 'windowMonth',
      lastMonth: 'windowLastMonth',
      custom: 'windowCustom',
    }

    /** Whether a snapshot describes a live plan. */
    function planIsLive(state) {
      const data = state?.data
      if (data === null || data === undefined) return false
      if (data.hasQuotaData === false) return false
      if (typeof data.resetAt === 'number' && data.resetAt > 0 && data.resetAt <= Date.now()) return false
      return true
    }

    /* ---------------------------------------------------------------- */
    /* Host data                                                          */
    /* ---------------------------------------------------------------- */

    /** Poll the monthly percentage route. */
    function useQuota() {
      const [state, setState] = useState({ status: 'loading' })
      const alive = useRef(true)

      const load = useCallback(async (force) => {
        try {
          const response = await fetch(force ? '/api/bailian-quota/refresh' : '/api/bailian-quota/state', {
            method: force ? 'POST' : 'GET',
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
          const body = await response.json()
          if (!alive.current) return
          const hasData = body?.data !== null && body?.data !== undefined
          setState({ status: hasData ? 'ready' : 'error', ...body, error: body?.error ?? null })
        } catch (error) {
          if (alive.current) setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }, [])

      useEffect(() => {
        alive.current = true
        void load(false)
        const timer = setInterval(() => { void load(false) }, POLL_MS)
        return () => {
          alive.current = false
          clearInterval(timer)
        }
      }, [load])

      const [busy, setBusy] = useState(false)
      const refresh = useCallback(async () => {
        setBusy(true)
        try {
          await load(true)
        } finally {
          if (alive.current) setBusy(false)
        }
      }, [load])

      return { state, busy, refresh }
    }

    /** Read the Host's replay for one window. */
    function useDetail(active, range, models) {
      const [detail, setDetail] = useState({ status: 'idle' })
      const [busy, setBusy] = useState(false)
      const modelKey = (models ?? []).join(',')
      const load = useCallback(async (force) => {
        setBusy(true)
        try {
          const modelQuery = modelKey === '' ? '' : `&models=${encodeURIComponent(modelKey)}`
          const query = `from=${range.from}&to=${range.to}${modelQuery}`
          const response = await fetch(`/api/bailian-quota/detail?${query}`, {
            method: force ? 'POST' : 'GET',
            headers: { accept: 'application/json' },
            cache: 'no-store',
          })
          const body = await response.json()
          setDetail(body?.ok === true ? { status: 'ready', ...body } : { status: 'error', error: body?.error ?? 'unknown' })
        } catch (error) {
          setDetail({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        } finally {
          setBusy(false)
        }
      }, [range.from, range.to, modelKey])
      useEffect(() => {
        if (!active) return
        void load(false)
        const timer = setInterval(() => { void load(false) }, 30_000)
        const onVisible = () => { if (document.visibilityState === 'visible') void load(false) }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [active, load])
      return { detail, busy, reload: () => load(true) }
    }

    /* ---------------------------------------------------------------- */
    /* Styles                                                            */
    /* ---------------------------------------------------------------- */

    const CSS = `
.blq-pill{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;line-height:1;cursor:pointer;white-space:nowrap;transition:background .15s ease,color .15s ease}
.blq-pill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.blq-pill[data-busy="true"]{opacity:.6}
.blq-pill b{font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.blq-pill-dot{width:5px;height:5px;border-radius:50%;background:#2f9e62}
.blq-pill[data-tone="warm"] .blq-pill-dot{background:#c08a1e}
.blq-pill[data-tone="hot"] .blq-pill-dot{background:#d9611f}
.blq-pill[data-tone="over"] .blq-pill-dot{background:#c8382f}

.blq-pop{position:fixed;z-index:9999;display:flex;flex-direction:column;gap:0;padding:14px 16px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);box-shadow:0 10px 32px rgba(16,24,40,.12);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5;font-feature-settings:'tnum' 1}
.blq-pophead{display:flex;align-items:center;gap:6px;margin-bottom:10px}
.blq-pophead b{font-size:12.5px;font-weight:600}
.blq-tag{flex:none;font-size:10px;line-height:16px;padding:0 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;color:var(--dsw-alias-label-tertiary);font-weight:400}
.blq-pophint{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.blq-mini{flex:none;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer}
.blq-mini:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.blq-metric{display:flex;align-items:baseline;gap:6px;margin-bottom:8px}
.blq-metric b{font-size:19.5px;line-height:1.1;font-weight:600;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.blq-metric span{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.blq-table{display:flex;flex-direction:column}
.blq-kv{display:flex;align-items:baseline;gap:16px;padding:4px 0;border-bottom:1px solid rgba(128,128,128,.10)}
.blq-kv:last-child{border-bottom:0}
.blq-kv span{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.blq-kv b{margin-left:auto;font-size:12px;font-weight:500;font-variant-numeric:tabular-nums;white-space:nowrap}
.blq-kv-btn{width:100%;border:0;background:transparent;font:inherit;line-height:inherit;color:inherit;cursor:pointer;padding:4px 0;text-align:left;align-items:baseline}
.blq-kv-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.blq-kv-value{margin-left:auto;display:inline-flex;align-items:center;gap:4px}
.blq-kv-value b{margin-left:0}
.blq-caret{width:5px;height:5px;margin:0;border-right:1.5px solid var(--dsw-alias-label-tertiary);border-bottom:1.5px solid var(--dsw-alias-label-tertiary);transform:rotate(45deg) translate(-1px,-1px);flex:none}
.blq-modellist{display:flex;flex-direction:column;gap:1px;margin:2px 0 4px;padding:4px;border-radius:8px;background:rgba(128,128,128,.06)}
.blq-model{display:flex;align-items:baseline;gap:8px;padding:4px 6px;border:0;border-radius:6px;background:transparent;font:inherit;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left}
.blq-model:hover{background:var(--dsw-alias-interactive-bg-hover)}
.blq-model[data-active="true"]{color:#4d6bfe;background:rgba(77,107,254,.10)}
.blq-model span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.blq-model b{margin-left:auto;font-weight:500;font-variant-numeric:tabular-nums}
.blq-chips-models{margin-top:-6px}
.blq-daterow{display:flex;flex-direction:column;gap:4px;margin:2px 0 4px;padding:0 2px}
.blq-daterow .blq-date{height:24px;font-size:11px;width:100%}
.blq-planline{display:flex;align-items:baseline;gap:8px;margin:2px 0 4px}
.blq-planline b{font-size:19.5px;line-height:1.15;font-weight:600;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.blq-planline b[data-tone="warm"]{color:#b3821c}
.blq-planline b[data-tone="hot"]{color:#c26312}
.blq-planline b[data-tone="over"]{color:#c8382f}
.blq-planline span{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.blq-meter{height:4px;border-radius:2px;background:rgba(128,128,128,.18);overflow:hidden;margin:2px 0 8px}
.blq-meter i{display:block;height:100%;border-radius:2px;background:#4d6bfe}
.blq-meter[data-tone="warm"] i{background:#c08a1e}
.blq-meter[data-tone="hot"] i{background:#d9611f}
.blq-meter[data-tone="over"] i{background:#c8382f}
.blq-sechead{display:flex;align-items:baseline;gap:6px;margin:0 0 6px}
.blq-sechead b{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.blq-sechead span{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.blq-sechead-gap{margin-top:12px}
.blq-sep{height:1px;margin:7px 0 5px;border:0;background:rgba(128,128,128,.12)}
.blq-note{font-size:10.5px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}
.blq-foot{margin-top:10px;padding-top:8px;border-top:1px solid rgba(128,128,128,.12)}
.blq-planalert{display:flex;align-items:flex-start;gap:7px;margin:2px 0 8px;padding:7px 9px;border-radius:7px;background:rgba(200,56,47,.06);border:1px solid rgba(200,56,47,.18)}
.blq-planalert-wide{padding:9px 11px;margin:8px 0 2px}
.blq-planalert div{display:flex;flex-direction:column;gap:1px;min-width:0}
.blq-planalert b{font-size:11.5px;font-weight:600;color:#b4372f;line-height:1.3}
.blq-planalert small{font-size:10px;color:var(--dsw-alias-label-tertiary);line-height:1.3}
.blq-dot-warn{flex:none;width:6px;height:6px;margin-top:5px;border-radius:50%;background:#c8382f}
.blq-link{margin-left:auto;flex:none;border:0;background:transparent;padding:0 2px;font:inherit;font-size:11px;line-height:1.4;color:#4d6bfe;cursor:pointer}
.blq-link:hover{text-decoration:underline}
.blq-btn-sm{height:22px;padding:0 9px;font-size:11px}
.blq-pill[data-warn="true"]{border-color:rgba(200,56,47,.45)}
.blq-pill[data-warn="true"] .blq-pill-dot{background:#c8382f}
.blq-pill-warn{display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;background:#c8382f;color:#fff;font-size:9px;font-weight:700;line-height:1}
.blq-skeleton{display:flex;flex-direction:column;gap:7px;padding:2px 0}
.blq-skeleton i{display:block;height:10px;border-radius:5px;background:var(--dsw-alias-bg-skeleton)}

.blq-page{display:flex;flex-direction:column;gap:14px;padding:2px 0 10px}
.blq-panelhead{display:flex;align-items:flex-start;gap:12px}
.blq-panelhead h3{margin:0;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}
.blq-panelhead p{margin:2px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.blq-panelhead .blq-spacer{flex:1 1 auto}
.blq-btn{display:inline-flex;align-items:center;height:26px;padding:0 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;cursor:pointer}
.blq-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.blq-btn:disabled{opacity:.6;cursor:default}
.blq-card{padding:16px 18px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base)}
.blq-cardhead{display:flex;align-items:baseline;gap:8px;margin-bottom:10px}
.blq-cardhead b{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.blq-cardhead span{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.blq-cardhead .blq-tag{margin-left:2px}
.blq-big{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}
.blq-big b{font-size:21px;letter-spacing:-.01em;line-height:1.15;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
.blq-big span{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.blq-factrow{display:flex;flex-wrap:wrap;gap:4px 18px;margin:6px 0 12px}
.blq-fact{display:flex;align-items:baseline;gap:5px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.blq-fact b{font-size:11.5px;font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.blq-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:12px}
.blq-chip{height:24px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;cursor:pointer}
.blq-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.blq-chip[data-active="true"]{border-color:#4d6bfe;color:#4d6bfe;background:rgba(77,107,254,.08)}
.blq-date{height:24px;padding:0 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px}
.blq-chart{position:relative;width:100%}
.blq-chart svg{display:block;width:100%;height:auto}
.blq-chart{position:relative}
.blq-tip{position:absolute;top:2px;padding:9px 11px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);box-shadow:0 8px 24px rgba(16,24,40,.16);pointer-events:none;z-index:3}
.blq-tip-date{font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:6px;font-variant-numeric:tabular-nums}
.blq-tip-row{display:flex;align-items:center;gap:6px;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.blq-tip-row i{width:8px;height:8px;border-radius:2px;flex:none}
.blq-tip-row b{margin-left:auto;font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.blq-legend{display:flex;align-items:center;gap:12px;margin-top:8px;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.blq-legend span{display:inline-flex;align-items:center;gap:5px}
.blq-legend i{width:8px;height:8px;border-radius:2px}
.blq-legend-spacer{flex:1 1 auto}
.blq-axis{display:flex;justify-content:space-between;margin-top:2px;font-size:10px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.blq-rows{display:flex;flex-direction:column;gap:7px}
.blq-row{display:flex;align-items:baseline;gap:12px;font-size:12px}
.blq-row span{flex:none;color:var(--dsw-alias-label-tertiary)}
.blq-row b{margin-left:auto;font-weight:500;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;text-align:right}
.blq-error{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base)}
.blq-error b{font-size:12.5px;color:#c8382f}
.blq-error span{font-size:11.5px;color:var(--dsw-alias-label-secondary);word-break:break-word}
`

    /** Shared stylesheet, rendered inside each surface so unmounting removes it. */
    function Styles() {
      return h('style', { 'data-blq': '' }, CSS)
    }

    /** The database glyph the shell's own stats card uses. */
    function StackIcon() {
      return h('svg', { width: '15', height: '15', viewBox: '0 0 16 16', 'aria-hidden': 'true', fill: 'none' },
        h('ellipse', { cx: '8', cy: '4', rx: '5.2', ry: '2.2', stroke: 'currentColor', strokeWidth: '1.2' }),
        h('path', { d: 'M2.8 4v4c0 1.2 2.3 2.2 5.2 2.2s5.2-1 5.2-2.2V4', stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round' }),
        h('path', { d: 'M2.8 8v4c0 1.2 2.3 2.2 5.2 2.2s5.2-1 5.2-2.2V8', stroke: 'currentColor', strokeWidth: '1.2', strokeLinecap: 'round' }))
    }

    /** One label/value row. */
    function Row({ label, value, title }) {
      return h('div', { className: 'blq-row' },
        h('span', null, label),
        h('b', { title: title ?? String(value) }, value))
    }

    /** The reset row's value: absolute time plus the remaining span. */
    function resetText(data) {
      if (data?.resetAt === undefined || data?.resetAt === null) return '—'
      const left = countdown(data.resetAt, Date.now())
      return `${stamp(data.resetAt)} · ${left}`
    }

    /**
     * Daily token bars: one bar per day in the window, scaled to the peak, with
     * the peak and the two ends labelled. Days without usage keep a baseline
     * hairline so the rhythm of the window stays readable.
     */
    function TokenChart({ series, t }) {
      const points = Array.isArray(series) ? series : []
      const [hover, setHover] = useState(null)
      const box = useRef(null)
      const [width, setWidth] = useState(640)

      // Measure the real width: a stretched viewBox would scale the axis text
      // non-uniformly, which is what made the labels look broken.
      useEffect(() => {
        const node = box.current
        if (node === null || node === undefined) return
        const measure = () => {
          const next = Math.max(240, Math.round(node.getBoundingClientRect().width))
          setWidth(next)
        }
        measure()
        if (typeof ResizeObserver === 'function') {
          const observer = new ResizeObserver(measure)
          observer.observe(node)
          return () => observer.disconnect()
        }
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
      }, [])

      if (points.length === 0) {
        return h('div', { className: 'blq-chart', ref: box }, h('div', { className: 'blq-note' }, t('trendEmpty')))
      }

      const height = 158
      const padTop = 14
      const padBottom = 22
      const padLeft = 38
      const plot = Math.max(60, width - padLeft - 4)
      const max = Math.max(...points.map((point) => point.tokens), 1)
      const slot = plot / points.length
      // One or two days should read as a bar, not as a stray line.
      const barWidth = Math.min(points.length <= 3 ? 44 : 22, Math.max(3, slot * (points.length <= 3 ? 0.42 : 0.55)))
      const peak = points.reduce((best, point) => (point.tokens > best.tokens ? point : best), points[0])
      const ticks = [0, 0.5, 1].map((ratio) => ({
        ratio,
        value: max * ratio,
        y: height - padBottom - ratio * (height - padTop - padBottom),
      }))
      const labelStep = Math.max(1, Math.ceil(points.length / 6))
      const segments = [
        { key: 'cacheRead', color: '#b9d2ff' },
        { key: 'input', color: '#6f97ff' },
        { key: 'output', color: '#2f4fe0' },
      ]
      const hovered = hover === null ? null : points[hover]
      const hoverX = hover === null ? 0 : padLeft + hover * slot + slot / 2
      const tipWidth = 196
      const tipLeft = Math.min(Math.max(6, hoverX - tipWidth / 2), Math.max(6, width - tipWidth - 6))

      return h('div', { className: 'blq-chart', ref: box, onMouseLeave: () => setHover(null) },
        h('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': t('trend') },
          ticks.map((tick) => h('g', { key: `t${tick.ratio}` },
            h('line', {
              x1: padLeft, y1: tick.y.toFixed(1), x2: width - 2, y2: tick.y.toFixed(1),
              stroke: 'rgba(128,128,128,.14)', strokeWidth: '1',
            }),
            h('text', {
              x: padLeft - 7, y: (tick.y + 3).toFixed(1), 'text-anchor': 'end',
              'font-size': '9.5', fill: 'var(--dsw-alias-label-tertiary)',
            }, tick.ratio === 0 ? '0' : tokens(tick.value)))),
          points.map((point, index) => {
            const usable = height - padTop - padBottom
            const x = padLeft + index * slot + (slot - barWidth) / 2
            let cursor = height - padBottom
            const parts = []
            for (const segment of segments) {
              const value = point[segment.key] ?? 0
              if (value <= 0) continue
              const segmentHeight = (value / max) * usable
              cursor -= segmentHeight
              parts.push(h('rect', {
                key: `${point.date}-${segment.key}`,
                x: x.toFixed(1), y: cursor.toFixed(1),
                width: barWidth.toFixed(1), height: Math.max(0.6, segmentHeight).toFixed(1),
                rx: '2', fill: segment.color,
              }))
            }
            return h('g', { key: point.date, onMouseEnter: () => setHover(index) },
              point.tokens === 0
                ? h('rect', {
                    x: x.toFixed(1), y: (height - padBottom - 1).toFixed(1),
                    width: barWidth.toFixed(1), height: '1', fill: 'rgba(128,128,128,.22)',
                  })
                : parts,
              h('rect', {
                x: (padLeft + index * slot).toFixed(1), y: padTop,
                width: slot.toFixed(1), height: (height - padTop - padBottom).toFixed(1),
                fill: 'transparent',
              }))
          }),
          h('line', {
            x1: padLeft, y1: height - padBottom, x2: width - 2, y2: height - padBottom,
            stroke: 'rgba(128,128,128,.26)', strokeWidth: '1',
          }),
          points.map((point, index) => (index % labelStep === 0 || index === points.length - 1
            ? h('text', {
                key: `x${point.date}`,
                x: (padLeft + index * slot + slot / 2).toFixed(1),
                y: height - 6,
                'text-anchor': 'middle',
                'font-size': '9.5',
                fill: 'var(--dsw-alias-label-tertiary)',
              }, point.date.slice(5))
            : null))),
        hovered === null
          ? null
          : h('div', { className: 'blq-tip', style: { left: `${tipLeft}px`, width: `${tipWidth}px` } },
              h('div', { className: 'blq-tip-date' }, hovered.date),
              h('div', { className: 'blq-tip-row' },
                h('i', { style: { background: '#b9d2ff' } }),
                h('span', null, t('tipCached')),
                h('b', null, (hovered.cacheRead ?? 0).toLocaleString())),
              h('div', { className: 'blq-tip-row' },
                h('i', { style: { background: '#6f97ff' } }),
                h('span', null, t('tipInput')),
                h('b', null, (hovered.input ?? 0).toLocaleString())),
              h('div', { className: 'blq-tip-row' },
                h('i', { style: { background: '#2f4fe0' } }),
                h('span', null, t('tipOutput')),
                h('b', null, (hovered.output ?? 0).toLocaleString()))),
        h('div', { className: 'blq-legend' },
          segments.map((segment) => h('span', { key: segment.key },
            h('i', { style: { background: segment.color } }),
            t(segment.key === 'cacheRead' ? 'tipCached' : segment.key === 'input' ? 'tipInput' : 'tipOutput'))),
          h('span', { className: 'blq-legend-spacer' }),
          h('span', null, `${points.length} 天 · ${t('trendPeak')} ${tokens(peak.tokens)}`)))
    }

    /**
     * The card the pill opens: the shared token window, then the monthly
     * allowance. Read-only for the window — the Settings page owns that choice.
     */
    function QuotaPopover({ t, anchor, onClose, data, state, detail, detailBusy, windowLabel, choice, choose, selectedModels, onRefresh, onRefreshDetail }) {
      const [modelsOpen, setModelsOpen] = useState(false)
      const [windowOpen, setWindowOpen] = useState(false)
      const [style, setStyle] = useState({ top: 0, left: 0, visibility: 'hidden' })
      useEffect(() => {
        const place = () => {
          const rect = anchor.current?.getBoundingClientRect()
          if (rect === undefined) return
          const width = 272
          const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
          setStyle({ top: Math.max(8, rect.top - 10), left, transform: 'translateY(-100%)', visibility: 'visible', width: `${width}px` })
        }
        place()
        window.addEventListener('resize', place)
        return () => window.removeEventListener('resize', place)
      }, [anchor])
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        const onClick = (event) => {
          const node = anchor.current
          const pop = document.querySelector('[data-blq-pop]')
          if (pop !== null && pop.contains(event.target)) return
          if (node !== null && node !== undefined && node.contains(event.target)) return
          onClose()
        }
        document.addEventListener('keydown', onKey)
        document.addEventListener('mousedown', onClick, true)
        return () => {
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('mousedown', onClick, true)
        }
      }, [anchor, onClose])

      const used = data?.usedFraction ?? 0
      const failureKind = state?.failureKind ?? ''
      const failing = failureKind !== ''
      const failureHint = failing ? t(FAILURE_TEXT[failureKind] ?? 'failUnknown') : ''
      const local = detail?.local
      const modelSummaryLabel = selectedModels.length === 0
        ? String(local?.models ?? 0)
        : `${selectedModels.length} / ${local?.allModels?.length ?? selectedModels.length}`
      /** One table row: muted label on the left, value flush right. */
      const row = (label, value, key) => h('div', { className: 'blq-kv', key: key ?? label },
        h('span', null, label),
        h('b', null, value))

      return h('div', { className: 'blq-pop', 'data-blq-pop': '', style, role: 'dialog', 'aria-label': t('localTitle') },
        h('div', { className: 'blq-pophead' },
          h('b', null, t('localTitle')),
          h('span', { className: 'blq-tag' }, t('localBadge')),
          h('span', { className: 'blq-pophint' }, t('popHint')),
          h('button', {
            type: 'button', className: 'blq-mini', disabled: detailBusy,
            title: t('refresh'), 'aria-label': t('refresh'),
            onClick: () => { onRefresh(); onRefreshDetail() },
          }, detailBusy ? '…' : '↻')),
        detail?.status === 'error'
          ? h('div', { className: 'blq-note' }, `${t('detailError')}: ${detail.error ?? ''}`)
          : detail?.status !== 'ready'
            ? h('div', { className: 'blq-skeleton' }, h('i', null), h('i', null), h('i', null))
            : h(React.Fragment, null,
                h('div', { className: 'blq-metric' },
                  h('b', null, tokens(local?.totalTokens)),
                  h('span', null, 'tokens')),
                h('div', { className: 'blq-table' },
                  row(t('calls'), local?.calls ?? 0),
                  h('button', {
                    type: 'button', className: 'blq-kv blq-kv-btn',
                    'aria-expanded': modelsOpen ? 'true' : 'false',
                    onClick: () => setModelsOpen((value) => !value),
                  },
                    h('span', null, t('modelsCalled')),
                    h('span', { className: 'blq-kv-value' },
                      h('b', null, modelSummaryLabel),
                      h('i', { className: 'blq-caret' }))),
                  modelsOpen
                    ? h('div', { className: 'blq-modellist' },
                        h('button', {
                          type: 'button', className: 'blq-model',
                          'data-active': String(selectedModels.length === 0),
                          onClick: () => choose({ ...choice, models: [] }),
                        },
                          h('span', null, t('allModels')),
                          h('b', null, tokens(local?.allModels?.reduce((sum, row2) => sum + row2.tokens, 0)))),
                        (local?.allModels ?? []).map((entrySecond) => h('button', {
                          type: 'button',
                          className: 'blq-model',
                          key: entrySecond.model,
                          'data-active': String(selectedModels.includes(entrySecond.model)),
                          onClick: () => choose({
                            ...choice,
                            models: selectedModels.includes(entrySecond.model)
                              ? selectedModels.filter((name) => name !== entrySecond.model)
                              : [...selectedModels, entrySecond.model],
                          }),
                        },
                          h('span', null, entrySecond.model),
                          h('b', null, tokens(entrySecond.tokens)))))
                    : null,
                  h('button', {
                    type: 'button', className: 'blq-kv blq-kv-btn',
                    'aria-expanded': windowOpen ? 'true' : 'false',
                    onClick: () => setWindowOpen((value) => !value),
                  },
                    h('span', null, t('window')),
                    h('span', { className: 'blq-kv-value' },
                      h('b', null, windowLabel),
                      h('i', { className: 'blq-caret' }))),
                  windowOpen
                    ? h('div', { className: 'blq-modellist' },
                        POPOVER_WINDOWS.map((preset) => h('button', {
                          type: 'button',
                          key: preset,
                          className: 'blq-model',
                          'data-active': String(choice.preset === preset),
                          onClick: () => choose({
                            ...choice,
                            preset,
                            ...(preset === 'custom' ? { from: range.from, to: range.to } : rangeOf(preset)),
                          }),
                        }, h('span', null, t(WINDOW_LABEL_KEYS[preset])))),
                        choice.preset === 'custom'
                          ? h('div', { className: 'blq-daterow' },
                              h('input', {
                                className: 'blq-date', type: 'date', value: choice.from, 'aria-label': t('from'),
                                onChange: (event) => choose({ ...choice, preset: 'custom', from: event.target.value }),
                              }),
                              h('input', {
                                className: 'blq-date', type: 'date', value: choice.to, 'aria-label': t('to'),
                                onChange: (event) => choose({ ...choice, preset: 'custom', to: event.target.value }),
                              }))
                          : null)
                    : null)),
        h('div', { className: 'blq-sechead blq-sechead-gap' }, h('b', null, t('title'))),
        failing
          ? h('div', { className: 'blq-planalert', title: String(state.error ?? '') },
              h('i', { className: 'blq-dot-warn' }),
              h('div', null,
                h('b', null, t(FAILURE_SHORT[failureKind] ?? 'shortUnknown')),
                h('small', null, `${t('dataStopped')} ${stamp(state.updatedAt)} · ${t('failStale')}`)),
              h('button', { type: 'button', className: 'blq-link', onClick: () => { void onRefresh() } }, t('retry')))
          : null,
        h('div', { className: 'blq-planline' },
          h('b', { 'data-tone': tone(used) }, percent(used)),
          h('span', null, `${t('left')} ${percent(Math.max(0, 1 - used))}`)),
        h('div', { className: 'blq-meter', 'data-tone': tone(used) },
          h('i', { style: { width: `${Math.min(100, Math.max(2, used * 100))}%` } })),
        h('div', { className: 'blq-table' },
          row(t('reset'), data?.resetAt ? stamp(data.resetAt) : '—'),
          row(t('countdown'), data?.resetAt ? countdown(data.resetAt, Date.now()) : '—')),
        h('div', { className: 'blq-note blq-foot' }, t('source')))
    }

    /** The pill: `套餐 1.73%`, opening the card on press. */
    function QuotaPill(props) {
      const t = useTranslator(props?.t)
      const { state, busy, refresh } = useQuota()
      const [choice, choose] = useWindowChoice()
      const range = useMemo(() => (choice.preset === 'custom' ? { from: choice.from, to: choice.to } : rangeOf(choice.preset)), [choice])
      const [open, setOpen] = useState(false)
      const anchor = useRef(null)
      const { detail, busy: detailBusy, reload } = useDetail(open, range, choice.models)
      const close = useCallback(() => setOpen(false), [])
      if (!planIsLive(state)) return null
      const used = state.data.usedFraction ?? 0
      const failureKind = state.failureKind ?? ''
      const failing = failureKind !== ''
      const failureHint = failing ? t(FAILURE_TEXT[failureKind] ?? 'failUnknown') : ''
      const windowLabel = t(WINDOW_LABEL_KEYS[choice.preset] ?? 'window7')
      const portal = typeof createPortal === 'function' && typeof document !== 'undefined'
      return h(React.Fragment, null,
        h(Styles),
        h('button', {
          ref: anchor,
          type: 'button',
          className: 'blq-pill',
          'data-busy': String(busy),
          'data-tone': failing ? 'stale' : tone(used),
          'data-warn': String(failing),
          'aria-expanded': open ? 'true' : 'false',
          title: failing
            ? `${t('failTitle')}：${failureHint}\n${state.error ?? ''}`
            : `${t('planName')} · ${t('used')} ${percent(used)} · ${t('reset')} ${resetText(state.data)}`,
          onClick: () => setOpen((value) => !value),
        },
          h('i', { className: 'blq-pill-dot' }),
          h('span', null, t('pillLabel')),
          h('b', null, percent(used)),
          failing ? h('span', { className: 'blq-pill-warn', 'aria-hidden': 'true' }, '!') : null),
        open && portal
          ? createPortal(h(QuotaPopover, {
              t,
              anchor,
              onClose: close,
              data: state.data,
              state,
              detail,
              detailBusy,
              windowLabel,
              choice,
              choose,
              selectedModels: choice.models ?? [],
              onRefresh: () => { void refresh() },
              onRefreshDetail: () => { void reload() },
            }), document.body)
          : null)
    }

    /** Window chips plus the two date fields the Custom preset reveals. */
    function WindowPicker({ t, choice, choose }) {
      const presets = [
        ['today', t('windowToday')],
        ['7', t('window7')],
        ['30', t('window30')],
        ['month', t('windowMonth')],
        ['lastMonth', t('windowLastMonth')],
        ['custom', t('windowCustom')],
      ]
      const active = choice.preset
      return h('div', { className: 'blq-chips' },
        presets.map(([value, label]) => h('button', {
          key: value,
          type: 'button',
          className: 'blq-chip',
          'data-active': String(active === value),
          onClick: () => {
            if (value === 'custom') {
              const base = active === 'custom' ? choice : { ...rangeOf(active === 'custom' ? '7' : active) }
              choose({ preset: 'custom', from: base.from, to: base.to })
              return
            }
            choose({ preset: value, ...rangeOf(value) })
          },
        }, label)),
        active === 'custom'
          ? h(React.Fragment, null,
              h('input', {
                className: 'blq-date', type: 'date', value: choice.from, 'aria-label': t('from'),
                onChange: (event) => choose({ preset: 'custom', from: event.target.value, to: choice.to }),
              }),
              h('span', { className: 'blq-note' }, '→'),
              h('input', {
                className: 'blq-date', type: 'date', value: choice.to, 'aria-label': t('to'),
                onChange: (event) => choose({ preset: 'custom', from: choice.from, to: event.target.value }),
              }))
          : null)
    }

    /** Model chips: all models, or a multi-select that narrows the totals and the chart. */
    function ModelPicker({ t, choice, choose, models }) {
      const rows = Array.isArray(models) ? models : []
      const selected = choice.models ?? []
      if (rows.length <= 1) return null
      const toggle = (model) => {
        const next = selected.includes(model)
          ? selected.filter((name) => name !== model)
          : [...selected, model]
        choose({ ...choice, models: next })
      }
      return h('div', { className: 'blq-chips blq-chips-models' },
        h('button', {
          type: 'button', className: 'blq-chip', 'data-active': String(selected.length === 0),
          onClick: () => choose({ ...choice, models: [] }),
        }, t('allModels')),
        rows.map((entry) => h('button', {
          type: 'button',
          key: entry.model,
          className: 'blq-chip',
          title: `${entry.model} · ${tokens(entry.tokens)} · ${entry.calls} ${t('calls')}`,
          'data-active': String(selected.includes(entry.model)),
          onClick: () => toggle(entry.model),
        }, `${entry.model} · ${tokens(entry.tokens)}`)))
    }

    /** The Settings page: window picker, token totals with the daily chart, plan rows. */
    function QuotaPanel(props) {
      const t = useTranslator(props?.t)
      const { state, busy, refresh } = useQuota()
      const [choice, choose] = useWindowChoice()
      const range = useMemo(() => (choice.preset === 'custom' ? { from: choice.from, to: choice.to } : rangeOf(choice.preset)), [choice])
      const { detail, busy: detailBusy, reload } = useDetail(true, range, choice.models)
      const local = detail?.local
      const used = state.data?.usedFraction ?? 0

      const head = h('div', { className: 'blq-panelhead' },
        h('div', null,
          h('h3', null, t('title')),
          h('p', null, t('subtitle'))),
        h('span', { className: 'blq-spacer' }),
        h('button', {
          type: 'button', className: 'blq-btn', disabled: busy || detailBusy,
          onClick: () => { void refresh(); void reload() },
        }, busy || detailBusy ? t('refreshing') : t('refresh')))

      const failureKind = state.failureKind ?? ''
      const failing = failureKind !== ''
      const quotaCard = state.status === 'error'
        ? h('div', { className: 'blq-error' },
            h('b', null, t('errorTitle')),
            h('span', null, String(state.error ?? '')),
            h('span', null, t('errorHint')))
        : h('div', { className: 'blq-card' },
            h('div', { className: 'blq-cardhead' },
              h(StackIcon),
              h('b', null, t('title')),
              h('span', { className: 'blq-spacer' }),
              h('b', { 'data-tone': tone(used) }, percent(used))),
            h('div', { className: 'blq-meter', 'data-tone': tone(used) },
              h('i', { style: { width: `${Math.min(100, Math.max(2, used * 100))}%` } })),
            failing
              ? h('div', { className: 'blq-planalert blq-planalert-wide', title: String(state.error ?? '') },
                  h('i', { className: 'blq-dot-warn' }),
                  h('div', null,
                    h('b', null, t(FAILURE_SHORT[failureKind] ?? 'shortUnknown')),
                    h('small', null, `${t(FAILURE_TEXT[failureKind] ?? 'failUnknown')} · ${t('dataStopped')} ${stamp(state.updatedAt)}`)),
                  h('button', {
                    type: 'button', className: 'blq-link',
                    onClick: () => { void refresh(); void reload() },
                  }, t('retry')))
              : null,
            h('div', { className: 'blq-rows', style: { marginTop: '10px' } },
              h(Row, { label: t('plan'), value: t('planName') }),
              h(Row, { label: t('used'), value: percent(used) }),
              h(Row, { label: t('left'), value: percent(Math.max(0, 1 - used)) }),
              h(Row, { label: t('reset'), value: resetText(state.data) }),
              h(Row, { label: t('updated'), value: state.updatedAt ? stamp(state.updatedAt) : t('never') })),
            state.data?.hasQuotaData === false ? h('div', { className: 'blq-note', style: { marginTop: '8px' } }, t('noQuota')) : null)

      const tokenCard = h('div', { className: 'blq-card' },
        h('div', { className: 'blq-cardhead' },
          h(StackIcon),
          h('b', null, t('localTitle')),
          h('span', { className: 'blq-tag' }, t('localBadge')),
          h('span', { className: 'blq-spacer' }),
          h('span', null, `${range.from} → ${range.to}`)),
        h(WindowPicker, { t, choice, choose }),
        h(ModelPicker, { t, choice, choose, models: local?.allModels }),
        detail?.status === 'error'
          ? h('div', { className: 'blq-error' }, h('span', null, `${t('detailError')}: ${detail.error ?? ''}`))
          : h(React.Fragment, null,
              h('div', { className: 'blq-big' },
                h('b', null, tokens(local?.totalTokens)),
                h('span', null, t('totalTokens'))),
              h('div', { className: 'blq-factrow' },
                h('div', { className: 'blq-fact' }, h('span', null, t('calls')), h('b', null, String(local?.calls ?? 0))),
                h('div', { className: 'blq-fact' }, h('span', null, t('modelsCalled')), h('b', null, String(local?.models ?? 0))),
                h('div', { className: 'blq-fact' }, h('span', null, t('window')), h('b', null, `${local?.days ?? 1} 天`))),
              h(TokenChart, { series: local?.series, t })))

      return h('div', { className: 'blq-page' },
        h(Styles),
        head,
        tokenCard,
        quotaCard,
        h('div', { className: 'blq-note' }, t('source')))
    }

    /**
     * Register the Settings page and the composer pill.
     * @param ctx - client context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'bailian-quota: dictionaries')
      const t = ctx.locale.bind(NS)
      // Left end of the tool row, after the permission control: that side has
      // slack before the right-aligned model selector, so the figure costs the
      // model name no width at all.
      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left', id: 'bailian-quota.pill', order: 200, locale: NS,
      }, QuotaPill))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'bailian-quota', order: 55, label: () => t('nav'), locale: NS,
      }, QuotaPanel))
    }

    return { inject: ['slots', 'locale'], apply }
  },
})