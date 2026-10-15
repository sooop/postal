import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchZipcdList, HttpError, BlockedError } from './epost'
import { fetchJusoList } from './juso'
import { isBlocked, userMessage } from './errors'
import { toBridgeError } from './lookup'

const reply = (body: string, status = 200) => vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })))
afterEach(() => vi.unstubAllGlobals())

describe('차단 감지', () => {
  it('JSON 대신 HTML 이 오면 BlockedError', async () => {
    reply('<!DOCTYPE html><html><body>captcha</body></html>')
    await expect(fetchZipcdList('x')).rejects.toBeInstanceOf(BlockedError)
    reply('  <html lang="ko">')
    await expect(fetchJusoList('x')).rejects.toBeInstanceOf(BlockedError)
  })
  it('HTML 이 아닌 깨진 본문은 SyntaxError(형식 오류)', async () => {
    reply('not json')
    await expect(fetchZipcdList('x')).rejects.toBeInstanceOf(SyntaxError)
  })
  it('정상 JSON 은 그대로 돌려준다', async () => {
    reply('{"totCnt":0,"newZipcdList":[]}')
    await expect(fetchZipcdList('x')).resolves.toEqual({ totCnt: 0, newZipcdList: [] })
  })
  it('오류를 차단·사용자 문구·프로토콜 오류로 분류한다', () => {
    expect(isBlocked(new BlockedError())).toBe(true)
    expect(isBlocked(new HttpError(403))).toBe(true)
    expect(isBlocked(new HttpError(500))).toBe(false)
    expect(userMessage(new BlockedError())).toContain('접근을 막았습니다')
    expect(userMessage(new HttpError(429))).toContain('잦습니다')
    expect(userMessage(new TypeError('x'))).toContain('네트워크')
    expect(toBridgeError(new BlockedError()).code).toBe('blocked')
  })
})
