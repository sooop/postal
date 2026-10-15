import { describe, expect, it } from 'vitest'
import { isOldZipQuery, searchPage, type Fetchers } from './provider'
import type { SearchPage, Source, ZipcodeResult } from './search'

const row = (zip: string): ZipcodeResult => ({ zipcode: zip, roadAddress: 'A로 1', jibunAddress: '' })
const page = (source: Source, n: number): SearchPage => ({
  results: Array.from({ length: n }, (_, i) => row(`0000${i}`)), hasMore: false, nextTargetRow: 2, source,
})

function make(epost: () => Promise<SearchPage>, juso: () => Promise<SearchPage>) {
  const calls: Source[] = []
  const f: Fetchers = {
    epost: async () => { calls.push('epost'); return epost() },
    juso: async () => { calls.push('juso'); return juso() },
  }
  return { f, calls }
}

describe('isOldZipQuery', () => {
  it('6자리 숫자(하이픈 허용)만 구우편번호', () => {
    expect(isOldZipQuery('135-924')).toBe(true)
    expect(isOldZipQuery('135924')).toBe(true)
    expect(isOldZipQuery('06236')).toBe(false)
    expect(isOldZipQuery('역삼동 736-1')).toBe(false)
  })
})

describe('searchPage', () => {
  it('epost / juso 모드는 해당 조회처만 쓴다', async () => {
    const t = make(async () => page('epost', 1), async () => page('juso', 1))
    expect((await searchPage(t.f, '역삼동', 1, 10, 'juso')).source).toBe('juso')
    expect((await searchPage(t.f, '역삼동', 1, 10, 'epost')).source).toBe('epost')
    expect(t.calls).toEqual(['juso', 'epost'])
  })

  it('구우편번호 검색어는 모드와 관계없이 epost', async () => {
    const t = make(async () => page('epost', 1), async () => page('juso', 1))
    expect((await searchPage(t.f, '135-924', 1, 10, 'juso')).source).toBe('epost')
    expect(t.calls).toEqual(['epost'])
  })

  it('auto: 우체국에 결과가 있으면 juso 를 부르지 않는다', async () => {
    const t = make(async () => page('epost', 2), async () => page('juso', 1))
    expect((await searchPage(t.f, '역삼동', 1, 10, 'auto')).source).toBe('epost')
    expect(t.calls).toEqual(['epost'])
  })

  it('auto: 첫 페이지가 비면 juso 로 대체', async () => {
    const t = make(async () => page('epost', 0), async () => page('juso', 3))
    const r = await searchPage(t.f, '금암마을 휴먼시아 데시앙', 1, 10, 'auto')
    expect(r.source).toBe('juso')
    expect(t.calls).toEqual(['epost', 'juso'])
  })

  it('auto: 우체국이 실패하면 juso 로 대체', async () => {
    const t = make(async () => { throw new TypeError('x') }, async () => page('juso', 1))
    expect((await searchPage(t.f, '역삼동', 1, 10, 'auto')).source).toBe('juso')
  })

  it('auto: 둘 다 실패하면 우체국 오류를 던진다', async () => {
    const t = make(async () => { throw new Error('epost 실패') }, async () => { throw new Error('juso 실패') })
    await expect(searchPage(t.f, '역삼동', 1, 10, 'auto')).rejects.toThrow('epost 실패')
  })

  it('auto: 2페이지 이후 빈 결과는 대체하지 않는다', async () => {
    const t = make(async () => page('epost', 0), async () => page('juso', 3))
    expect((await searchPage(t.f, '역삼동', 2, 10, 'auto')).source).toBe('epost')
    expect(t.calls).toEqual(['epost'])
  })
})
