import { describe, expect, it } from 'vitest'
import { filterResults, fuzzyScore, highlightSegments } from './fuzzy'
import type { ZipcodeResult } from './search'

const mk = (zipcode: string, roadAddress: string, jibunAddress = '', detail?: string): ZipcodeResult => ({
  zipcode, roadAddress, jibunAddress, detail,
})

const rows = [
  mk('06236', '서울특별시 강남구 테헤란로 142', '서울특별시 강남구 역삼동', '캐피탈타워'),
  mk('06237', '서울특별시 강남구 논현로 429', '서울특별시 강남구 역삼동', '씨앤씨빌딩'),
  mk('13494', '경기도 성남시 분당구 판교역로 235', '경기도 성남시 분당구 삼평동', '에이치스퀘어'),
]

describe('fuzzyScore', () => {
  it('빈 질의는 항상 통과', () => expect(fuzzyScore('아무거나', '  ')).toBe(1))
  it('부분 문자열 일치', () => expect(fuzzyScore('테헤란로 142', '테헤란')).toBeGreaterThan(0))
  it('초성 일치', () => expect(fuzzyScore('서울 강남구 테헤란로', 'ㅌㅎㄹ')).toBeGreaterThan(0))
  it('순서가 맞는 흩어진 글자 일치', () => expect(fuzzyScore('성남시 분당구 판교역로', '판역')).toBeGreaterThan(0))
  it('순서가 틀리면 불일치', () => expect(fuzzyScore('판교역로', '역판')).toBe(0))
  it('모든 토큰이 일치해야 한다', () => {
    expect(fuzzyScore('서울 강남구 테헤란로 142', '테헤란 142')).toBeGreaterThan(0)
    expect(fuzzyScore('서울 강남구 테헤란로 142', '테헤란 999')).toBe(0)
  })
})

describe('filterResults', () => {
  it('빈 질의면 원본 그대로', () => expect(filterResults(rows, '')).toBe(rows))
  it('주소·건물명·우편번호로 찾는다', () => {
    expect(filterResults(rows, '논현')).toHaveLength(1)
    expect(filterResults(rows, '캐피탈')).toHaveLength(1)
    expect(filterResults(rows, '13494')).toHaveLength(1)
  })
  it('정확한 부분 일치가 흩어진 일치보다 앞선다', () => {
    const list = [mk('1', '가나다라마'), mk('2', '가x나x다')]
    expect(filterResults(list, '가나다').map((r) => r.zipcode)).toEqual(['1', '2'])
  })
  it('일치 항목이 없으면 빈 배열', () => expect(filterResults(rows, '부산')).toEqual([]))
})

describe('highlightSegments', () => {
  const join = (segs: { text: string; hit: boolean }[]) =>
    segs.map((s) => (s.hit ? `[${s.text}]` : s.text)).join('')

  it('부분 문자열 구간을 표시', () => {
    expect(join(highlightSegments('서울 강남구 테헤란로 142', '테헤란'))).toBe('서울 강남구 [테헤란]로 142')
  })
  it('초성 구간을 표시', () => {
    expect(join(highlightSegments('테헤란로 142', 'ㅌㅎㄹ'))).toBe('[테헤란]로 142')
  })
  it('흩어진 글자는 각각 표시', () => {
    expect(join(highlightSegments('판교역로', '판역'))).toBe('[판]교[역]로')
  })
  it('여러 토큰을 모두 표시', () => {
    expect(join(highlightSegments('테헤란로 142', '테헤 142'))).toBe('[테헤]란로 [142]')
  })
  it('빈 질의나 불일치는 그대로', () => {
    expect(join(highlightSegments('테헤란로', ''))).toBe('테헤란로')
    expect(join(highlightSegments('테헤란로', '부산'))).toBe('테헤란로')
  })
})
