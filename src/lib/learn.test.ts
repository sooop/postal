import { describe, expect, it } from 'vitest'
import { isSameAddress, learnKey, parseLearned, priorFor, serializeLearned, upsertRecord, type LearnedRecord } from './learn'
import { parseInput } from './match/parse'
import { rankResults } from './match/rank'
import type { ZipcodeResult } from './search'

const r = (over: Partial<ZipcodeResult> = {}): ZipcodeResult => ({
  zipcode: '18109', roadAddress: '경기도 오산시 여계산로 7', jibunAddress: '경기도 오산시 금암동 1', buildingName: '금암마을 휴먼시아 데시앙', ...over,
})

describe('learnKey', () => {
  it('호수·동·표기 차이가 있어도 같은 구주소는 같은 키', () => {
    const a = learnKey('경기도 오산시 금암동 금암마을휴먼시아데시앙6단지아파트 616-1903')
    const b = learnKey('오산시 금암동 금암마을휴먼시아데시앙6단지아파트 105동 302호')
    expect(a).toBeTruthy()
    expect(a).toBe(b)
  })
  it('구우편번호가 다르면 다른 키', () => {
    expect(learnKey('135-924 역삼동 736-1')).not.toBe(learnKey('135-925 역삼동 736-1'))
  })
  it('단서가 없는 입력은 기억하지 않는다', () => {
    expect(learnKey('135-924')).toBeNull()
    expect(learnKey('서울특별시')).toBeNull()
  })
  it('도로명 + 번호 입력도 키를 만든다', () => {
    expect(learnKey('서울 마포구 성미산로31길 14')).toContain('성미산로31길14')
  })
})

describe('기억 갱신과 비교', () => {
  it('같은 선택이면 횟수를 늘리고, 다른 선택이면 새 선택으로 교체', () => {
    const first = upsertRecord(undefined, 'k', '입력', r(), 100)
    expect(first).toMatchObject({ hits: 1, createdAt: 100, selected: { zip5: '18109', road: '경기도 오산시 여계산로 7' } })
    const again = upsertRecord(first, 'k', '다른 입력', r(), 200)
    expect(again).toMatchObject({ hits: 2, lastUsedAt: 200, createdAt: 100, input: '입력' })
    const other = upsertRecord(again, 'k', '입력', r({ roadAddress: '경기도 오산시 여계산로 21', zipcode: '18110' }), 300)
    expect(other).toMatchObject({ hits: 1, createdAt: 100, selected: { road: '경기도 오산시 여계산로 21' } })
  })
  it('도로명 표기(시도 줄임·괄호)가 달라도 같은 도로명주소로 본다', () => {
    expect(isSameAddress(r({ roadAddress: '경기도 오산시 여계산로 7 (금암동)' }), { zip5: '18109', road: '경기 오산시 여계산로 7' })).toBe(true)
    expect(isSameAddress(r(), { zip5: '18110', road: '경기도 오산시 여계산로 7' })).toBe(false)
  })
  it('prior 는 기억된 선택에만 붙는다', () => {
    const rec = upsertRecord(undefined, 'k', 'x', r(), 1)
    expect(priorFor(r(), rec)).toEqual({ preferred: true, confirmedCount: 1 })
    expect(priorFor(r({ roadAddress: '경기도 오산시 여계산로 21' }), rec)).toBeUndefined()
  })
})

describe('내보내기·가져오기', () => {
  const rec: LearnedRecord = upsertRecord(undefined, 'k', '입력', r(), 5)
  it('왕복해도 같다', () => {
    expect(parseLearned(serializeLearned([rec]))).toEqual({ records: [rec], skipped: 0 })
  })
  it('형식이 틀린 파일은 거부하고, 깨진 항목은 건너뛴다', () => {
    expect(parseLearned('not json')).toBeNull()
    expect(parseLearned(JSON.stringify({ format: 'other', records: [] }))).toBeNull()
    const text = JSON.stringify({ format: 'postal-learned', version: 1, records: [rec, { key: 'x' }, { key: 'y', input: '', selected: { zip5: '12', road: 'a' } }] })
    expect(parseLearned(text)).toMatchObject({ skipped: 2, records: [{ key: 'k' }] })
  })
})

describe('랭킹 가점', () => {
  it('기억된 선택이 후보에 있으면 가점과 근거가 붙는다', () => {
    const p = parseInput('오산시 금암마을')
    const a = r()
    const b = r({ roadAddress: '경기도 오산시 여계산로 21', zipcode: '18110', buildingName: '금암마을 휴먼시아 데시앙' })
    const ranked = rankResults(p, [[b, a]], undefined, [{ zip5: '18109', road: '경기도 오산시 여계산로 7' }])
    expect(ranked[0].result.zipcode).toBe('18109')
    expect(ranked[0].why).toContain('기억된 선택')
  })
})
