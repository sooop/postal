import { describe, expect, it } from 'vitest'
import { normalizePage, normalizeRow, ParseFailedError } from './normalize'
import road from './__fixtures__/road.json'
import jibun from './__fixtures__/jibun.json'
import pobox from './__fixtures__/pobox.json'
import empty from './__fixtures__/empty.json'

describe('normalizePage', () => {
  it('도로명 행: 도로명주소는 건물번호까지, 동은 지번 접두로, 건물명은 detail', () => {
    const page = normalizePage(road, 1, 10)
    expect(page.total).toBe(2)
    expect(page.hasMore).toBe(false)
    expect(page.results[0]).toMatchObject({
      zipcode: '06236',
      roadAddress: '서울특별시 강남구 테헤란로 142',
      jibunAddress: '서울특별시 강남구 역삼동',
      oldZipcode: '135924',
      detail: '롯데캐피탈',
      kind: '도로명',
    })
  })

  it('지번 행: 지번주소와 괄호 안 도로명을 분리하고 건물명은 detail', () => {
    const [first] = normalizePage(jibun, 1, 10).results
    expect(first).toMatchObject({
      zipcode: '06236',
      roadAddress: '서울특별시 강남구 테헤란로 142',
      jibunAddress: '서울특별시 강남구 역삼동 736-1',
      detail: '캐피탈타워',
    })
  })

  it('번지 범위 행은 range 로 표시하고 도로명은 비운다', () => {
    const range = normalizePage(jibun, 1, 10).results[2]
    expect(range.range).toBe(true)
    expect(range.roadAddress).toBe('')
    expect(range.oldZipcode).toBeUndefined()
  })

  it('사서함 행은 range 이고 5자리 신우편번호를 유지한다', () => {
    const [box] = normalizePage(pobox, 1, 10).results
    expect(box).toMatchObject({ zipcode: '06164', kind: '사서함', range: true })
    expect(box.oldZipcode).toBeUndefined() // 061-64 는 6자리가 아님
  })

  it('결과 없음은 빈 배열의 정상 응답', () => {
    const page = normalizePage(empty, 1, 10)
    expect(page.results).toEqual([])
    expect(page.hasMore).toBe(false)
  })

  it('전체 건수가 더 크면 hasMore, 다음 페이지 번호 증가', () => {
    const page = normalizePage({ totCnt: 33, newZipcdList: [] }, 1, 10)
    expect(page.hasMore).toBe(true)
    expect(page.nextTargetRow).toBe(2)
  })

  it('구조가 다르면 ParseFailedError', () => {
    expect(() => normalizePage({}, 1, 10)).toThrow(ParseFailedError)
    expect(() => normalizePage(null, 1, 10)).toThrow(ParseFailedError)
    expect(() => normalizePage({ totCnt: 'x', newZipcdList: [] }, 1, 10)).toThrow(ParseFailedError)
  })
})

describe('normalizeRow', () => {
  it('5자리 숫자가 아닌 areacd 는 폐기', () => {
    expect(normalizeRow({ areacd: '', addr: 'x', addr_type: '도로명' })).toBeNull()
    expect(normalizeRow({ areacd: '1234', addr: 'x', addr_type: '도로명' })).toBeNull()
  })
})

describe('도로명 행의 지번 보강(dualaddr)', () => {
  it('동 다음의 번지를 지번주소에 붙인다', () => {
    const r = normalizeRow({
      addr_type: '도로명', areacd: '05580', zipcd: '138-770', sidosggnm: '서울특별시 송파구', rdNm: '백제고분로18길', bdsn: '26',
      addr: '서울특별시 송파구 백제고분로18길 26 (잠실동, 우성4차아파트)', dualaddr: '서울특별시 송파구 잠실동 320 우성4차아파트', aptNm: '우성4차아파트',
    })
    expect(r?.jibunAddress).toBe('서울특별시 송파구 잠실동 320')
    expect(r?.buildingName).toBe('우성4차아파트')
  })
  it('번지가 없으면 동까지만', () => {
    const r = normalizeRow({ addr_type: '도로명', areacd: '05580', sidosggnm: '서울특별시 송파구', rdNm: '백제고분로18길', bdsn: '26', addr: '서울특별시 송파구 백제고분로18길 26 (잠실동)' })
    expect(r?.jibunAddress).toBe('서울특별시 송파구 잠실동')
  })
  it('단지 동 범위가 뒤에 붙은 행도 동 목록으로 보존한다', () => {
    const r = normalizeRow({ addr_type: '도로명', areacd: '05236', sidosggnm: '서울특별시 강동구', rdNm: '고덕로', bdsn: '131', addr: '서울특별시 강동구 고덕로 131 (암사동, 강동롯데캐슬퍼스트아파트) 101동~140동' })
    expect(r?.dongText).toBe('101동~140동')
  })
})
