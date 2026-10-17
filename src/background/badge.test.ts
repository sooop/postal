import { describe, expect, it } from 'vitest'
import { badgeView } from './badge'

describe('badgeView', () => {
  it('차단이 대기 건수보다 우선한다', () => {
    expect(badgeView(true, 3)).toMatchObject({ text: '!', color: '#dc2626' })
  })
  it('대기 건수를 표시하고 99 를 넘으면 줄인다', () => {
    expect(badgeView(false, 2).text).toBe('2')
    expect(badgeView(false, 150).text).toBe('99+')
  })
  it('아무 것도 없으면 배지를 비운다', () => {
    expect(badgeView(false, 0).text).toBe('')
  })
  it('앱 요청 처리 중에만 작동 중 아이콘을 쓰고, 차단되면 평상시 아이콘으로 둔다', () => {
    expect(badgeView(false, 1).icon).toBe('busy')
    expect(badgeView(false, 0).icon).toBe('idle')
    expect(badgeView(true, 3).icon).toBe('idle')
  })
})
