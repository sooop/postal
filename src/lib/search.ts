export type AddrKind = '도로명' | '지번' | '사서함'

/** 조회처: 우체국몰(epost) 또는 행정안전부 도로명주소(juso) */
export type Source = 'epost' | 'juso'
/** 검색 방식: auto 는 우체국 먼저, 결과가 없거나 실패하면 juso */
export type SearchMode = 'auto' | Source

export interface ZipcodeResult {
  /** 신우편번호(5자리) */
  zipcode: string
  /** 시도부터 시작하는 도로명주소(건물번호까지). 범위·사서함·도로명 정보가 없는 지번 행은 빈 문자열일 수 있다 */
  roadAddress: string
  /** 시도부터 시작하는 지번주소. 도로명 행은 동까지만 채워진다 */
  jibunAddress: string
  /** 구우편번호(6자리 숫자, 없으면 생략) */
  oldZipcode?: string
  /** 건물명 등 참고 정보 */
  detail?: string
  kind?: AddrKind
  /** 번지 범위(예: 736~737)나 사서함 범위 행 */
  range?: boolean
  source?: Source
  /** 건물(단지)명 */
  buildingName?: string
  /** 단지 안 동 목록 원문(예: '101동~103동,105동~108동', '1동, 2동') */
  dongText?: string
  /** 입력 분석 검색(smartSearch)에서 매긴 점수와 근거 */
  match?: MatchInfo
}

export interface MatchInfo {
  score: number
  why: string[]
}

export interface SearchPage {
  results: ZipcodeResult[]
  hasMore: boolean
  /** 다음에 요청할 페이지 번호(pageIdx) */
  nextTargetRow: number
  /** 우체국이 알려준 전체 건수 */
  total?: number
  /** 실제로 조회한 곳(auto 에서 대체됐으면 juso) */
  source: Source
}

export type SearchResponse =
  | { ok: true; page: SearchPage }
  | { ok: false; error: string }

export type SmartResponse =
  | { ok: true; results: ZipcodeResult[]; confident: boolean; queries: string[]; queriesRun: number }
  | { ok: false; error: string }

/** 입력을 분석해 여러 검색어로 조회하고 점수순으로 돌려받는다(service worker 가 수행) */
export async function smartSearchZipcode(query: string, mode: SearchMode = 'auto', learned: { zip5: string; road: string }[] = []): Promise<Extract<SmartResponse, { ok: true }>> {
  const res = (await chrome.runtime.sendMessage({ target: 'background', type: 'smart-search', query, mode, learned })) as SmartResponse | undefined
  if (!res) throw new Error('확장 백그라운드가 응답하지 않습니다')
  if (!res.ok) throw new Error(res.error)
  return res
}

/** 팝업은 직접 fetch 하지 않고 service worker 에 조회를 위임한다. */
export async function searchZipcode(query: string, targetRow = 1, mode: SearchMode = 'auto'): Promise<SearchPage> {
  const res = (await chrome.runtime.sendMessage({
    target: 'background',
    type: 'search',
    query,
    targetRow,
    mode,
  })) as SearchResponse | undefined

  if (!res) throw new Error('확장 백그라운드가 응답하지 않습니다')
  if (!res.ok) throw new Error(res.error)
  return res.page
}
