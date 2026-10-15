import { describe, expect, it } from 'vitest'
import { formatCopy, isCopyFormat } from './copy'

const r = { zipcode: '05571', roadAddress: '서울특별시 송파구 올림픽로4길 42', jibunAddress: '서울특별시 송파구 잠실동 1' }

describe('formatCopy', () => {
  it('형식별 문자열', () => {
    expect(formatCopy('zip', r)).toBe('05571')
    expect(formatCopy('address', r)).toBe('서울특별시 송파구 올림픽로4길 42')
    expect(formatCopy('full', r)).toBe('05571 서울특별시 송파구 올림픽로4길 42')
  })
  it('도로명주소가 없으면 지번주소로, 둘 다 없으면 우편번호로', () => {
    expect(formatCopy('address', { ...r, roadAddress: '' })).toBe('서울특별시 송파구 잠실동 1')
    expect(formatCopy('full', { zipcode: '05571', roadAddress: '', jibunAddress: '' })).toBe('05571')
  })
  it('형식 검증', () => {
    expect(isCopyFormat('full')).toBe(true)
    expect(isCopyFormat('x')).toBe(false)
  })
})
