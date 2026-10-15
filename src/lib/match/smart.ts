// 단서 분해 → 다중 검색 → 병합·점수화를 묶는 검색 계층. 조회처는 provider 를 통해 부른다.
import { searchPage, type Fetchers } from '../provider'
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

/** 'auto' 는 검색어마다 우체국·도로명주소를 모두 조회해 합친다(한쪽만으로는 정답이 빠지는 입력이 있다) */
async function fetchBoth(fetchers: Fetchers, keyword: string, mode: SearchMode, pageSize: number, o: SmartOptions): Promise<ZipcodeResult[]> {
  const out: ZipcodeResult[] = []
  const modes: SearchMode[] = mode === 'auto' ? ['epost', 'juso'] : [mode]
  for (const m of modes) {
    await o.throttle?.()
    if (o.signal?.aborted) throw o.signal.reason
    try {
      const page = await searchPage(fetchers, keyword, 1, pageSize, m, o.signal)
      out.push(...page.results)
    } catch (err) {
      if (o.signal?.aborted) throw err
      // 한쪽 조회처 실패는 다른 쪽 결과로 이어간다. 둘 다 실패하면 호출자가 빈 결과를 본다
      if (modes.length === 1) throw err
    }
  }
  return out
}

export async function smartSearch(fetchers: Fetchers, raw: string, o: SmartOptions = {}): Promise<SmartResult> {
  const parsed = parseInput(raw)
  const mode = o.mode ?? 'auto'
  const pageSize = o.pageSize ?? 30
  const queries = hasOnlyZip(parsed) ? [`${parsed.oldZip!.slice(0, 3)}-${parsed.oldZip!.slice(3)}`] : buildQueries(parsed)

  const lists: ZipcodeResult[][] = []
  let ranked: RankedCandidate[] = []
  let queriesRun = 0
  for (let i = 0; i < queries.length; i++) {
    o.onQuery?.(queries[i], i, queries.length)
    lists.push(await fetchBoth(fetchers, queries[i], mode, pageSize, o))
    queriesRun++
    ranked = rankResults(parsed, lists, o.weights, o.learned)
    if (o.stopWhenConfident && isConfident(ranked) && queriesRun >= 2) break
  }
  return { parsed, queries, ranked, confident: isConfident(ranked), queriesRun }
}
