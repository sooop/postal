// 단서 분해 → 다중 검색 → 병합·점수화를 묶는 검색 계층. 조회처는 provider 를 통해 부른다.
import { cleanInput } from '../input'
import { isOldZipQuery, searchPage, type Fetchers } from '../provider'
import type { SearchMode, ZipcodeResult } from '../search'
import { buildQueries, hasOnlyZip } from './plan'
import { parseInput, type ParsedInput } from './parse'
import { isConfident, rankResults, type LearnedRef, type RankedCandidate, type Weights } from './rank'

export interface SmartOptions {
  mode?: SearchMode
  /** 검색어 하나당 가져올 개수 */
  pageSize?: number
  /** 확신이 서면 남은 검색어를 건너뛴다 */
  stopWhenConfident?: boolean
  weights?: Weights
  /** 사용자가 기억한 선택(후보에 있으면 가점) */
  learned?: readonly LearnedRef[]
  /** 입력 분석으로 만든 검색어 뒤에 덧붙일 검색어(예: 호출자가 이미 만든 검색어) */
  extraQueries?: readonly string[]
  /** 이 시각(ms, now() 기준)이 지나면 새 검색어를 시작하지 않는다. 한 검색어는 끝까지 마친다 */
  deadline?: number
  now?: () => number
  signal?: AbortSignal
  /** 요청 사이 간격 대기(우체국 요청 간격 준수) */
  throttle?: () => Promise<void>
  onQuery?: (query: string, index: number, total: number) => void
}

export interface SmartResult {
  parsed: ParsedInput
  queries: string[]
  ranked: RankedCandidate[]
  confident: boolean
  /** 실제로 수행한 검색어 수 */
  queriesRun: number
}

const MAX_QUERIES = 9

/** 한 검색어를 조회처에 보낸다. 'auto' 는 우체국·도로명주소를 모두 조회해 합친다(한쪽만으로는 정답이 빠지는 입력이 있다) */
async function fetchBoth(fetchers: Fetchers, keyword: string, mode: SearchMode, pageSize: number, o: SmartOptions): Promise<ZipcodeResult[]> {
  const out: ZipcodeResult[] = []
  // 구우편번호 검색어는 우체국몰만 지원하므로 한 번만 보낸다
  const modes: SearchMode[] = mode === 'auto' && !isOldZipQuery(keyword) ? ['epost', 'juso'] : [mode === 'auto' ? 'epost' : mode]
  const errors: unknown[] = []
  for (const m of modes) {
    await o.throttle?.()
    if (o.signal?.aborted) throw o.signal.reason
    try {
      const page = await searchPage(fetchers, keyword, 1, pageSize, m, o.signal)
      out.push(...page.results)
    } catch (err) {
      if (o.signal?.aborted) throw err
      errors.push(err)
    }
  }
  // 모든 조회처가 실패했을 때만 오류로 본다(한쪽만 실패하면 다른 쪽 결과로 이어간다)
  if (errors.length === modes.length) throw errors[0]
  return out
}

export async function smartSearch(fetchers: Fetchers, raw: string, o: SmartOptions = {}): Promise<SmartResult> {
  const parsed = parseInput(raw)
  const mode = o.mode ?? 'auto'
  const pageSize = o.pageSize ?? 30
  const now = o.now ?? Date.now
  const base = hasOnlyZip(parsed) ? [`${parsed.oldZip!.slice(0, 3)}-${parsed.oldZip!.slice(3)}`] : buildQueries(parsed)
  const queries = [...base]
  for (const q of o.extraQueries ?? []) {
    const t = cleanInput(q)
    if (t.length >= 2 && !queries.includes(t)) queries.push(t)
  }
  queries.splice(MAX_QUERIES)

  const lists: ZipcodeResult[][] = []
  let ranked: RankedCandidate[] = []
  let queriesRun = 0
  let firstError: unknown
  for (let i = 0; i < queries.length; i++) {
    if (o.deadline !== undefined && queriesRun > 0 && now() > o.deadline) break
    o.onQuery?.(queries[i], i, queries.length)
    try {
      lists.push(await fetchBoth(fetchers, queries[i], mode, pageSize, o))
    } catch (err) {
      if (o.signal?.aborted) throw err
      firstError ??= err
      continue
    }
    queriesRun++
    ranked = rankResults(parsed, lists, o.weights, o.learned)
    if (o.stopWhenConfident && isConfident(ranked) && queriesRun >= 2) break
  }
  // 어느 검색어도 성공하지 못했다면 빈 결과가 아니라 오류로 알린다(차단·네트워크 문제를 "결과 없음"으로 오해하지 않도록)
  if (queriesRun === 0 && firstError !== undefined) throw firstError
  return { parsed, queries, ranked, confident: isConfident(ranked), queriesRun }
}
