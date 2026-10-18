import { runLookup, toBridgeError, type LookupDeps } from '@/lib/lookup'
import { ERRORS, LIMITS, type BridgeError, type LookupRequest } from '@/lib/protocol'
import type { SearchPage, Source } from '@/lib/search'
import type { RequestQueue } from './queue'

export interface RunDeps {
  queue: RequestQueue
  /** 우체국 호출. signal 로 중단된다 */
  fetchPage(keyword: string, pageIdx: number, pageSize: number, source: Source, signal: AbortSignal): Promise<SearchPage>
  now(): number
}

export type RunOutcome =
  | { ok: true; candidates: unknown; meta: object }
  | { ok: false; error: BridgeError; meta?: object }

/**
 * 큐에 넣어 조회를 실행하고 공통 결과로 돌려준다. v1 세션과 허브 플러그인이 같은 큐를 거치므로
 * 우체국 요청 간격 규칙이 경로와 무관하게 지켜진다. key 로 queue.cancel 할 수 있다.
 */
export async function runQueued(
  deps: RunDeps,
  key: string,
  req: LookupRequest,
  onProgress: (stage: string, detail?: string) => void,
): Promise<RunOutcome> {
  const outcome = await deps.queue.enqueue(key, req.timeoutMs, async ({ signal, throttle }) => {
    const lookupDeps: LookupDeps = {
      fetchPage: (kw, idx, size, source) => deps.fetchPage(kw, idx, size, source, signal),
      throttle,
      onProgress: (stage, detail) => !signal.aborted && onProgress(stage, detail),
      now: deps.now,
    }
    return runLookup(req, lookupDeps, signal)
  })

  switch (outcome.status) {
    case 'ok': {
      const r = outcome.value
      return r.ok
        ? { ok: true, candidates: r.candidates, meta: r.meta }
        : { ok: false, error: r.error, ...(r.meta ? { meta: r.meta } : {}) }
    }
    case 'cancelled': return { ok: false, error: ERRORS.cancelled() }
    case 'timeout': return { ok: false, error: ERRORS.timeout() }
    case 'full': return { ok: false, error: ERRORS.rate_limited(LIMITS.minIntervalMs * LIMITS.maxQueue) }
    case 'error': return { ok: false, error: toBridgeError(outcome.error) }
  }
}
