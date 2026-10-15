import type { ZipcodeResult } from './search'

const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'

const isJamoOnly = (s: string): boolean => [...s].every((c) => CHOSEONG.includes(c))

/** 한글 음절은 초성으로, 그 외 문자는 그대로 */
function toChoseong(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.charCodeAt(0)
    out += code >= 0xac00 && code <= 0xd7a3
      ? CHOSEONG[Math.floor((code - 0xac00) / 588)]
      : ch
  }
  return out
}

/** 글자 순서만 맞으면 일치. 연속될수록, 앞쪽일수록 높은 점수. 불일치면 0 */
function subsequenceScore(hay: string, needle: string): number {
  let hi = 0
  let score = 0
  let prev = -2
  for (const ch of needle) {
    const found = hay.indexOf(ch, hi)
    if (found < 0) return 0
    score += found === prev + 1 ? 3 : 1
    prev = found
    hi = found + 1
  }
  return score
}

/** 토큰 하나의 점수. 0 이면 불일치 */
function tokenScore(hayRaw: string, hayCompact: string, hayCho: string, token: string): number {
  const idx = hayRaw.indexOf(token)
  if (idx >= 0) return 1000 - Math.min(idx, 500)

  if (isJamoOnly(token)) {
    const cIdx = hayCho.indexOf(token)
    return cIdx >= 0 ? 600 - Math.min(cIdx, 300) : 0
  }

  const sub = subsequenceScore(hayCompact, token)
  return sub > 0 ? sub : 0
}

/** 공백으로 나눈 모든 토큰이 일치해야 한다(AND). 0 이면 불일치, 클수록 잘 맞음 */
export function fuzzyScore(haystack: string, query: string): number {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 1

  const hayRaw = haystack.toLowerCase()
  const hayCompact = hayRaw.replace(/\s+/g, '')
  const hayCho = toChoseong(hayCompact)

  let total = 0
  for (const t of tokens) {
    const s = tokenScore(hayRaw, hayCompact, hayCho, t)
    if (s === 0) return 0
    total += s
  }
  return total
}

export function resultHaystack(r: ZipcodeResult): string {
  return [r.zipcode, r.oldZipcode, r.roadAddress, r.jibunAddress, r.detail]
    .filter(Boolean)
    .join(' ')
}

/** 질의가 비면 원본 그대로, 아니면 일치 항목만 점수순(동점은 원래 순서) */
export function filterResults(results: ZipcodeResult[], query: string): ZipcodeResult[] {
  if (!query.trim()) return results
  return results
    .map((r, i) => ({ r, i, s: fuzzyScore(resultHaystack(r), query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.r)
}

export interface Segment {
  text: string
  hit: boolean
}

/** 텍스트 안에서 질의의 각 토큰이 일치하는 글자 위치를 모아 연속 구간으로 나눈다 */
export function highlightSegments(text: string, query: string): Segment[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!text || tokens.length === 0) return [{ text, hit: false }]

  const lower = text.toLowerCase()
  const cho = toChoseong(lower)
  const marked = new Array<boolean>(text.length).fill(false)

  const mark = (from: number, len: number) => {
    for (let i = from; i < from + len; i++) marked[i] = true
  }

  for (const t of tokens) {
    const idx = lower.indexOf(t)
    if (idx >= 0) { mark(idx, t.length); continue }

    if (isJamoOnly(t)) {
      const cIdx = cho.indexOf(t)
      if (cIdx >= 0) mark(cIdx, t.length)
      continue
    }

    // 흩어진 글자: 점수 계산과 같이 공백을 건너뛰며 앞에서부터 찾는다
    const hits: number[] = []
    let pos = 0
    for (const ch of t) {
      let found = -1
      for (let i = pos; i < lower.length; i++) {
        if (lower[i] === ch) { found = i; break }
      }
      if (found < 0) { hits.length = 0; break }
      hits.push(found)
      pos = found + 1
    }
    hits.forEach((i) => { marked[i] = true })
  }

  const segments: Segment[] = []
  for (let i = 0; i < text.length; i++) {
    const last = segments[segments.length - 1]
    if (last && last.hit === marked[i]) last.text += text[i]
    else segments.push({ text: text[i], hit: marked[i] })
  }
  return segments
}
