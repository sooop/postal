// 행정안전부 도로명주소 안내시스템(juso.go.kr) 키워드 검색.
// 호스트와 경로는 고정이며 입력은 keyword 로만 사용한다. 사이트가 쓰는 요청 필드를 줄이면 500 이 나므로 그대로 보낸다.
import { HttpError, readJson } from './epost'
import { ParseFailedError } from './normalize'
import type { SearchPage, ZipcodeResult } from './search'

const ENDPOINT = 'https://juso.go.kr/api/solr/solrKeywordSearch'

export async function fetchJusoList(
  keyword: string,
  pageIdx = 1,
  pageSize = 10,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keyword,
      strSearchType: 'HSTRY',
      strFirstSort: 'none',
      strAblYn: 'N',
      strAotYn: 'N',
      strSynnYn: null,
      strHstryYn: 'Y',
      reqFrom: 'RN_SEARCH_KOR_MAP',
      checkMoblieYn: 'N',
      strFunctionName: 'Y',
      pageable: { page: Math.max(0, pageIdx - 1), size: pageSize },
    }),
    credentials: 'omit',
    signal,
  })

  if (!response.ok) {
    const secs = Number(response.headers.get('Retry-After'))
    throw new HttpError(response.status, Number.isFinite(secs) && secs > 0 ? secs * 1000 : undefined)
  }
  return readJson(response)
}

export interface JusoRow {
  zipCl?: string
  schKorRoadNm?: string
  siNm?: string
  sggNm?: string
  emdNm?: string
  riNm?: string
  lndnMaSn?: number
  lndnSbSn?: number
  mtYn?: string
  bdNm?: string
  detBdNm?: string
}

const clean = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim()

/** "경기도 오산시 여계산로 7 (금암동, 건물)" → 본문과 괄호 안 조각 */
function splitParen(addr: string): { base: string; parts: string[] } {
  const m = addr.match(/^(.*?)\s*\((.*)\)\s*$/)
  if (!m) return { base: addr, parts: [] }
  return { base: clean(m[1]), parts: m[2].split(',').map(clean).filter(Boolean) }
}

export function normalizeJusoRow(row: JusoRow): ZipcodeResult | null {
  const zipcode = clean(row.zipCl)
  if (!/^\d{5}$/.test(zipcode)) return null

  const { base: road, parts } = splitParen(clean(row.schKorRoadNm))
  if (!road) return null

  const sido = clean(row.siNm)
  const sgg = clean(row.sggNm)
  const emd = clean(row.emdNm)
  const ri = clean(row.riNm)
  const main = Number(row.lndnMaSn)
  const sub = Number(row.lndnSbSn)

  // 지번은 필드를 조합한다(원문에는 건물명이 뒤에 붙어 있다)
  let jibunAddress = ''
  if (Number.isFinite(main) && main > 0) {
    const lot = `${clean(row.mtYn) === '1' ? '산' : ''}${main}${sub > 0 ? `-${sub}` : ''}`
    jibunAddress = [sido, sgg, emd, ri, lot].filter(Boolean).join(' ')
  }

  const bd = clean(row.bdNm)
  const det = clean(row.detBdNm)
  // 건물명 우선. 없으면 도로명 괄호 안의 (동 제외) 조각
  const dong = parts[0] && /[동읍면리가]$/.test(parts[0]) ? 1 : 0
  const detail = bd || (det && det !== '-' ? det : '') || parts.slice(dong).join(', ')

  return {
    zipcode,
    roadAddress: road,
    jibunAddress,
    detail: detail || undefined,
    buildingName: bd || undefined,
    dongText: det && det !== '-' ? det : undefined,
    kind: '도로명',
    source: 'juso',
  }
}

/** solrKeywordSearch 응답을 검증하고 정규화한다. pageIdx 는 1부터 */
export function normalizeJusoPage(json: unknown, pageIdx: number, pageSize: number): SearchPage {
  const obj = json as { results?: { content?: unknown; totalElements?: unknown } } | null
  const content = obj?.results?.content
  const total = Number(obj?.results?.totalElements)
  if (!obj || typeof obj !== 'object' || !Array.isArray(content) || !Number.isFinite(total)) {
    throw new ParseFailedError()
  }

  const results = (content as JusoRow[])
    .map(normalizeJusoRow)
    .filter((r): r is ZipcodeResult => r !== null)

  return {
    results,
    hasMore: pageIdx * pageSize < total,
    nextTargetRow: pageIdx + 1,
    total,
    source: 'juso',
  }
}
