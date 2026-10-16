// 여러 검색 결과를 도로명주소(앞주소) 단위로 합치고, 입력에서 알 수 있는 신호만으로 점수를 매긴다.
// 입력에 없는 신호는 0점이며 감점하지 않는다(부분 입력을 불리하게 만들지 않기 위해).
import type { ZipcodeResult } from '../search'
import { sidoAliases } from '../regions'
import { nameKey, nameNumbers, type ParsedInput } from './parse'

export interface RankedCandidate {
  result: ZipcodeResult
  /** 이 후보가 나온 검색어 수 */
  hits: number
  score: number
  /** 점수 근거(화면 표시용) */
  why: string[]
}

export interface Weights {
  road: number
  jibun: number
  name: number
  num: number
  dongOut: number
  emd: number
  old: number
  region: number
  regionOut: number
  hit: number
  /** 사용자가 이전에 확정해 기억한 주소 */
  learned: number
  /** 입력에 신우편번호 5자리가 있고 후보와 같을 때 */
  zip5: number
}

export const DEFAULT_WEIGHTS: Weights = {
  road: 6, jibun: 5, name: 4, num: 2, dongOut: 3, emd: 1, old: 3, region: 1, regionOut: 4, hit: 0.3, learned: 6, zip5: 3,
}

const ns = (s: string): string => s.replace(/\s/g, '')

/** '서울특별시 마포구 성미산로31길 14 (망원동)' → '성미산로31길14' */
export function roadTail(road: string): string {
  const m = road.replace(/\([^)]*\)/g, ' ').match(/([가-힣\d]+(?:로|길)\s*\d+(?:-\d+)?)\s*$/)
  return m ? ns(m[1]) : ''
}

const keyOf = (r: ZipcodeResult): string => `${r.zipcode}|${roadTail(r.roadAddress)}`

/** 단지 동 목록 원문에서 동 번호 집합을 만든다('101동~103동,105동~108동' → 101~103, 105~108) */
export function dongNumbers(text: string | undefined): Set<string> {
  const s = new Set<string>()
  if (!text) return s
  for (const m of text.matchAll(/(\d+)\s*동\s*~\s*(\d+)\s*동/g)) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (b - a < 500) for (let i = a; i <= b; i++) s.add(String(i))
  }
  for (const m of text.matchAll(/(\d+)\s*동/g)) s.add(m[1])
  return s
}

const dice = (a: string, b: string): number => {
  const grams = (s: string) => { const r = new Set<string>(); for (let i = 0; i < s.length - 1; i++) r.add(s.slice(i, i + 2)); return r }
  const [A, B] = [grams(a), grams(b)]
  if (!A.size || !B.size) return a && b && (a.includes(b) || b.includes(a)) ? 0.8 : 0
  let n = 0
  for (const x of A) if (B.has(x)) n++
  return (2 * n) / (A.size + B.size)
}

/** 같은 도로명주소(신우편번호 + 도로명·건물번호)의 결과를 하나로 합친다. 도로명이 없는 행은 버린다 */
export function mergeResults(lists: ZipcodeResult[][]): { result: ZipcodeResult; hits: number }[] {
  const map = new Map<string, { result: ZipcodeResult; hits: number }>()
  for (const list of lists) {
    const seen = new Set<string>()
    for (const r of list) {
      if (r.range || !roadTail(r.roadAddress)) continue
      const k = keyOf(r)
      const cur = map.get(k)
      if (!cur) { map.set(k, { result: { ...r }, hits: 1 }); seen.add(k); continue }
      if (!seen.has(k)) { cur.hits++; seen.add(k) }
      const m = cur.result
      m.oldZipcode ||= r.oldZipcode
      if (r.buildingName && r.buildingName.length > (m.buildingName?.length ?? 0)) m.buildingName = r.buildingName
      if (r.dongText && !m.dongText?.includes(r.dongText)) m.dongText = [m.dongText, r.dongText].filter(Boolean).join(', ')
      if ((r.jibunAddress?.length ?? 0) > (m.jibunAddress?.length ?? 0)) m.jibunAddress = r.jibunAddress
      m.detail ||= r.detail
    }
  }
  return [...map.values()]
}

// 접미사를 뗀 이름이 한 글자가 되면('대구'→'대', '중구'→'중') 떼지 않는다
const base = (t: string): string => { const b = t.replace(/(특별시|광역시|특별자치시|특별자치도|시|군|구|도)$/, ''); return b.length >= 2 ? b : t }

/** 사용자가 기억한 선택(신우편번호 + 도로명) */
export interface LearnedRef { zip5: string; road: string }

export function scoreCandidate(p: ParsedInput, c: { result: ZipcodeResult; hits: number }, w: Weights = DEFAULT_WEIGHTS, learned: readonly LearnedRef[] = []): RankedCandidate {
  const r = c.result
  let s = 0
  const why: string[] = []
  const text = `${r.roadAddress} ${r.jibunAddress}`

  // 지역: 입력에 있는데 후보에 없으면 감점, 있으면 소폭 가점
  const regions = [...(p.sido ? [p.sido] : []), ...p.sigungu]
  if (regions.length) {
    const miss = regions.filter((t) => {
      // 시도는 정식 명칭·줄임말 중 하나라도 후보에 있으면 일치('경북' ↔ '경상북도')
      const names = sidoAliases(t)
      return names.length ? !names.some((n) => text.includes(n)) : base(t).length >= 2 && !text.includes(base(t))
    })
    if (miss.length) { s -= w.regionOut; why.push('지역 불일치') } else { s += w.region; why.push('지역') }
  }
  if (p.roadName && p.roadNo && roadTail(r.roadAddress) === ns(`${p.roadName}${p.roadNo}`)) { s += w.road; why.push('도로명 일치') }
  if (p.jibun && new RegExp(`(?:^|\\s)${p.jibun}(?:\\s|$)`).test(r.jibunAddress.replace(/\s+-/g, '-'))) { s += w.jibun; why.push('지번 일치') }

  if (p.core && r.buildingName) {
    const sim = dice(nameKey(p.core), nameKey(r.buildingName))
    s += w.name * sim
    if (sim >= 0.5) why.push(sim >= 0.9 ? '건물명 일치' : '건물명 유사')
    const [a, b] = [nameNumbers(p.name), nameNumbers(r.buildingName)]
    if (a.size && b.size) {
      if ([...a].some((n) => b.has(n))) { s += w.num; why.push('차수 일치') } else { s -= w.num; why.push('차수 불일치') }
    }
    // 입력에 차수가 없는데 후보에만 있으면('우성아파트' ↔ '우성4차아파트') 소폭 감점, 이름이 완전히 같으면 소폭 가점
    if (!a.size && b.size) s -= w.num / 2
    if (ns(p.name) === ns(r.buildingName)) s += 0.5
  }
  // 동 번호: 다른 단지에도 같은 번호가 있어 포함은 가점하지 않고, 단지 동 목록에 없을 때만 감점
  if (p.aptDong) {
    const dongs = dongNumbers(r.dongText)
    if (dongs.size && !dongs.has(p.aptDong)) { s -= w.dongOut; why.push('동 없음') }
  }
  if (p.emd) {
    const stem = p.emd.replace(/(동|읍|면|리)$/, '')
    if (stem && ns(`${r.jibunAddress} ${r.detail ?? ''}`).includes(stem)) { s += w.emd; why.push('법정동') }
  }
  if (p.zip5 && r.zipcode === p.zip5) { s += w.zip5; why.push('우편번호 일치') }
  if (p.oldZip && r.oldZipcode === p.oldZip) { s += w.old; why.push('구우편번호 일치') }
  if (learned.some((l) => l.zip5 === r.zipcode && roadTail(l.road) === roadTail(r.roadAddress))) { s += w.learned; why.push('기억된 선택') }
  s += w.hit * Math.min(c.hits, 3)
  return { result: r, hits: c.hits, score: s, why }
}

export function rankResults(p: ParsedInput, lists: ZipcodeResult[][], w: Weights = DEFAULT_WEIGHTS, learned: readonly LearnedRef[] = []): RankedCandidate[] {
  return mergeResults(lists).map((c) => scoreCandidate(p, c, w, learned)).sort((a, b) => b.score - a.score)
}

/** 점수 → 확률 변환 상수: 온도(클수록 완만)와 '후보 중 정답 없음'에 해당하는 기준 점수 */
export const PROB = { temperature: 2, noneScore: 5 } as const

/**
 * 후보 점수를 확률로 바꾼다(softmax). '정답 없음' 몫(noneScore)을 함께 두므로 모든 후보 점수가 낮으면
 * 확률도 낮아진다. 점수는 보정되지 않은 가중치 합이라 정답 데이터로 temperature·noneScore 를 맞춰야
 * 통계적 확률이 된다(지금은 isConfident 기준 — 1위 5점 이상·2위와 2.5점 차 — 과 비슷한 눈금).
 */
export function toProbabilities(scores: readonly number[], t: number = PROB.temperature, none: number = PROB.noneScore): number[] {
  if (scores.length === 0) return []
  const m = Math.max(none, ...scores)
  const exp = scores.map((s) => Math.exp((s - m) / t))
  const total = exp.reduce((a, b) => a + b, Math.exp((none - m) / t))
  return exp.map((e) => e / total)
}

/** 1위가 충분히 앞서는지: 점수 하한과 2위와의 격차 */
export function isConfident(ranked: { score: number }[], minScore = 5, minGap = 2.5): boolean {
  if (ranked.length === 0) return false
  if (ranked.length === 1) return ranked[0].score >= minScore
  return ranked[0].score >= minScore && ranked[0].score - ranked[1].score >= minGap
}
