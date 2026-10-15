import { describe, expect, it } from 'vitest'
import { normalizeJusoPage, normalizeJusoRow } from './juso'
import { ParseFailedError } from './normalize'
import apt from './__fixtures__/juso-apt.json'
import ri from './__fixtures__/juso-ri.json'
import empty from './__fixtures__/juso-empty.json'
import nobuilding from './__fixtures__/juso-nobuilding.json'

describe('normalizeJusoPage', () => {
  it('아파트: 도로명(괄호 제외)·지번(필드 조합)·건물명·5자리 우편번호', () => {
    const page = normalizeJusoPage(apt, 1, 10)
    expect(page.source).toBe('juso')
    expect(page.total).toBe(5)
    expect(page.results[0]).toMatchObject({
      zipcode: '18109',
      roadAddress: '경기도 오산시 여계산로 7',
      jibunAddress: '경기도 오산시 금암동 515',
      detail: '금암마을 휴먼시아 데시앙',
      kind: '도로명',
      source: 'juso',
    })
    expect(page.results[0].oldZipcode).toBeUndefined()
  })

  it('리 단위 주소: 읍·면 도로명은 괄호가 없고 지번에 리가 들어간다', () => {
    const [first] = normalizeJusoPage(ri, 1, 10).results
    expect(first).toMatchObject({
      roadAddress: '강원특별자치도 화천군 사내면 사내로4길 23-12',
      jibunAddress: '강원특별자치도 화천군 사내면 사창리 245-15',
      detail: '사창1리마을회관',
    })
  })

  it('건물명이 없으면 detail 은 없다. 시군구가 두 단어(성남시 분당구)여도 그대로', () => {
    const [first] = normalizeJusoPage(nobuilding, 1, 10).results
    expect(first.roadAddress).toBe('경기도 성남시 분당구 판교로 242')
    expect(first.jibunAddress).toBe('경기도 성남시 분당구 삼평동 624')
    expect(first.detail).toBeUndefined()
  })

  it('결과 없음은 빈 배열의 정상 응답', () => {
    const page = normalizeJusoPage(empty, 1, 10)
    expect(page.results).toEqual([])
    expect(page.hasMore).toBe(false)
  })

  it('전체 건수가 크면 hasMore 와 다음 페이지 번호', () => {
    const page = normalizeJusoPage(apt, 1, 3)
    expect(page.hasMore).toBe(true)
    expect(page.nextTargetRow).toBe(2)
    expect(normalizeJusoPage(apt, 2, 3).hasMore).toBe(false)
  })

  it('구조가 다르면 ParseFailedError', () => {
    expect(() => normalizeJusoPage({}, 1, 10)).toThrow(ParseFailedError)
    expect(() => normalizeJusoPage({ results: { content: [], totalElements: 'x' } }, 1, 10)).toThrow(ParseFailedError)
    expect(() => normalizeJusoPage(null, 1, 10)).toThrow(ParseFailedError)
  })
})

describe('normalizeJusoRow', () => {
  it('우편번호가 5자리가 아니거나 도로명이 없으면 폐기', () => {
    expect(normalizeJusoRow({ zipCl: '', schKorRoadNm: 'A로 1 (가동)' })).toBeNull()
    expect(normalizeJusoRow({ zipCl: '12345', schKorRoadNm: '' })).toBeNull()
  })
  it('산 번지와 부번', () => {
    const r = normalizeJusoRow({ zipCl: '12345', schKorRoadNm: 'A로 1 (가동)', siNm: '경기도', sggNm: '가평군', emdNm: '가평읍', riNm: '', lndnMaSn: 12, lndnSbSn: 3, mtYn: '1' })
    expect(r?.jibunAddress).toBe('경기도 가평군 가평읍 산12-3')
  })
})
