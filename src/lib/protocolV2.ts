// 허브(claude-ex) 경유 web.query 어댑터의 조회 변환·오류 변환. v2 봉투와 hello 는 허브가 맡으므로 여기에 없다.
// 허브와의 계약(등록·호출 포트)은 @claude-ex/sdk, 어댑터 선언은 src/plugin/catalog.ts.
import { V2_ERRORS, type V2Error } from '@claude-ex/sdk'
import { LIMITS, type BridgeError, type LookupRequest, type LookupSource } from './protocol'

/** v1 오류를 v2 코드로 옮긴다. v2 에 없는 코드는 가장 가까운 코드로 매핑한다 */
export function toV2Error(e: BridgeError): V2Error {
  switch (e.code) {
    case 'unsupported_query': return { code: 'invalid_request', message: e.message, retryable: false }
    case 'rate_limited': return { code: 'busy', message: e.message, retryable: true, ...(e.retryAfterMs ? { detail: { retryAfterMs: e.retryAfterMs } } : {}) }
    default: return { code: e.code, message: e.message, retryable: e.retryable }
  }
}

/** web.query 어댑터 id → v1 조회처. 허용 도메인은 fetchers 가 고정하고 있다 */
export const WEB_QUERY_ADAPTERS = {
  'epost-zip': 'epost',
  'juso-addr': 'juso',
  'zip-auto': 'auto',
} as const satisfies Record<string, LookupSource>
export type WebQueryAdapter = keyof typeof WEB_QUERY_ADAPTERS

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/**
 * web.query 어댑터 호출 `{adapter, params:{searchText?, oldAddr?, oldZip?, limit?, analyze?}}` 를 v1 조회 요청으로 바꾼다.
 * 허브와 SDK 가 스키마로 먼저 검증하지만, 스키마로 표현하지 못하는 검사(필수 조합, oldZip 형식)와 방어를 여기서 한다.
 */
export function toLookupRequest(adapter: string, params: unknown, timeoutMs: number):
  { ok: true; req: LookupRequest } | { ok: false; error: V2Error } {
  const bad = (m: string) => ({ ok: false as const, error: V2_ERRORS.invalid_request(m) })

  if (!Object.prototype.hasOwnProperty.call(WEB_QUERY_ADAPTERS, adapter)) return bad('adapter 형식 오류')
  const source = WEB_QUERY_ADAPTERS[adapter as WebQueryAdapter]

  const p = params
  if (!isObj(p)) return bad('params 가 없습니다')
  if (Object.keys(p).some((k) => !['searchText', 'oldAddr', 'oldZip', 'limit', 'analyze'].includes(k))) return bad('알 수 없는 params 필드')

  const text = (name: 'searchText' | 'oldAddr'): string | undefined | null => {
    const v = p[name]
    if (v === undefined) return undefined
    if (typeof v !== 'string' || v.length > LIMITS.maxTextLen) return null
    return v.trim() || undefined
  }
  const searchText = text('searchText')
  const oldAddr = text('oldAddr')
  if (searchText === null) return bad(`searchText 형식 오류(${LIMITS.maxTextLen}자 이하 문자열)`)
  if (oldAddr === null) return bad(`oldAddr 형식 오류(${LIMITS.maxTextLen}자 이하 문자열)`)

  let oldZip: string | undefined
  if (p.oldZip !== undefined) {
    if (typeof p.oldZip !== 'string' || !/^\d{6}$/.test(p.oldZip)) return bad('oldZip 형식 오류(6자리 숫자)')
    oldZip = p.oldZip
  }
  if (!searchText && !oldAddr && !oldZip) return bad('searchText, oldAddr, oldZip 중 하나가 필요합니다')

  let limit: number = LIMITS.defaultLimit
  if (p.limit !== undefined) {
    if (typeof p.limit !== 'number' || !Number.isInteger(p.limit) || p.limit < 1) return bad('limit 형식 오류')
    limit = Math.min(p.limit, LIMITS.maxLimit)
  }
  let analyze = true
  if (p.analyze !== undefined) {
    if (typeof p.analyze !== 'boolean') return bad('analyze 형식 오류')
    analyze = p.analyze
  }
  return { ok: true, req: { searchText, oldAddr, oldZip, limit, timeoutMs, source, analyze } }
}
