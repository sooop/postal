import { describe, expect, it } from 'vitest'
import { cleanInput, normalizeDigits, normalizeQuery } from './input'
import { parseInput } from './match/parse'

describe('normalizeQuery', () => {
  it('구우편번호는 여러 표기를 000-000 으로 통일한다', () => {
    for (const v of ['135924', '135-924', '135 924', '135.924', ' 135-924 ', '１３５－９２４', '135–924', '135 - 924']) {
      expect(normalizeQuery(v)).toEqual({ query: '135-924', kind: 'oldZip' })
    }
  })
  it('신우편번호 5자리', () => {
    expect(normalizeQuery('06236')).toEqual({ query: '06236', kind: 'newZip' })
  })
  it('그 밖의 숫자·문장은 우편번호로 보지 않는다', () => {
    expect(normalizeQuery('1234')).toEqual({ query: '1234', kind: 'text' })
    expect(normalizeQuery('1234567')).toEqual({ query: '1234567', kind: 'text' })
    expect(normalizeQuery('역삼동 736-1').kind).toBe('text')
    expect(normalizeQuery('736-1').kind).toBe('text')
  })
  it('전각 숫자와 하이픈 변형만 정리한다', () => {
    expect(normalizeDigits('１３５－９２４ 역삼동')).toBe('135-924 역삼동')
  })
})

describe('문장 속 우편번호 추출', () => {
  it('전각·변형 하이픈·떨어진 숫자도 구우편번호로 뗀다', () => {
    expect(parseInput('１３５－９２４ 역삼동 736-1')).toMatchObject({ oldZip: '135924', emd: '역삼동', jibun: '736-1' })
    expect(parseInput('135 924 역삼동 736-1')).toMatchObject({ oldZip: '135924', emd: '역삼동' })
    expect(parseInput('역삼동 736-1 135924')).toMatchObject({ oldZip: '135924', emd: '역삼동', jibun: '736-1' })
    expect(parseInput('역삼동 736-1 (135-924)')).toMatchObject({ oldZip: '135924' })
  })
  it('호수·번지와 헷갈리는 숫자는 우편번호로 보지 않는다', () => {
    expect(parseInput('역삼동 736-1 301 호').oldZip).toBeUndefined()
    expect(parseInput('역삼동 201 102동').oldZip).toBeUndefined()
  })
  it('신우편번호 5자리가 섞여 있으면 힌트로 뗀다', () => {
    expect(parseInput('06236 역삼동 736-1')).toMatchObject({ zip5: '06236', emd: '역삼동' })
  })
})

describe('cleanInput', () => {
  it('쉼표·따옴표 등 주소에 쓰지 않는 기호는 공백으로 바꾼다', () => {
    expect(cleanInput('서울특별시 송파구 가락동 127-2, 402호')).toBe('서울특별시 송파구 가락동 127-2 402호')
    expect(cleanInput("\"서울\" '송파구', 가락동;127-2")).toBe('서울 송파구 가락동 127-2')
    expect(cleanInput('서울,송파구,가락동')).toBe('서울 송파구 가락동')
  })
  it('괄호·하이픈·물결·숫자 사이 마침표는 남긴다', () => {
    expect(cleanInput('경기 고양시 (백석동, 흰돌마을1단지) 101~103동')).toBe('경기 고양시 (백석동 흰돌마을1단지) 101~103동')
    expect(cleanInput('135.924 서울 127-2.')).toBe('135.924 서울 127-2')
  })
  it('normalizeQuery 도 같은 정리를 한다', () => {
    expect(normalizeQuery('서울특별시 송파구 가락동 127-2, 402호').query).toBe('서울특별시 송파구 가락동 127-2 402호')
    expect(normalizeQuery('135,924')).toEqual({ query: '135-924', kind: 'oldZip' })
  })
  it('쉼표가 있어도 번지·지역을 같게 분석한다', () => {
    const a = parseInput('서울특별시 송파구 가락동 127-2, 402호')
    const b = parseInput('서울특별시 송파구 가락동 127-2 402호')
    expect(a).toEqual({ ...b, raw: a.raw })
    expect(a.jibun).toBe('127-2')
    expect(a.name).toBe('')
  })
})
