import { describe, expect, it } from 'vitest'
import { extractSearchText, resolveKeyword, runLookup, toCandidates, type LookupDeps } from './lookup'
import { validateLookup, type LookupRequest, type LookupSource } from './protocol'
import { BlockedError } from './epost'
import type { SearchPage, Source, ZipcodeResult } from './search'

describe('extractSearchText', () => {
  it('동 + 번지에서 상세주소를 떼어낸다', () => {
    expect(extractSearchText('서울시 강남구 역삼동 736-1번지 101호')).toBe('역삼동 736-1')
  })
  it('숫자가 붙은 동 이름과 산 번지', () => {
    expect(extractSearchText('경기도 성남시 삼평1동 산 12-3')).toBe('삼평1동 산12-3')
  })
  it('아파트 동·호수를 번지로 오인하지 않는다', () => {
    expect(extractSearchText('래미안 101동 1203호')).toBeUndefined()
  })
  it('동 정보가 없으면 도로명 + 번호', () => {
    expect(extractSearchText('서울 강남구 테헤란로 123')).toBe('테헤란로 123')
  })
  it('쓸 수 없는 입력은 undefined', () => {
    expect(extractSearchText('어딘가')).toBeUndefined()
  })
})

describe('resolveKeyword', () => {
  const base = { limit: 10, timeoutMs: 15000, source: 'epost' as const }
  it('searchText 가 우선', () => {
    expect(resolveKeyword({ ...base, searchText: '역삼동 736-1', oldAddr: '다른 주소 1-1' })).toBe('역삼동 736-1')
  })
  it('없으면 oldAddr 에서 추출, 그것도 안 되면 oldZip', () => {
    expect(resolveKeyword({ ...base, oldAddr: '서울시 강남구 역삼동 736-1' })).toBe('역삼동 736-1')
    expect(resolveKeyword({ ...base, oldAddr: '어딘가', oldZip: '135924' })).toBe('135924')
  })
})

describe('toCandidates', () => {
  it('범위·도로명 없음·무효 zip 은 제외하고 중복은 제거', () => {
    const rows = [
      { zipcode: '06236', roadAddress: 'A로 1', jibunAddress: 'A동', detail: '가' },
      { zipcode: '06236', roadAddress: 'A로 1', jibunAddress: 'A동', detail: '나' },
      { zipcode: '06236', roadAddress: '', jibunAddress: 'A동 1' },
      { zipcode: '06236', roadAddress: 'B로 1', jibunAddress: '', range: true },
      { zipcode: '1234', roadAddress: 'C로 1', jibunAddress: '' },
    ]
    expect(toCandidates(rows)).toEqual([{ zip5: '06236', road: 'A로 1', jibun: 'A동', detail: '가' }])
  })
})

describe('validateLookup', () => {
  const msg = (query: unknown, options?: unknown) => ({ query, options }) as Record<string, unknown>
  it('limit 은 20 으로 제한, timeoutMs 는 범위로 보정', () => {
    const v = validateLookup(msg({ searchText: 'a' }, { limit: 99, timeoutMs: 1 }))
    expect(v).toMatchObject({ ok: true, req: { limit: 20, timeoutMs: 1000 } })
  })
  it('잘못된 타입은 invalid_request', () => {
    expect(validateLookup(msg({ searchText: 1 }))).toMatchObject({ ok: false })
    expect(validateLookup(msg(null))).toMatchObject({ ok: false })
    expect(validateLookup(msg({ searchText: 'a' }, { limit: 0 }))).toMatchObject({ ok: false })
    expect(validateLookup(msg({ searchText: 'a' }, [1]))).toMatchObject({ ok: false })
  })
})

describe('앱 프레임 출처 판별', () => {
  it('claudeusercontent 앱 프레임 origin 만 허용', async () => {
    const { isAllowedAppOrigin, hasAllowedParent } = await import('./protocol')
    expect(isAllowedAppOrigin('https://36997004-ca1c-4170-9cf2-92532de7befa.frame.claudeusercontent.com')).toBe(true)
    expect(isAllowedAppOrigin('https://claude.ai')).toBe(false)
    expect(isAllowedAppOrigin('https://evil.com')).toBe(false)
    expect(isAllowedAppOrigin('https://x.frame.claudeusercontent.com.evil.com')).toBe(false)
    expect(isAllowedAppOrigin('http://x.frame.claudeusercontent.com')).toBe(false)
    expect(isAllowedAppOrigin('https://frame.claudeusercontent.com')).toBe(false)
    expect(hasAllowedParent(['https://claude.ai', 'https://claude.ai'])).toBe(true)
    expect(hasAllowedParent(['https://evil.com'])).toBe(false)
    expect(hasAllowedParent([])).toBe(false)
  })
})

describe('runLookup 조회처 선택', () => {
  const mkRow = (zip: string, road: string): ZipcodeResult => ({ zipcode: zip, roadAddress: road, jibunAddress: 'X동 1' })
  const mkPage = (source: Source, rows: ZipcodeResult[]): SearchPage => ({ results: rows, hasMore: false, nextTargetRow: 2, total: rows.length, source })
  const run = (source: LookupSource, fetchPage: LookupDeps['fetchPage'], extra: Partial<LookupRequest> = {}) =>
    runLookup(
      { searchText: '역삼동 1', limit: 10, timeoutMs: 5000, source, ...extra },
      { fetchPage, throttle: async () => undefined, now: () => 1 },
      new AbortController().signal,
    )

  it('기본(epost)은 우체국만 조회하고 meta.source 는 epost', async () => {
    const calls: Source[] = []
    const r = await run('epost', async (_k, _i, _s, src) => { calls.push(src); return mkPage(src, []) })
    expect(calls).toEqual(['epost'])
    expect(r).toMatchObject({ ok: true, candidates: [], meta: { source: 'epost' } })
  })

  it('juso 는 juso 만 조회', async () => {
    const calls: Source[] = []
    const r = await run('juso', async (_k, _i, _s, src) => { calls.push(src); return mkPage(src, [mkRow('06236', 'A로 1')]) })
    expect(calls).toEqual(['juso'])
    expect(r).toMatchObject({ ok: true, meta: { source: 'juso' } })
  })

  it('auto: 우체국 후보가 없으면 juso 로 대체하고 meta.source 가 juso', async () => {
    const calls: Source[] = []
    const r = await run('auto', async (_k, _i, _s, src) => {
      calls.push(src)
      return mkPage(src, src === 'juso' ? [mkRow('06236', 'A로 1')] : [])
    })
    expect(calls).toEqual(['epost', 'juso'])
    expect(r.ok && r.candidates).toHaveLength(1)
    expect(r.ok && r.meta.source).toBe('juso')
  })

  it('auto: 우체국에 후보가 있으면 juso 를 부르지 않는다', async () => {
    const calls: Source[] = []
    await run('auto', async (_k, _i, _s, src) => { calls.push(src); return mkPage(src, [mkRow('06236', 'A로 1')]) })
    expect(calls).toEqual(['epost'])
  })

  it('auto 에서 구우편번호 검색어는 juso 로 대체하지 않는다', async () => {
    const calls: Source[] = []
    await run('auto', async (_k, _i, _s, src) => { calls.push(src); return mkPage(src, []) }, { searchText: undefined, oldZip: '135924' })
    expect(calls).toEqual(['epost'])
  })

  it('juso 로 구우편번호만 조회하면 unsupported_query', async () => {
    const r = await run('juso', async (_k, _i, _s, src) => mkPage(src, []), { searchText: undefined, oldZip: '135924' })
    expect(r).toMatchObject({ ok: false, error: { code: 'unsupported_query' } })
  })
})

describe('validateLookup source', () => {
  const msg = (options: unknown) => ({ query: { searchText: 'a' }, options }) as Record<string, unknown>
  it('기본은 epost, 허용값만 받는다', () => {
    expect(validateLookup(msg(undefined))).toMatchObject({ ok: true, req: { source: 'epost' } })
    expect(validateLookup(msg({ source: 'auto' }))).toMatchObject({ ok: true, req: { source: 'auto' } })
    expect(validateLookup(msg({ source: 'x' }))).toMatchObject({ ok: false })
  })
})

describe('runLookup 입력 분석 검색(oldAddr)', () => {
  const row = (zip: string, road: string, name: string, extra: Partial<ZipcodeResult> = {}): ZipcodeResult => ({
    zipcode: zip, roadAddress: road, jibunAddress: '경기도 오산시 금암동 1', buildingName: name, ...extra,
  })
  const page = (source: Source, rows: ZipcodeResult[]): SearchPage => ({ results: rows, hasMore: false, nextTargetRow: 2, total: rows.length, source })
  const good = row('18109', '경기도 오산시 여계산로 7', '금암마을 휴먼시아 데시앙', { dongText: '101동~120동' })
  const other = row('18110', '경기도 오산시 수청로 209', '금암마을휴먼시아')
  const run = (req: Partial<LookupRequest>, fetchPage: LookupDeps['fetchPage']) =>
    runLookup(
      { oldAddr: '경기도 오산시 금암동 금암마을휴먼시아데시앙6단지아파트 105동', limit: 10, timeoutMs: 5000, source: 'epost', ...req },
      { fetchPage, throttle: async () => undefined, now: () => 1 },
      new AbortController().signal,
    )

  it('oldAddr 가 있으면 건물명까지 분석해 여러 검색어로 조회하고 점수순 후보와 근거를 돌려준다', async () => {
    const keywords: string[] = []
    const r = await run({}, async (kw, _i, _s, src) => { keywords.push(kw); return page(src, [other, good]) })
    expect(new Set(keywords).size).toBeGreaterThan(1)
    expect(keywords.some((k) => k.includes('금암마을'))).toBe(true)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.candidates.map((c) => c.zip5)).toEqual(['18109', '18110'].sort((a) => (a === '18109' ? -1 : 1)))
      expect(r.candidates[0]).toMatchObject({ name: '금암마을 휴먼시아 데시앙', dongs: '101동~120동', match: { score: expect.any(Number) } })
      expect(r.meta).toMatchObject({ analyzed: true, parserVersion: expect.any(String) })
    }
  })

  it('analyze:false 이거나 oldAddr 가 없으면 기존처럼 searchText 한 번만 조회한다', async () => {
    for (const req of [{ analyze: false, searchText: '금암동 1' }, { oldAddr: undefined, searchText: '금암동 1' }]) {
      const keywords: string[] = []
      await run(req, async (kw, _i, _s, src) => { keywords.push(kw); return page(src, [good]) })
      expect(keywords).toEqual(['금암동 1'])
    }
  })

  it('앱이 보낸 searchText 도 마지막 검색어로 함께 쓴다', async () => {
    const keywords: string[] = []
    await run({ searchText: '오산시 금암동' }, async (kw, _i, _s, src) => { keywords.push(kw); return page(src, []) })
    expect(keywords).toContain('오산시 금암동')
  })

  it('juso 를 지정하면 juso 만 쓴다', async () => {
    const sources = new Set<Source>()
    await run({ source: 'juso' }, async (_k, _i, _s, src) => { sources.add(src); return page(src, [good]) })
    expect([...sources]).toEqual(['juso'])
  })

  it('모든 조회가 실패하면 빈 결과가 아니라 오류로 알린다(차단 포함)', async () => {
    const r = await run({}, async () => { throw new BlockedError() })
    expect(r).toMatchObject({ ok: false, error: { code: 'blocked' } })
  })

  it('일부 검색어만 실패하면 성공한 결과로 이어간다', async () => {
    let n = 0
    const r = await run({}, async (_k, _i, _s, src) => {
      if (n++ === 0) throw new TypeError('fetch failed')
      return page(src, [good])
    })
    expect(r.ok).toBe(true)
  })
})
