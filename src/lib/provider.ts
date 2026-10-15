// 조회처 선택 계층: 팝업 검색과 프로토콜 lookup 이 함께 쓴다.
import type { SearchMode, SearchPage, Source } from './search'

/** 한 조회처에서 한 페이지를 가져와 정규화까지 마친 결과를 돌려주는 함수 */
export type PageFetcher = (keyword: string, pageIdx: number, pageSize: number, signal?: AbortSignal) => Promise<SearchPage>

export type Fetchers = Record<Source, PageFetcher>

/** 구우편번호(6자리 숫자, 하이픈 허용)로만 된 검색어. 우체국몰만 지원한다 */
export function isOldZipQuery(keyword: string): boolean {
  return /^\d{3}-?\d{3}$/.test(keyword.trim())
}

/**
 * mode 에 따라 조회처를 고른다.
 * - epost / juso: 해당 조회처만. 단 구우편번호 검색어는 항상 epost(juso 는 지원하지 않음)
 * - auto: 우체국 먼저. 첫 페이지가 비었거나 실패하면 juso 로 대체(실패는 juso 도 실패하면 우체국 오류를 던짐)
 *   2페이지 이후는 호출자가 첫 페이지의 source 로 mode 를 고정해서 부른다.
 */
export async function searchPage(
  fetchers: Fetchers,
  keyword: string,
  pageIdx: number,
  pageSize: number,
  mode: SearchMode,
  signal?: AbortSignal,
): Promise<SearchPage> {
  if (isOldZipQuery(keyword)) return fetchers.epost(keyword, pageIdx, pageSize, signal)
  if (mode === 'epost' || mode === 'juso') return fetchers[mode](keyword, pageIdx, pageSize, signal)

  let epostError: unknown
  try {
    const page = await fetchers.epost(keyword, pageIdx, pageSize, signal)
    if (page.results.length > 0 || pageIdx > 1) return page
  } catch (err) {
    if (signal?.aborted) throw err
    epostError = err
  }

  try {
    return await fetchers.juso(keyword, pageIdx, pageSize, signal)
  } catch (err) {
    if (epostError !== undefined) throw epostError
    throw err
  }
}
