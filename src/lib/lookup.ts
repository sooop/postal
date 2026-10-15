import { BlockedError, HttpError } from './epost'
import { ParseFailedError, PARSER_VERSION } from './normalize'
import { isOldZipQuery } from './provider'
import {
  ERRORS,
  type BridgeError, type Candidate, type LookupMeta, type LookupRequest,
} from './protocol'
import type { SearchPage, Source, ZipcodeResult } from './search'

const LOOKUP_PAGE_SIZE = 20
const MAX_PAGES = 10

export type ProgressStage = 'searching' | 'fetching_page' | 'parsing'

export interface LookupDeps {
  /** 한 조회처의 한 페이지를 가져와 정규화까지 마친 결과 */
  fetchPage(keyword: string, pageIdx: number, pageSize: number, source: Source): Promise<SearchPage>
  /** 우체국 요청 사이의 최소 간격을 지키도록 대기 */
  throttle(): Promise<void>
  onProgress?(stage: ProgressStage, detail?: string): void
  now(): number
}

export type LookupOutcome =
  | { ok: true; candidates: Candidate[]; meta: LookupMeta }
  | { ok: false; error: BridgeError; meta?: FailureMeta }

/** 실패 응답에 싣는 진단 값(조회처 화면 변경 원인 파악용) */
export interface FailureMeta {
  source: Source
  parserVersion: string
  queryUsed: string
}

const DONG = /[가-힣][가-힣0-9]*(?:동|리|가|읍|면)/
const ROAD = /[가-힣][가-힣0-9]*(?:로|길)/
const NUM = String.raw`(?:산\s*)?\d+(?:-\d+)?`

/** 구주소 원문에서 "동/리 + 번지" 검색어를 뽑는다. 없으면 도로명 + 번호, 그래도 없으면 undefined */
export function extractSearchText(oldAddr: string): string | undefined {
  for (const unit of [DONG, ROAD]) {
    const m = oldAddr.match(new RegExp(`(${unit.source})\\s*(${NUM})`))
    if (m) return `${m[1]} ${m[2].replace(/\s+/g, '')}`
  }
  return undefined
}

/** 실제로 조회처에 보낼 검색어. 쓸 수 있는 입력이 없으면 undefined */
export function resolveKeyword(req: LookupRequest): string | undefined {
  if (req.searchText) return req.searchText
  if (req.oldAddr) {
    const extracted = extractSearchText(req.oldAddr)
    if (extracted) return extracted
  }
  return req.oldZip
}

function toCandidate(r: ZipcodeResult): Candidate | null {
  if (r.range || !r.roadAddress || !/^\d{5}$/.test(r.zipcode)) return null
  const c: Candidate = { zip5: r.zipcode, road: r.roadAddress }
  if (r.jibunAddress) c.jibun = r.jibunAddress
  if (r.detail) c.detail = r.detail
  if (r.oldZipcode) c.oldZip = r.oldZipcode
  return c
}

/** zip5 와 road 가 모두 같은 후보는 하나만 남긴다(처음 것 유지) */
export function toCandidates(results: ZipcodeResult[]): Candidate[] {
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const r of results) {
    const c = toCandidate(r)
    if (!c) continue
    const key = `${c.zip5}|${c.road}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

/** 중단 사유(signal.reason)와 예외 종류를 프로토콜 오류로 바꾼다 */
export function toBridgeError(err: unknown, signal?: AbortSignal): BridgeError {
  if (signal?.aborted) {
    return signal.reason === 'timeout' ? ERRORS.timeout() : ERRORS.cancelled()
  }
  if (err instanceof BlockedError) return ERRORS.blocked()
  if (err instanceof HttpError) {
    if (err.status === 429) return ERRORS.rate_limited(err.retryAfterMs)
    if (err.status === 401 || err.status === 403) return ERRORS.blocked()
    return ERRORS.network(`조회처 서버 오류(${err.status})`)
  }
  if (err instanceof ParseFailedError || err instanceof SyntaxError) return ERRORS.parse_failed()
  if (err instanceof TypeError) return ERRORS.network()
  return ERRORS.internal()
}

const isRetryable = (err: unknown): boolean =>
  err instanceof TypeError || (err instanceof HttpError && err.status >= 500)

interface SourceResult {
  candidates: Candidate[]
  total: number
  hasMore: boolean
}

export async function runLookup(
  req: LookupRequest,
  deps: LookupDeps,
  signal: AbortSignal,
): Promise<LookupOutcome> {
  const keyword = resolveKeyword(req)
  if (!keyword) {
    return { ok: false, error: ERRORS.unsupported_query('검색어를 만들 수 없는 입력입니다(동·리 + 번지를 입력해 주세요)') }
  }
  // 도로명주소(juso)는 구우편번호 검색을 지원하지 않는다
  if (req.source === 'juso' && isOldZipQuery(keyword)) {
    return { ok: false, error: ERRORS.unsupported_query('도로명주소 조회는 구우편번호 검색을 지원하지 않습니다') }
  }

  let current: Source = req.source === 'juso' ? 'juso' : 'epost'

  const fetchOnce = async (page: number) => {
    try {
      return await deps.fetchPage(keyword, page, LOOKUP_PAGE_SIZE, current)
    } catch (err) {
      // 내부 자동 재시도는 네트워크성 오류에 한해 최대 1회
      if (!isRetryable(err) || signal.aborted) throw err
      await deps.throttle()
      return deps.fetchPage(keyword, page, LOOKUP_PAGE_SIZE, current)
    }
  }

  const collect = async (): Promise<SourceResult> => {
    const collected: ZipcodeResult[] = []
    let candidates: Candidate[] = []
    let total = 0
    let hasMore = false

    for (let page = 1; page <= MAX_PAGES; page++) {
      await deps.throttle()
      if (signal.aborted) throw signal.reason
      if (page === 1) deps.onProgress?.('searching')
      else deps.onProgress?.('fetching_page', `${page}/${Math.ceil(total / LOOKUP_PAGE_SIZE)}`)

      const p = await fetchOnce(page)
      if (signal.aborted) throw signal.reason

      deps.onProgress?.('parsing')
      total = p.total ?? 0
      hasMore = p.hasMore
      collected.push(...p.results)
      candidates = toCandidates(collected)

      if (candidates.length >= req.limit || !hasMore) break
    }
    return { candidates, total, hasMore }
  }

  try {
    let r = await collect()

    // auto: 우체국에 후보가 없으면 도로명주소(juso)로 한 번 더 조회한다(구우편번호 검색어는 제외)
    if (req.source === 'auto' && current === 'epost' && r.candidates.length === 0 && !isOldZipQuery(keyword)) {
      current = 'juso'
      r = await collect()
    }

    return {
      ok: true,
      candidates: r.candidates.slice(0, req.limit),
      meta: {
        source: current,
        fetchedAt: deps.now(),
        parserVersion: PARSER_VERSION,
        queryUsed: keyword,
        total: r.total,
        truncated: r.candidates.length > req.limit || r.hasMore,
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: toBridgeError(err, signal),
      meta: { source: current, parserVersion: PARSER_VERSION, queryUsed: keyword },
    }
  }
}
