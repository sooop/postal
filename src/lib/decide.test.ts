import { describe, expect, it } from 'vitest'
import { canDecideFrom, parseDecideInput, prepareCandidates, reconcile, recommend, validateDecision } from './decide'
import { DEFAULT_APP_URL, effectiveAppUrl, normalizeAppUrl, sanitizeSettings } from './settings'
import type { ZipcodeResult } from './search'

const refs = ['c0', 'c1', 'c2']
const ok = (over: Record<string, unknown> = {}) => ({
  ok: true,
  scores: [{ ref: 'c0', p: 0.2 }, { ref: 'c1', p: 0.7 }, { ref: 'c2', p: 0.05 }],
  pNone: 0.05, meta: { engine: 'ai', elapsedMs: 123 }, ...over,
})

describe('validateDecision', () => {
  it('정상 응답은 p 내림차순으로 정렬하고 추천을 계산한다', () => {
    const v = validateDecision(ok(), refs)
    expect(v.ok && v.view.scores.map((s) => s.ref)).toEqual(['c1', 'c0', 'c2'])
    expect(v.ok && v.view.recommendedRef).toBe('c1')
    expect(v.ok && v.view.engine).toBe('ai')
  })
  it('합이 허용 오차 안이면 통과, 벗어나면 거부', () => {
    expect(validateDecision(ok({ pNone: 0.055 }), refs).ok).toBe(true)
    expect(validateDecision(ok({ pNone: 0.2 }), refs).ok).toBe(false)
  })
  it('signals 는 열거값만 남긴다', () => {
    const v = validateDecision(ok({
      scores: [{ ref: 'c0', p: 0.2, signals: { dong: 'match', bunji: 'zzz', evil: 1 } }, { ref: 'c1', p: 0.7 }, { ref: 'c2', p: 0.05 }],
    }), refs)
    expect(v.ok && v.view.scores.find((s) => s.ref === 'c0')?.signals).toEqual({ dong: 'match' })
  })
  it('ok 가 true 가 아니면 거부', () => {
    expect(validateDecision({ scores: [] }, refs).ok).toBe(false)
  })
})

describe('recommend', () => {
  it('최고 p ≥ 0.7 이고 2위와 0.2 이상 차이일 때만 추천', () => {
    expect(recommend([{ ref: 'a', p: 0.8 }, { ref: 'b', p: 0.1 }])).toBe('a')
    expect(recommend([{ ref: 'a', p: 0.69 }, { ref: 'b', p: 0.1 }])).toBeNull()
    expect(recommend([{ ref: 'a', p: 0.75 }, { ref: 'b', p: 0.6 }])).toBeNull()
    expect(recommend([])).toBeNull()
  })
  it('임계값은 설정으로 바꿀 수 있다', () => {
    expect(recommend([{ ref: 'a', p: 0.5 }, { ref: 'b', p: 0.1 }], { minP: 0.5, minGap: 0.1 })).toBe('a')
  })
})

describe('prepareCandidates / canDecideFrom', () => {
  const r = (over: Partial<ZipcodeResult>): ZipcodeResult => ({ zipcode: '06236', roadAddress: 'A로 1', jibunAddress: 'A동', ...over })
  it('범위·도로명 없음은 제외하고 ref 를 순서대로 붙이며 20건으로 제한', () => {
    const list = [r({}), r({ range: true }), r({ roadAddress: '' }), r({ roadAddress: 'B로 2', detail: '가', oldZipcode: '135924' })]
    const { candidates, byRef } = prepareCandidates(list)
    expect(candidates.map((c) => c.ref)).toEqual(['c0', 'c1'])
    expect(candidates[1]).toMatchObject({ zip5: '06236', road: 'B로 2', detail: '가', oldZip: '135924' })
    expect(byRef.c1).toBe(list[3])
    const many = Array.from({ length: 30 }, (_, i) => r({ roadAddress: `R${i}` }))
    expect(prepareCandidates(many).candidates).toHaveLength(20)
  })
  it('숫자만 입력한 검색은 판정할 구주소가 없다', () => {
    expect(canDecideFrom('역삼동 736-1')).toBe(true)
    expect(canDecideFrom('135-924')).toBe(false)
    expect(canDecideFrom('135924')).toBe(false)
    expect(canDecideFrom('  ')).toBe(false)
  })
})

describe('parseDecideInput', () => {
  const base = { query: { oldAddr: '역삼동 736-1' }, candidates: [{ ref: 'c0', zip5: '06236', road: 'A로 1' }] }
  it('정상 입력', () => expect(parseDecideInput(base).ok).toBe(true))
  it('oldAddr 누락·후보 0건·21건·ref 중복·zip 오류는 거부', () => {
    expect(parseDecideInput({ ...base, query: {} }).ok).toBe(false)
    expect(parseDecideInput({ ...base, candidates: [] }).ok).toBe(false)
    expect(parseDecideInput({ ...base, candidates: Array.from({ length: 21 }, (_, i) => ({ ref: `c${i}`, zip5: '06236', road: 'A' })) }).ok).toBe(false)
    expect(parseDecideInput({ ...base, candidates: [base.candidates[0], base.candidates[0]] }).ok).toBe(false)
    expect(parseDecideInput({ ...base, candidates: [{ ref: 'c0', zip5: '1234', road: 'A' }] }).ok).toBe(false)
  })
})

describe('settings', () => {
  it('아티팩트 URL 만 허용한다', () => {
    expect(normalizeAppUrl('https://claude.ai/artifact/abc-123_X?x=1#y')).toBe('https://claude.ai/artifact/abc-123_X')
    expect(normalizeAppUrl('https://claude.ai/artifact/abc?utm=1&sk=Ab-1_x#y')).toBe('https://claude.ai/artifact/abc?sk=Ab-1_x')
    expect(normalizeAppUrl('https://claude.ai/artifact/abc?sk=bad%20key')).toBeNull()
    expect(normalizeAppUrl('https://claude.ai/code/artifact/0a1b2c3d-0000-4000-8000-000000000000')).toBe('https://claude.ai/code/artifact/0a1b2c3d-0000-4000-8000-000000000000')
    expect(normalizeAppUrl('http://claude.ai/artifact/abc')).toBeNull()
    expect(normalizeAppUrl('https://evil.com/artifact/abc')).toBeNull()
    expect(normalizeAppUrl('https://claude.ai.evil.com/artifact/abc')).toBeNull()
    expect(normalizeAppUrl('https://claude.ai/chat/abc')).toBeNull()
    expect(normalizeAppUrl('javascript:alert(1)')).toBeNull()
  })
  it('저장값이 깨져 있어도 기본값으로 복구하고 판정·AI 는 기본 켜짐, 자동 요청은 꺼짐', () => {
    expect(sanitizeSettings(undefined)).toMatchObject({ decideEnabled: true, autoDecide: false, appUrl: '' })
    expect(sanitizeSettings({ decideEnabled: 'yes', appUrl: 'https://evil.com', thresholds: { minP: 9 } }))
      .toMatchObject({ decideEnabled: true, appUrl: '', thresholds: { minP: 0.7, minGap: 0.2 } })
  })
})

describe('기본 앱 주소', () => {
  it('기본값은 정규화를 통과하고 sk 를 보존한다', () => {
    expect(normalizeAppUrl(DEFAULT_APP_URL)).toBe(DEFAULT_APP_URL)
  })
  it('오버라이드가 비어 있으면 기본값, 있으면 오버라이드', () => {
    expect(effectiveAppUrl({ appUrl: '' })).toBe(DEFAULT_APP_URL)
    expect(effectiveAppUrl({ appUrl: 'https://claude.ai/artifact/zzz' })).toBe('https://claude.ai/artifact/zzz')
  })
})

describe('후보 확장 필드와 reconcile', () => {
  const r = (over: Partial<ZipcodeResult>): ZipcodeResult => ({ zipcode: '06236', roadAddress: 'A로 1', jibunAddress: 'A동', ...over })
  it('건물명·동 목록·로컬 점수를 후보에 싣고, 입력 검증을 통과한다', () => {
    const { candidates } = prepareCandidates([r({ buildingName: '우성', dongText: '1동, 2동', match: { score: 7.26, why: ['지역', '건물명 일치'] } })])
    expect(candidates[0]).toMatchObject({ name: '우성', dongs: '1동, 2동', hint: { score: 7.3, why: ['지역', '건물명 일치'] } })
    const parsed = parseDecideInput({ query: { oldAddr: '우성' }, candidates })
    expect(parsed.ok && parsed.req.candidates[0]).toMatchObject({ name: '우성', dongs: '1동, 2동', hint: { score: 7.3 } })
  })
  it('로컬이 확신하는 1순위와 앱 추천이 다르면 추천을 보류한다', () => {
    const byRef = { c0: r({ match: { score: 10, why: [] } }), c1: r({ match: { score: 4, why: [] } }) }
    expect(reconcile({ recommendedRef: 'c1' }, byRef)).toEqual({ recommendedRef: null, conflict: true })
    expect(reconcile({ recommendedRef: 'c0' }, byRef)).toEqual({ recommendedRef: 'c0', conflict: false })
  })
  it('로컬도 불확실하거나 점수가 없으면 앱 추천을 그대로 쓴다', () => {
    const close = { c0: r({ match: { score: 6, why: [] } }), c1: r({ match: { score: 5.5, why: [] } }) }
    expect(reconcile({ recommendedRef: 'c1' }, close)).toEqual({ recommendedRef: 'c1', conflict: false })
    expect(reconcile({ recommendedRef: 'c1' }, { c0: r({}), c1: r({}) })).toEqual({ recommendedRef: 'c1', conflict: false })
    expect(reconcile({ recommendedRef: null }, close)).toEqual({ recommendedRef: null, conflict: false })
  })
})
