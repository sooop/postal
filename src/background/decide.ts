import {
  DECIDE, DEFAULT_THRESHOLDS, decideError, validateDecision,
  type DecideError, type DecideRequest, type DecisionView, type Thresholds,
} from '@/lib/decide'

/** 앱 프레임(포트) 하나. BridgeSession 이 구현한다 */
export interface AppEndpoint {
  /** 공통 필드(source, v, ts)는 구현체가 붙인다 */
  send(msg: Record<string, unknown>): void
  tabId?: number
}

interface AppInfo {
  engines: string[]
  maxCandidates: number
  appVersion?: string
}

export interface DecideDeps {
  uuid(): string
  openTab(url: string): Promise<number | undefined>
  closeTab(id: number): Promise<void>
  /** 백그라운드 탭에서 앱이 준비되지 않을 때 탭을 앞으로 가져온다(탭 절전·지연 로딩 대비). 없으면 건너뛴다 */
  activateTab?(id: number): Promise<void>
  /** 테스트용 재정의 */
  idleCloseMs?: number
  readyTimeoutMs?: number
  /** 이 시간 안에 준비되지 않으면 탭을 앞으로 가져온다 */
  foregroundAfterMs?: number
}

export interface DecideOptions {
  appUrl: string
  thresholds?: Thresholds
  /** 이 탭의 앱 프레임을 먼저 쓴다(사용자가 지금 보고 있는 탭) */
  preferTabId?: number
  onStage?(stage: 'connecting' | 'waiting' | 'scoring' | 'asking_ai'): void
  signal?: AbortSignal
}

export type DecideResult =
  | { ok: true; view: DecisionView }
  | { ok: false; error: DecideError }

interface Pending {
  ep: AppEndpoint
  onDecision(msg: Record<string, unknown>): void
  onProgress(stage: unknown): void
}

type Data = Record<string, unknown> & { type: string; id: string }

const ENGINES = ['local', 'ai']

/** 확장 → 앱 판정 요청 클라이언트. 판정에 쓴 구주소·후보·응답은 저장하거나 기록하지 않는다 */
export class DecideClient {
  private apps = new Map<AppEndpoint, AppInfo>()
  private waiters = new Set<() => void>()
  private probes = new Map<string, { ep: AppEndpoint; resolve(): void }>()
  private pending = new Map<string, Pending>()
  private chain: Promise<unknown> = Promise.resolve()
  private ownedTab: number | undefined
  /** 확장이 탭을 연 뒤 앱 프레임이 확장에 연결(포트)된 횟수. 실패 원인 안내에 쓴다 */
  private connectsSinceOpen = 0
  private idleTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private deps: DecideDeps) {}

  // ── 앱 → 확장 메시지 수신 ────────────────────────────────────────────────

  /** 앱 프레임(포트)이 연결되면 곧바로 probe 로 판정 준비 상태를 묻는다. 앱의 최초 ready 를 놓쳤어도 여기서 등록된다 */
  greet(ep: AppEndpoint): void {
    this.connectsSinceOpen++
    try { ep.send({ type: 'probe', id: this.deps.uuid() }) } catch { /* 포트가 이미 닫힘 */ }
  }

  detach(ep: AppEndpoint): void {
    this.apps.delete(ep)
  }

  onAppMessage(ep: AppEndpoint, data: Data): void {
    switch (data.type) {
      case 'ready': return this.onReady(ep, data)
      case 'decision': {
        const p = this.pending.get(data.id)
        if (p && p.ep === ep) p.onDecision(data)
        return
      }
      case 'progress': {
        const p = this.pending.get(data.id)
        if (p && p.ep === ep) p.onProgress(data.stage)
        return
      }
    }
  }

  private onReady(ep: AppEndpoint, data: Data): void {
    const features = data.features
    if (Array.isArray(features) && !features.includes('decide')) return
    const versions = data.supportedVersions
    if (Array.isArray(versions) && !versions.includes(1)) return

    const engines = Array.isArray(data.engines)
      ? data.engines.filter((e): e is string => typeof e === 'string' && ENGINES.includes(e))
      : ['local']
    const lim = (data.limits && typeof data.limits === 'object' ? data.limits : {}) as Record<string, unknown>
    const max = typeof lim.maxCandidates === 'number' && lim.maxCandidates >= 1
      ? Math.min(Math.floor(lim.maxCandidates), DECIDE.maxCandidates)
      : DECIDE.maxCandidates

    // 가장 최근에 알린 프레임이 뒤에 오도록 다시 넣는다
    this.apps.delete(ep)
    this.apps.set(ep, {
      engines,
      maxCandidates: max,
      appVersion: typeof data.appVersion === 'string' ? data.appVersion.slice(0, 32) : undefined,
    })

    this.probes.get(data.id)?.resolve()
    for (const w of [...this.waiters]) w()
  }

  // ── 판정 요청 ────────────────────────────────────────────────────────────

  /** 한 번에 하나씩만 보낸다(앱은 동시에 하나만 처리) */
  decide(req: DecideRequest, opts: DecideOptions): Promise<DecideResult> {
    const run = () => this.run(req, opts)
    const next = this.chain.then(run, run)
    this.chain = next.catch(() => undefined)
    return next
  }

  private async run(req: DecideRequest, opts: DecideOptions): Promise<DecideResult> {
    const fail = (error: DecideError): DecideResult => ({ ok: false, error })
    if (opts.signal?.aborted) return fail(decideError('cancelled', '취소되었습니다'))

    clearTimeout(this.idleTimer)
    const app = await this.ensureApp(opts)
    if ('error' in app) {
      this.scheduleIdleClose()
      return fail(app.error)
    }
    if (opts.signal?.aborted) return fail(decideError('cancelled', '취소되었습니다'))

    if (req.engine === 'ai' && !app.info.engines.includes('ai')) {
      this.scheduleIdleClose()
      return fail(decideError('ai_unavailable', '앱에서 AI 판정을 쓸 수 없습니다'))
    }

    const candidates = req.candidates.slice(0, app.info.maxCandidates)
    const result = await this.roundTrip(app.ep, req, candidates, opts)
    this.scheduleIdleClose()
    return result
  }

  private roundTrip(
    ep: AppEndpoint,
    req: DecideRequest,
    candidates: DecideRequest['candidates'],
    opts: DecideOptions,
  ): Promise<DecideResult> {
    const id = this.deps.uuid()
    const refs = candidates.map((c) => c.ref)

    return new Promise((resolve) => {
      let done = false
      const finish = (r: DecideResult) => {
        if (done) return
        done = true
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        this.pending.delete(id)
        resolve(r)
      }
      const cancelApp = () => ep.send({ type: 'cancel', id })

      const timer = setTimeout(() => {
        cancelApp()
        finish({ ok: false, error: decideError('timeout', '앱이 시간 안에 판정하지 못했습니다') })
      }, req.timeoutMs)

      const onAbort = () => {
        cancelApp()
        finish({ ok: false, error: decideError('cancelled', '취소되었습니다') })
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      this.pending.set(id, {
        ep,
        onDecision: (msg) => {
          const v = validateDecision(msg, refs, opts.thresholds ?? DEFAULT_THRESHOLDS)
          finish(v.ok ? { ok: true, view: v.view } : { ok: false, error: v.error })
        },
        onProgress: (stage) => {
          if (stage === 'scoring' || stage === 'asking_ai') opts.onStage?.(stage)
        },
      })

      ep.send({
        type: 'decide',
        id,
        query: {
          oldAddr: req.oldAddr,
          ...(req.oldZip ? { oldZip: req.oldZip } : {}),
          ...(req.searchText ? { searchText: req.searchText } : {}),
        },
        candidates,
        options: { engine: req.engine, timeoutMs: req.timeoutMs },
      })
    })
  }

  // ── 앱 탐색과 실행 ───────────────────────────────────────────────────────

  private async ensureApp(opts: DecideOptions): Promise<{ ep: AppEndpoint; info: AppInfo } | { error: DecideError }> {
    const live = await this.findLive(opts.preferTabId)
    if (live) return live

    if (!opts.appUrl) {
      return { error: decideError('app_unavailable', '열려 있는 앱이 없습니다. 앱을 열어 두거나 설정에서 앱 주소를 입력하세요') }
    }

    opts.onStage?.('connecting')
    this.connectsSinceOpen = 0
    try {
      this.ownedTab = await this.deps.openTab(opts.appUrl)
    } catch {
      return { error: decideError('app_unavailable', '앱을 열지 못했습니다') }
    }

    opts.onStage?.('waiting')
    const total = this.deps.readyTimeoutMs ?? DECIDE.appReadyTimeoutMs
    const firstWait = Math.min(this.deps.foregroundAfterMs ?? DECIDE.foregroundAfterMs, total)
    let found = await this.waitReady(firstWait, opts.signal)
    // 백그라운드 탭은 로딩이 늦거나 멈출 수 있어, 준비되지 않으면 탭을 앞으로 가져와 남은 시간 동안 더 기다린다
    if (!found && !opts.signal?.aborted && total > firstWait && this.ownedTab !== undefined && this.deps.activateTab) {
      try { await this.deps.activateTab(this.ownedTab) } catch { /* 이미 닫힘 */ }
      found = await this.waitReady(total - firstWait, opts.signal)
    }
    if (!found) {
      const connected = this.connectsSinceOpen > 0
      await this.closeOwned()
      const aborted = opts.signal?.aborted
      return {
        error: aborted
          ? decideError('cancelled', '취소되었습니다')
          : decideError('app_unavailable', connected
            ? '앱 화면은 열렸지만 판정 준비 응답이 없습니다. 앱이 후보 판정 기능을 지원하는 버전인지 확인하세요'
            : '앱 탭은 열렸지만 확장이 앱 화면에 연결되지 못했습니다. claude.ai 로그인 상태와 앱 주소를 확인하고, 앱이 화면에 보이는지 확인하세요'),
      }
    }
    return found
  }

  /** 이미 알려 온 프레임 중 probe 에 응답하는 가장 최근 것 */
  private async findLive(preferTabId?: number): Promise<{ ep: AppEndpoint; info: AppInfo } | undefined> {
    // 가장 최근 것부터, 단 사용자가 보고 있는 탭의 프레임이 있으면 그것을 먼저 확인한다
    const order = [...this.apps].reverse().map(([ep]) => ep)
    if (preferTabId !== undefined) order.sort((a, b) => Number(b.tabId === preferTabId) - Number(a.tabId === preferTabId))
    for (const ep of order) {
      if (await this.probe(ep)) {
        const info = this.apps.get(ep)
        if (info) return { ep, info }
      }
      this.apps.delete(ep)
    }
    return undefined
  }

  private probe(ep: AppEndpoint): Promise<boolean> {
    const id = this.deps.uuid()
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.probes.delete(id); resolve(false) }, DECIDE.probeTimeoutMs)
      this.probes.set(id, { ep, resolve: () => { clearTimeout(timer); this.probes.delete(id); resolve(true) } })
      try { ep.send({ type: 'probe', id }) } catch { clearTimeout(timer); this.probes.delete(id); resolve(false) }
    })
  }

  private waitReady(ms: number, signal?: AbortSignal): Promise<{ ep: AppEndpoint; info: AppInfo } | undefined> {
    return new Promise((resolve) => {
      const check = () => {
        const last = [...this.apps].pop()
        if (!last) return
        cleanup()
        resolve({ ep: last[0], info: last[1] })
      }
      const onAbort = () => { cleanup(); resolve(undefined) }
      const timer = setTimeout(() => { cleanup(); resolve(undefined) }, ms)
      const cleanup = () => {
        clearTimeout(timer)
        this.waiters.delete(check)
        signal?.removeEventListener('abort', onAbort)
      }
      this.waiters.add(check)
      signal?.addEventListener('abort', onAbort, { once: true })
      check()
    })
  }

  // ── 확장이 연 탭 정리 ────────────────────────────────────────────────────

  /** 판정이 끝나면 확장이 연 탭만 일정 시간 뒤 닫는다(연속 판정에서 재사용). 사용자가 연 탭은 건드리지 않는다 */
  private scheduleIdleClose(): void {
    if (this.ownedTab === undefined) return
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => void this.closeOwned(), this.deps.idleCloseMs ?? DECIDE.idleCloseMs)
  }

  private async closeOwned(): Promise<void> {
    const id = this.ownedTab
    this.ownedTab = undefined
    if (id === undefined) return
    for (const [ep] of this.apps) if (ep.tabId === id) this.apps.delete(ep)
    try { await this.deps.closeTab(id) } catch { /* 이미 닫힘 */ }
  }
}
