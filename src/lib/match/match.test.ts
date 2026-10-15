import { describe, expect, it } from 'vitest'
import { isEmdLike, isSido, isSigungu } from '../regions'
import type { ZipcodeResult } from '../search'
import { buildQueries, hasOnlyZip, shouldUseSmart } from './plan'
import { parseInput } from './parse'
import { dongNumbers, isConfident, mergeResults, rankResults, roadTail } from './rank'

describe('regions', () => {
  it('시·군·구 목록으로만 지역을 판별한다', () => {
    expect(isSigungu('오산시')).toBe(true)
    expect(isSigungu('오산')).toBe(true)
    expect(isSigungu('일산동구')).toBe(true)
    expect(isSigungu('헬리오시티')).toBe(false)
    expect(isSido('경기')).toBe(true)
    expect(isSido('경상남도')).toBe(true)
    expect(isEmdLike('암사3동')).toBe(true)
    expect(isEmdLike('헬리오시티')).toBe(false)
  })
})

describe('parseInput', () => {
  it('지역 + 건물명만 있는 부분 입력', () => {
    const p = parseInput('오산시 자이새빛마을')
    expect(p).toMatchObject({ sigungu: ['오산시'], name: '자이새빛마을', core: '자이새빛마을' })
    expect(p.emd).toBeUndefined()
  })
  it("'시티' 로 끝나는 건물명을 지역으로 오인하지 않는다", () => {
    expect(parseInput('헬리오시티')).toMatchObject({ sigungu: [], name: '헬리오시티' })
    expect(parseInput('송파 헬리오시티 501동')).toMatchObject({ sigungu: ['송파'], name: '헬리오시티', aptDong: '501' })
  })
  it('행정동 숫자와 아파트 동 번호를 구분한다', () => {
    const p = parseInput('서울특별시 강동구 암사3동 강동롯데캐슬퍼스트아파트 (101~125동) 107동 2401호')
    expect(p).toMatchObject({ emd: '암사동', aptDong: '107', name: '강동롯데캐슬퍼스트아파트', core: '강동롯데캐슬퍼스트' })
  })
  it('도로명 + 번호, 괄호 안 동·건물명', () => {
    const p = parseInput('서울 강남구 역삼로 314 (역삼동 개나리 푸르지오) 303ㅡ2002')
    expect(p).toMatchObject({ roadName: '역삼로', roadNo: '314', emd: '역삼동', name: '개나리 푸르지오' })
  })
  it('붙어 있는 지번·건물명·호수를 분리한다', () => {
    expect(parseInput('서울특별시 강서구 화곡동 452-25해성팰리스3차401호')).toMatchObject({ emd: '화곡동', jibun: '452-25', name: '해성팰리스3차' })
  })
  it('구우편번호는 단서에서 빼고 동·호수는 건드리지 않는다', () => {
    expect(parseInput('135-924 역삼동 736-1')).toMatchObject({ oldZip: '135924', emd: '역삼동', jibun: '736-1' })
    expect(parseInput('경북 경주시 능원길 22 (도지동 코아루 그랑블) 109-902호').oldZip).toBeUndefined()
    expect(parseInput('135924')).toMatchObject({ oldZip: '135924' })
  })
})

describe('buildQueries', () => {
  it('있는 단서만 쓰고 건물명 변형을 만든다', () => {
    const qs = buildQueries(parseInput('경기도 오산시 금암동 금암마을휴먼시아데시앙6단지아파트 616-1903'))
    expect(qs[0]).toBe('금암동 금암마을휴먼시아데시앙6단지아파트')
    expect(qs).toContain('금암마을휴먼시아데시앙6단지아파트')
    expect(qs).toContain('금암동 금암마을')
  })
  it('도로명·지번 검색어를 먼저 만든다', () => {
    expect(buildQueries(parseInput('서울 마포구 성미산로31길 14'))[0]).toBe('마포구 성미산로31길 14')
    expect(buildQueries(parseInput('경기 의정부시 민락동 693-1 신안아파트'))[0]).toBe('의정부시 민락동 693-1')
  })
  it('구우편번호는 마지막 후보 풀 검색어', () => {
    const qs = buildQueries(parseInput('135-924 헬리오시티'))
    expect(qs[qs.length - 1]).toBe('135-924')
    expect(hasOnlyZip(parseInput('135-924'))).toBe(true)
    expect(hasOnlyZip(parseInput('135-924 헬리오시티'))).toBe(false)
  })
})

describe('shouldUseSmart', () => {
  it('단서가 있는 입력은 입력 분석 검색, 구우편번호만이거나 단서가 없으면 단순 검색', () => {
    expect(shouldUseSmart(parseInput('송파 헬리오시티'))).toBe(true)
    expect(shouldUseSmart(parseInput('역삼동 736-1'))).toBe(true)
    expect(shouldUseSmart(parseInput('135-924'))).toBe(false)
    expect(shouldUseSmart(parseInput('서울특별시'))).toBe(false)
  })
})

const r = (over: Partial<ZipcodeResult>): ZipcodeResult => ({ zipcode: '05571', roadAddress: '서울특별시 송파구 올림픽로4길 42', jibunAddress: '서울특별시 송파구 잠실동 1', ...over })

describe('rank', () => {
  it('roadTail 과 동 목록 파싱', () => {
    expect(roadTail('서울특별시 마포구 성미산로31길 14 (망원동)')).toBe('성미산로31길14')
    expect([...dongNumbers('101동~103동,105동~108동')].sort()).toEqual(['101', '102', '103', '105', '106', '107', '108'])
    expect([...dongNumbers('1동, 29동')].sort()).toEqual(['1', '29'])
  })
  it('같은 도로명주소는 하나로 합치고 정보를 모은다', () => {
    const m = mergeResults([[r({ buildingName: '우성' })], [r({ oldZipcode: '138798', dongText: '1동' })], [r({ roadAddress: '', range: true })]])
    expect(m).toHaveLength(1)
    expect(m[0].result).toMatchObject({ buildingName: '우성', oldZipcode: '138798', dongText: '1동' })
    expect(m[0].hits).toBe(2)
  })
  it('건물명 일치와 단지 동 목록으로 같은 이름 단지를 구분한다', () => {
    const p = parseInput('송파구 우성아파트 22동')
    const good = r({ buildingName: '우성아파트', dongText: '1동, 22동, 29동' })
    const shop = r({ roadAddress: '서울특별시 송파구 올림픽로4길 40', buildingName: '우성아파트 상가', dongText: '2동' })
    const ranked = rankResults(p, [[shop, good]])
    expect(ranked[0].result.roadAddress).toContain('42')
    expect(ranked[1].why).toContain('동 없음')
  })
  it('입력의 지역과 다른 후보는 감점하고, 지역이 없으면 감점하지 않는다', () => {
    const other = r({ zipcode: '14000', roadAddress: '경기도 부천시 오정구 까치로96번길 8', jibunAddress: '경기도 부천시 작동 1', buildingName: '헬리오시티' })
    const home = r({ zipcode: '05800', roadAddress: '서울특별시 송파구 송파대로 345', jibunAddress: '서울특별시 송파구 가락동 1', buildingName: '헬리오시티' })
    expect(rankResults(parseInput('송파 헬리오시티'), [[other, home]])[0].result.zipcode).toBe('05800')
    const noRegion = rankResults(parseInput('헬리오시티'), [[other, home]])
    expect(noRegion[0].score).toBe(noRegion[1].score)
    expect(isConfident(noRegion)).toBe(false)
  })
  it('구우편번호 일치는 가점', () => {
    const p = parseInput('121-865 어쩌다집')
    const a = r({ oldZipcode: '121865' })
    const b = r({ roadAddress: '서울특별시 마포구 월드컵로 1', oldZipcode: '121999' })
    expect(rankResults(p, [[b, a]])[0].result.oldZipcode).toBe('121865')
  })
})
