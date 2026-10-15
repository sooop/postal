import { describe, expect, it } from 'vitest'
import { ago, decisionKey, isReusable, signatureOf, toRecord } from './decideCache'
import type { DecisionView } from './decide'

const cands = [
  { zip5: '18109', road: '경기도 오산시 여계산로 7' },
  { zip5: '18110', road: '경기도 오산시 수청로 209 (금암동)' },
]
const view: DecisionView = {
  scores: [{ ref: 'c0', p: 0.8 }, { ref: 'c1', p: 0.1 }], pNone: 0.1, engine: 'ai', recommendedRef: 'c0',
}

describe('decideCache', () => {
  it('검색어 키는 공백만 정리한다', () => {
    expect(decisionKey('  오산시   금암동 ')).toBe('오산시 금암동')
  })
  it('서명은 도로명 표기(시도 줄임·괄호)와 무관하고 순서를 구분한다', () => {
    expect(signatureOf(cands)).toBe(signatureOf([{ zip5: '18109', road: '경기 오산시 여계산로 7' }, { zip5: '18110', road: '경기도 오산시 수청로 209' }]))
    expect(signatureOf(cands)).not.toBe(signatureOf([...cands].reverse()))
  })
  it('후보 목록이 같을 때만 재사용한다', () => {
    const rec = toRecord('오산시 금암동', cands, view, 1000)
    expect(isReusable(rec, cands)).toBe(true)
    expect(isReusable(rec, cands.slice(0, 1))).toBe(false)
    expect(isReusable(rec, [...cands, { zip5: '18111', road: '경기도 오산시 A로 1' }])).toBe(false)
    expect(isReusable(undefined, cands)).toBe(false)
  })
  it('경과 시간 표시', () => {
    const now = 10_000_000
    expect(ago(now - 5_000, now)).toBe('방금')
    expect(ago(now - 180_000, now)).toBe('3분 전')
    expect(ago(now - 7_200_000, now)).toBe('2시간 전')
    expect(ago(now - 3 * 86_400_000, now)).toBe('3일 전')
  })
})
