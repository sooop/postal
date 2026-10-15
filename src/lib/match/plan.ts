// 입력 단서로 검색어 목록을 만든다. 우선순위 순서이며, 있는 단서만 쓴다.
import type { ParsedInput } from './parse'

/** 건물명을 줄인 앞부분(긴 이름이 등록명과 다를 때 쓴다) */
function prefixOf(p: ParsedInput): string {
  const first = p.name.split(' ')[0] ?? ''
  if (first.length >= 3) return first.length > 6 ? first.slice(0, 4) : first
  return p.core.slice(0, 4)
}

const join = (...xs: (string | undefined)[]): string => xs.filter(Boolean).join(' ').trim()

export function buildQueries(p: ParsedInput, max = 8): string[] {
  const sgg = p.sigungu[p.sigungu.length - 1]
  const qs: string[] = []
  const add = (q: string) => { if (q.length >= 2 && !qs.includes(q)) qs.push(q) }

  if (p.roadName && p.roadNo) add(join(sgg, p.roadName, p.roadNo))
  if (p.jibun && p.emd) add(join(sgg, p.emd, p.jibun))
  if (p.core.length >= 2) {
    const pre = prefixOf(p)
    add(join(p.emd, p.name))
    if (sgg) add(join(sgg, p.name))
    add(p.name)
    if (pre && pre !== p.name) { add(join(p.emd, pre)); if (sgg) add(join(sgg, pre)) }
    if (p.core.length >= 6) add(join(p.emd, p.core.slice(-4)))
  }
  // 위 단서가 하나도 없을 때의 마지막 수단: 지역 + 읍면동(범위 행이 많아 후보로는 약하다)
  if (qs.length === 0 && p.emd) add(join(sgg, p.emd, p.jibun))
  // 구우편번호는 후보 풀로만 쓴다(우체국몰 전용, 가장 마지막)
  if (p.oldZip) add(`${p.oldZip.slice(0, 3)}-${p.oldZip.slice(3)}`)
  return qs.slice(0, max)
}

/** 입력 분석 검색을 쓸 수 있는 입력인지(단서가 있고 구우편번호만의 입력이 아님). 아니면 기존 단순 검색을 쓴다 */
export function shouldUseSmart(p: ParsedInput): boolean {
  return !hasOnlyZip(p) && buildQueries(p).length > 0
}

/** 입력이 구우편번호뿐이라 판정할 단서가 없는지 */
export function hasOnlyZip(p: ParsedInput): boolean {
  return !!p.oldZip && !p.name && !p.emd && !p.jibun && !p.roadName && p.sigungu.length === 0
}
