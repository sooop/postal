// 검색창 입력 정리: 전각 숫자·여러 가지 하이픈을 통일하고, 숫자만의 입력이면 우편번호 종류를 알아낸다.

const DASHES = /[‐-―−－ー]/g

/** 전각 숫자(０-９)와 하이픈 비슷한 문자(‐ – — − － ー)를 ASCII 로 바꾼다 */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(DASHES, '-')
}

export type InputKind = 'oldZip' | 'newZip' | 'text'

export interface NormalizedInput {
  /** 조회처에 보낼 검색어 */
  query: string
  kind: InputKind
}

/**
 * 입력 전체가 우편번호이면 표준 형태로 바꾼다.
 * - 구우편번호(6자리): `135924`, `135-924`, `135 924`, `135.924`, 전각 → `135-924`
 * - 신우편번호(5자리): `6236` 처럼 앞자리 0 이 빠진 4자리는 건드리지 않는다(다른 숫자일 수 있음)
 * 그 밖의 입력은 숫자·하이픈 표기만 정리해 text 로 돌려준다.
 */
export function normalizeQuery(raw: string): NormalizedInput {
  const s = normalizeDigits(raw).replace(/\s+/g, ' ').trim()
  const old = s.match(/^(\d{3})\s?[-.\s]?\s?(\d{3})$/)
  if (old) return { query: `${old[1]}-${old[2]}`, kind: 'oldZip' }
  if (/^\d{5}$/.test(s)) return { query: s, kind: 'newZip' }
  return { query: s, kind: 'text' }
}
