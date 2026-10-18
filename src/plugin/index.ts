// 허브(claude-ex) 동반 플러그인: web.query 어댑터 3개를 허브에 등록하고, 허브가 중계하는 호출을 처리한다.
// 조회는 v1 앱 조회와 같은 큐(runQueued)를 거치므로 우체국 요청 간격 규칙이 유지된다(팝업 검색은 자체 간격을 쓴다).
import {
  PluginError, V2_ERRORS, serveAsCompanion,
  type Companion, type CompanionRuntime, type InvokeContext, type InvokeRequest, type RegisterResponse,
} from '@claude-ex/sdk'
import { LIMITS } from '@/lib/protocol'
import { toLookupRequest, toV2Error } from '@/lib/protocolV2'
import { HUB_ID } from '@/lib/settings'
import { runQueued, type RunDeps } from '@/background/runQueued'
import { postalCatalog } from './catalog'

export interface PluginDeps extends RunDeps {
  /** 큐 항목 자체의 제한 시간. 호출 시간 제한은 허브가 보낸 timeoutMs 를 SDK 가 적용하므로 이 값은 상한 구실만 한다 */
  queueTimeoutMs?: number
}

let callSeq = 0

/** 호출 1건 처리. 성공은 `{ items, lookup? }`, 실패는 PluginError */
export function createHandler(deps: PluginDeps) {
  return async (req: InvokeRequest, ctx: InvokeContext): Promise<unknown> => {
    if (req.op !== 'web.query' || req.adapter === undefined) throw new PluginError(V2_ERRORS.unsupported_op(`지원하지 않는 op: ${req.op}`))

    const queueTimeoutMs = deps.queueTimeoutMs ?? LIMITS.maxTimeoutMs
    const q = toLookupRequest(req.adapter, req.args, queueTimeoutMs)
    if (!q.ok) throw new PluginError(q.error)

    const key = `plugin:${++callSeq}`
    const onAbort = () => { deps.queue.cancel(key) }
    if (ctx.signal.aborted) throw new PluginError(V2_ERRORS.cancelled())
    ctx.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const outcome = await runQueued(deps, key, q.req, (stage, detail) => ctx.progress(stage, detail))
      if (!outcome.ok) throw new PluginError(toV2Error(outcome.error))
      // meta 는 허브가 아니라 조회 정보다(허브가 따로 meta.untrusted 를 붙인다)
      return { items: outcome.candidates, ...(outcome.meta ? { lookup: outcome.meta } : {}) }
    } finally {
      ctx.signal.removeEventListener('abort', onAbort)
    }
  }
}

/** 서비스 워커 시작 시 한 번 부른다. 허브가 없으면 등록은 조용히 무시된다(postal 단독 동작에는 영향 없음) */
export function initPlugin(
  deps: PluginDeps,
  opts: { version: string; runtime?: CompanionRuntime; onRegister?: (r: RegisterResponse | null) => void },
): Companion {
  return serveAsCompanion({
    hubId: HUB_ID,
    name: 'postal',
    version: opts.version,
    catalog: postalCatalog,
    handle: createHandler(deps),
    ...(opts.runtime ? { runtime: opts.runtime } : {}),
    ...(opts.onRegister ? { onRegister: opts.onRegister } : {}),
  })
}
