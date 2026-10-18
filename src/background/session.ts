import {
  BRIDGE_SOURCE, ERRORS, FEATURES, LIMITS, PROTOCOL_V,
  isAppEnvelope, validateLookup,
  type BridgeError,
} from '@/lib/protocol'
import type { AppEndpoint, DecideClient } from './decide'
import type { SearchPage, Source } from '@/lib/search'
import { RequestQueue } from './queue'
import { runQueued } from './runQueued'

export interface SessionDeps {
  queue: RequestQueue
  extVersion: string
  /** 우체국 호출. signal 로 중단된다 */
  fetchPage(keyword: string, pageIdx: number, pageSize: number, source: Source, signal: AbortSignal): Promise<SearchPage>
  now(): number
  /** 후보 판정(확장 → 앱) 클라이언트. ready/decision/progress 를 여기로 넘긴다 */
  decide?: DecideClient
}

type Post = (msg: Record<string, unknown>) => void

let sessionSeq = 0

/** 포트(프레임) 하나에 대응하는 프로토콜 처리기. 조회어와 결과는 저장하거나 기록하지 않는다 */
export class BridgeSession implements AppEndpoint {
  private readonly prefix = `s${++sessionSeq}:`
  private active = new Set<string>()

  constructor(private post: Post, private deps: SessionDeps, readonly tabId?: number) {}

  send(msg: Record<string, unknown>) {
    this.post({ source: BRIDGE_SOURCE, v: PROTOCOL_V, ts: this.deps.now(), ...msg })
  }

  private fail(id: string, error: BridgeError) {
    this.send({ type: 'result', id, ok: false, error })
  }

  handle(data: unknown): void {
    if (!isAppEnvelope(data)) return

    switch (data.type) {
      case 'ping':
        if (data.v !== PROTOCOL_V) return
        this.send({
          type: 'pong', id: data.id, ok: true,
          extVersion: this.deps.extVersion,
          supportedVersions: [PROTOCOL_V],
          features: [...FEATURES],
          limits: {
            minIntervalMs: LIMITS.minIntervalMs,
            maxLimit: LIMITS.maxLimit,
            defaultTimeoutMs: LIMITS.defaultTimeoutMs,
          },
        })
        return
      case 'lookup':
        void this.lookup(data)
        return
      case 'cancel':
        if (data.v !== PROTOCOL_V) return
        if (this.active.has(data.id)) this.deps.queue.cancel(this.prefix + data.id)
        return
      case 'ready':
      case 'decision':
      case 'progress':
        // 후보 판정 방향: 앱이 확장에 보내는 메시지
        if (data.v !== PROTOCOL_V) return
        this.deps.decide?.onAppMessage(this, data)
        return
    }
  }

  /** 포트가 닫히면 이 세션의 작업을 모두 중단한다(응답할 곳이 없다) */
  dispose(): void {
    this.deps.decide?.detach(this)
    for (const id of this.active) this.deps.queue.cancel(this.prefix + id)
    this.active.clear()
  }

  private async lookup(data: Record<string, unknown> & { id: string; v: number }) {
    const id = data.id
    if (data.v !== PROTOCOL_V) return this.fail(id, ERRORS.invalid_request(`지원하지 않는 v: ${data.v}`))
    if (this.active.has(id)) return this.fail(id, ERRORS.invalid_request('이미 진행 중인 id 입니다'))

    const v = validateLookup(data)
    if (!v.ok) return this.fail(id, v.error)

    this.active.add(id)
    const outcome = await runQueued(this.deps, this.prefix + id, v.req, (stage, detail) =>
      this.send({ type: 'progress', id, stage, ...(detail ? { detail } : {}) }))
    this.active.delete(id)

    if (outcome.ok) this.send({ type: 'result', id, ok: true, candidates: outcome.candidates, meta: outcome.meta })
    else this.send({ type: 'result', id, ok: false, error: outcome.error, ...(outcome.meta ? { meta: outcome.meta } : {}) })
  }
}
