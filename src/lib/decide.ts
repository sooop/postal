// 후보 판정(decide) 프로토콜의 공용 정의·검증. 명세: docs/protocol-v1-decide.md
import { isConfident } from './match/rank'
import type { ZipcodeResult } from './search'

export const DECIDE = {
  maxCandidates: 20,
  defaultTimeoutMs: 60000,
  probeTimeoutMs: 2000,
  appReadyTimeoutMs: 30000,
  foregroundAfterMs: 10000,
  idleCloseMs: 30000,
  sumTolerance: 0.011,
  maxReasonChars: 80,
  maxSummaryChars: 200,
} as const

export type Engine = 'local' | 'ai' | 'auto'

export interface CandidateInput {
  /** 이 요청 안에서 유일한 식별자(c0, c1, …) */
  ref: string
  zip5: string
  road: string
  jibun?: string
  detail?: string
  oldZip?: string
  prior?: { preferred: boolean; confirmedCount: number }
  /** 건물(단지)명 — v1 호환 추가 필드, 앱이 모르면 무시한다 */
  name?: string
  /** 단지 안 동 목록 원문(예: '101동~103동,105동~108동') */
  dongs?: string
  /** 확장이 입력 분석으로 매긴 로컬 점수와 근거(참고용) */
  hint?: { score: number; why: string[] }
}

export interface DecideRequest {
  oldAddr: string
  oldZip?: string
  searchText?: string
  candidates: CandidateInput[]
  engine: Engine
  timeoutMs: number
}

export type DecideErrorCode =
  | 'invalid_request' | 'busy' | 'ai_unavailable' | 'timeout' | 'cancelled' | 'internal'
  | 'app_unavailable' | 'disabled'

export interface DecideError {
  code: DecideErrorCode
  message: string
  retryable: boolean
}

const KNOWN_CODES: readonly string[] = [
  'invalid_request', 'busy', 'ai_unavailable', 'timeout', 'cancelled', 'internal',
]
const RETRYABLE: readonly string[] = ['busy', 'timeout']

export const decideError = (code: DecideErrorCode, message: string): DecideError =>
  ({ code, message, retryable: RETRYABLE.includes(code) })

/** 앱이 보낸 error 객체를 안전하게 DecideError 로 바꾼다(모르는 코드는 internal) */
export function toDecideError(raw: unknown): DecideError {
  const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const code = (typeof e.code === 'string' && KNOWN_CODES.includes(e.code) ? e.code : 'internal') as DecideErrorCode
  const message = typeof e.message === 'string' ? e.message.slice(0, 200) : '앱 판정 오류'
  return decideError(code, message)
}

export type Dong = 'match' | 'mismatch' | 'unknown'
export type Bunji = 'exact' | 'near' | 'different' | 'unknown'
export type OldZipSignal = 'match' | 'mismatch' | 'unknown'

export interface Signals {
  dong?: Dong
  bunji?: Bunji
  oldZip?: OldZipSignal
}

export interface ScoreView {
  ref: string
  p: number
  reason?: string
  signals?: Signals
}

export interface DecisionView {
  /** p 내림차순 */
  scores: ScoreView[]
  pNone: number
  summary?: string
  engine: 'local' | 'ai'
  elapsedMs?: number
  /** 확장이 p 로 직접 판단한 추천(없으면 null). 앱의 verdict 는 쓰지 않는다 */
  recommendedRef: string | null
}

export interface Thresholds {
  minP: number
  minGap: number
}

export const DEFAULT_THRESHOLDS: Thresholds = { minP: 0.7, minGap: 0.2 }

/** 최고 p 가 minP 이상이고 2위와 minGap 이상 차이면 추천. 아니면 null */
export function recommend(scores: ScoreView[], th: Thresholds = DEFAULT_THRESHOLDS): string | null {
  const sorted = [...scores].sort((a, b) => b.p - a.p)
  const top = sorted[0]
  if (!top || top.p < th.minP) return null
  const second = sorted[1]?.p ?? 0
  return top.p - second >= th.minGap ? top.ref : null
}

const isProb = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1

const DONG: readonly string[] = ['match', 'mismatch', 'unknown']
const BUNJI: readonly string[] = ['exact', 'near', 'different', 'unknown']

function cleanSignals(raw: unknown): Signals | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: Signals = {}
  if (typeof r.dong === 'string' && DONG.includes(r.dong)) out.dong = r.dong as Dong
  if (typeof r.bunji === 'string' && BUNJI.includes(r.bunji)) out.bunji = r.bunji as Bunji
  if (typeof r.oldZip === 'string' && DONG.includes(r.oldZip)) out.oldZip = r.oldZip as OldZipSignal
  return Object.keys(out).length ? out : undefined
}

const text = (x: unknown, max: number): string | undefined =>
  typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : undefined

export type DecisionValidation =
  | { ok: true; view: DecisionView }
  | { ok: false; error: DecideError }

/** 앱의 decision 응답을 검증한다. 어긋나면 응답을 버린다(후보만 표시) */
export function validateDecision(msg: Record<string, unknown>, refs: readonly string[], th: Thresholds = DEFAULT_THRESHOLDS): DecisionValidation {
  const bad = (why: string): DecisionValidation =>
    ({ ok: false, error: decideError('internal', `앱 응답이 올바르지 않습니다(${why})`) })

  if (msg.ok === false) return { ok: false, error: toDecideError(msg.error) }
  if (msg.ok !== true) return bad('ok 없음')
  if (!Array.isArray(msg.scores)) return bad('scores 없음')

  const expected = new Set(refs)
  const seen = new Set<string>()
  const scores: ScoreView[] = []
  let sum = 0

  for (const raw of msg.scores) {
    if (!raw || typeof raw !== 'object') return bad('scores 항목 형식')
    const s = raw as Record<string, unknown>
    if (typeof s.ref !== 'string' || !expected.has(s.ref)) return bad('알 수 없는 ref')
    if (seen.has(s.ref)) return bad('ref 중복')
    if (!isProb(s.p)) return bad('p 범위')
    seen.add(s.ref)
    sum += s.p
    scores.push({
      ref: s.ref,
      p: s.p,
      reason: text(s.reason, DECIDE.maxReasonChars),
      signals: cleanSignals(s.signals),
    })
  }
  if (seen.size !== expected.size) return bad('ref 누락')
  if (!isProb(msg.pNone)) return bad('pNone 범위')
  if (Math.abs(sum + msg.pNone - 1) > DECIDE.sumTolerance) return bad('확률 합')

  scores.sort((a, b) => b.p - a.p)
  const meta = (msg.meta && typeof msg.meta === 'object' ? msg.meta : {}) as Record<string, unknown>

  return {
    ok: true,
    view: {
      scores,
      pNone: msg.pNone,
      summary: text(msg.summary, DECIDE.maxSummaryChars),
      engine: meta.engine === 'ai' ? 'ai' : 'local',
      elapsedMs: typeof meta.elapsedMs === 'number' && Number.isFinite(meta.elapsedMs) ? meta.elapsedMs : undefined,
      recommendedRef: recommend(scores, th),
    },
  }
}

/** 판정에 보낼 수 있는 후보만 골라 ref 를 붙인다(번지 범위·도로명 없음 제외, 최대 max 건) */
export function prepareCandidates(
  results: readonly ZipcodeResult[],
  max: number = DECIDE.maxCandidates,
  priorOf?: (r: ZipcodeResult) => CandidateInput['prior'] | undefined,
): { candidates: CandidateInput[]; byRef: Record<string, ZipcodeResult> } {
  const candidates: CandidateInput[] = []
  const byRef: Record<string, ZipcodeResult> = {}
  for (const r of results) {
    if (candidates.length >= max) break
    if (r.range || !r.roadAddress || !/^\d{5}$/.test(r.zipcode)) continue
    const ref = `c${candidates.length}`
    const c: CandidateInput = { ref, zip5: r.zipcode, road: r.roadAddress }
    if (r.jibunAddress) c.jibun = r.jibunAddress
    if (r.detail) c.detail = r.detail
    if (r.oldZipcode) c.oldZip = r.oldZipcode
    if (r.buildingName) c.name = r.buildingName.slice(0, MAX_STR)
    if (r.dongText) c.dongs = r.dongText.slice(0, MAX_STR)
    const prior = priorOf?.(r)
    if (prior) c.prior = prior
    if (r.match) c.hint = { score: Math.round(r.match.score * 10) / 10, why: r.match.why.slice(0, 8) }
    candidates.push(c)
    byRef[ref] = r
  }
  return { candidates, byRef }
}

/**
 * 앱(AI) 추천을 확장의 로컬 점수와 대조한다. 로컬이 확신하는 1순위가 있는데 앱 추천이 그것과 다르면
 * 두 신호가 충돌하므로 추천을 보류하고(null) 사용자가 고르게 한다. 로컬 점수가 없으면 앱 추천을 그대로 쓴다.
 */
export function reconcile(
  view: Pick<DecisionView, 'recommendedRef'>,
  byRef: Record<string, ZipcodeResult>,
): { recommendedRef: string | null; conflict: boolean } {
  const entries = Object.entries(byRef)
  if (!view.recommendedRef || entries.length === 0 || entries.some(([, r]) => !r.match)) {
    return { recommendedRef: view.recommendedRef, conflict: false }
  }
  const sorted = entries.map(([ref, r]) => ({ ref, score: r.match!.score })).sort((a, b) => b.score - a.score)
  if (isConfident(sorted) && sorted[0].ref !== view.recommendedRef) return { recommendedRef: null, conflict: true }
  return { recommendedRef: view.recommendedRef, conflict: false }
}

/** 입력 검색어가 구주소 판정에 쓸 수 있는지(숫자만이면 구우편번호 검색이라 판정할 구주소가 없다) */
export function canDecideFrom(query: string): boolean {
  const q = query.trim()
  return q.length > 0 && q.length <= 200 && !/^[\d\s-]+$/.test(q)
}

const MAX_STR = 200

const str = (x: unknown): string | undefined =>
  typeof x === 'string' && x.trim() && x.length <= MAX_STR ? x.trim() : undefined

export type ParsedDecideInput =
  | { ok: true; req: Omit<DecideRequest, 'engine' | 'timeoutMs'> }
  | { ok: false; error: DecideError }

/** 팝업이 보낸 판정 요청의 형태를 검증하고 정리한다(확장 내부 메시지여도 형태는 확인) */
export function parseDecideInput(msg: Record<string, unknown>): ParsedDecideInput {
  const bad = (m: string): ParsedDecideInput => ({ ok: false, error: decideError('invalid_request', m) })

  const q = msg.query as Record<string, unknown> | undefined
  if (!q || typeof q !== 'object') return bad('query 없음')
  const oldAddr = str(q.oldAddr)
  if (!oldAddr) return bad('oldAddr 형식 오류')
  const searchText = q.searchText === undefined ? undefined : str(q.searchText)
  if (q.searchText !== undefined && !searchText) return bad('searchText 형식 오류')
  let oldZip: string | undefined
  if (q.oldZip !== undefined) {
    if (typeof q.oldZip !== 'string' || !/^\d{6}$/.test(q.oldZip)) return bad('oldZip 형식 오류')
    oldZip = q.oldZip
  }

  if (!Array.isArray(msg.candidates) || msg.candidates.length < 1 || msg.candidates.length > DECIDE.maxCandidates) {
    return bad('후보는 1~20건')
  }
  const refs = new Set<string>()
  const candidates: CandidateInput[] = []
  for (const raw of msg.candidates) {
    const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const ref = typeof c.ref === 'string' && c.ref.length > 0 && c.ref.length <= 64 ? c.ref : undefined
    const road = str(c.road)
    if (!ref || refs.has(ref) || !road || typeof c.zip5 !== 'string' || !/^\d{5}$/.test(c.zip5)) return bad('후보 형식 오류')
    refs.add(ref)
    const cand: CandidateInput = { ref, zip5: c.zip5, road }
    const jibun = str(c.jibun), detail = str(c.detail)
    if (jibun) cand.jibun = jibun
    if (detail) cand.detail = detail
    if (typeof c.oldZip === 'string' && /^\d{6}$/.test(c.oldZip)) cand.oldZip = c.oldZip
    const name = str(c.name), dongs = str(c.dongs)
    if (name) cand.name = name
    if (dongs) cand.dongs = dongs
    const h = c.hint as Record<string, unknown> | undefined
    if (h && typeof h.score === 'number' && Number.isFinite(h.score) && Array.isArray(h.why)) {
      cand.hint = { score: h.score, why: h.why.filter((w): w is string => typeof w === 'string' && w.length <= 30).slice(0, 8) }
    }
    const p =c.prior as Record<string, unknown> | undefined
    if (p && typeof p.preferred === 'boolean' && typeof p.confirmedCount === 'number') {
      cand.prior = { preferred: p.preferred, confirmedCount: Math.max(0, Math.floor(p.confirmedCount)) }
    }
    candidates.push(cand)
  }
  return { ok: true, req: { oldAddr, oldZip, searchText, candidates } }
}
