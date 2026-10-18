import { describe, expect, it, vi } from 'vitest'
import { CHANNEL, validateCatalog, type CompanionRuntime, type PortLike } from '@claude-ex/sdk'
import { normalizePage } from '@/lib/normalize'
import { HUB_ID } from '@/lib/settings'
import { WEB_QUERY_ADAPTERS } from '@/lib/protocolV2'
import { RequestQueue } from '@/background/queue'
import jibun from '@/lib/__fixtures__/jibun.json'
import { postalCatalog } from './catalog'
import { initPlugin } from './index'

type Msg = Record<string, any>
type RawFetch = (keyword: string, pageIdx: number, pageSize: number, signal: AbortSignal) => Promise<unknown>

const ok: RawFetch = async () => jibun
const hang: RawFetch = (_k, _i, _s, signal) =>
  new Promise((_res, rej) => signal.addEventListener('abort', () => rej(signal.reason), { once: true }))

function fakePort(senderId: string = HUB_ID, name: string = CHANNEL.callPort) {
  const onMsg: ((m: unknown) => void)[] = []
  const onDisc: (() => void)[] = []
  const sent: Msg[] = []
  const port: PortLike = {
    name,
    sender: { id: senderId },
    postMessage: (m) => { sent.push(m as Msg) },
    disconnect: vi.fn(),
    onMessage: { addListener: (fn) => { onMsg.push(fn) } },
    onDisconnect: { addListener: (fn) => { onDisc.push(fn) } },
  }
  return { port, sent, emit: (m: unknown) => onMsg.forEach((f) => f(m)), close: () => onDisc.forEach((f) => f()) }
}

function setup(fetchPage: RawFetch, opts: { queueTimeoutMs?: number } = {}) {
  let connect: (p: PortLike) => void = () => {}
  const sendMessage = vi.fn(async () => ({ status: 'active' }))
  const runtime: CompanionRuntime = { sendMessage, onConnectExternal: { addListener: (fn) => { connect = fn } } }
  const queue = new RequestQueue({ minIntervalMs: 5, maxLength: 50 })
  const cancel = vi.spyOn(queue, 'cancel')
  initPlugin(
    {
      queue, now: Date.now, ...opts,
      fetchPage: async (kw, idx, size, _source, signal) => normalizePage(await fetchPage(kw, idx, size, signal), idx, size),
    },
    { version: '9.9.9', runtime },
  )
  /** 호출 1건: 포트를 열고 invoke 를 보낸다 */
  const call = (adapter: string, args: Record<string, unknown>, timeoutMs = 5000) => {
    const p = fakePort()
    connect(p.port)
    p.emit({ type: 'invoke', op: 'web.query', ver: 1, adapter, args, timeoutMs, sender: { ns: 'app', origin: 'https://x' } })
    const result = async (ms = 3000): Promise<Msg> => {
      const start = Date.now()
      while (Date.now() - start < ms) {
        const hit = p.sent.find((m) => m.type === 'result')
        if (hit) return hit
        await new Promise((r) => setTimeout(r, 5))
      }
      throw new Error('timeout waiting for result')
    }
    return { ...p, result }
  }
  return { connect: (p: PortLike) => connect(p), sendMessage, queue, cancel, call }
}

describe('postal 플러그인', () => {
  it('시작하면 허브 ID 로 카탈로그를 등록한다', async () => {
    const t = setup(ok)
    await new Promise((r) => setTimeout(r, 0))
    expect(t.sendMessage).toHaveBeenCalledWith(HUB_ID, expect.objectContaining({ kind: CHANNEL.register, name: 'postal', version: '9.9.9', catalog: postalCatalog }))
  })

  it('카탈로그가 SDK 검증을 통과하고 어댑터가 매핑과 일치한다', () => {
    expect(validateCatalog(postalCatalog).ok).toBe(true)
    const ids = postalCatalog.adapters['web.query'].map((a) => a.id).sort()
    expect(ids).toEqual(Object.keys(WEB_QUERY_ADAPTERS).sort())
  })

  it('정상 조회: items 와 lookup 정보, 진행 전달', async () => {
    const t = setup(ok)
    const c = t.call('epost-zip', { searchText: '역삼동 736-1' })
    const r = await c.result()
    expect(r.ok).toBe(true)
    expect(r.data.items.length).toBeGreaterThan(0)
    expect(r.data.items[0].zip5).toMatch(/^\d{5}$/)
    expect(r.data.lookup).toMatchObject({ source: 'epost' })
    expect(c.sent.some((m) => m.type === 'progress')).toBe(true)
  })

  it('params 위반은 invalid_request(스키마)', async () => {
    const t = setup(ok)
    const long = await t.call('epost-zip', { searchText: 'a'.repeat(201) }).result()
    const extra = await t.call('epost-zip', { searchText: 'x', url: 'https://evil' }).result()
    const zip = await t.call('epost-zip', { searchText: 'x', oldZip: '12345' }).result()
    const zipText = await t.call('epost-zip', { searchText: 'x', oldZip: '12345a' }).result()
    for (const r of [long, extra, zip]) expect(r.error.code).toBe('invalid_request')
    expect(zipText.error.code).toBe('invalid_request')
  })

  it('입력이 하나도 없으면(공백 포함) invalid_request', async () => {
    const t = setup(ok)
    expect((await t.call('epost-zip', {}).result()).error.code).toBe('invalid_request')
    expect((await t.call('zip-auto', { searchText: '   ' }).result()).error.code).toBe('invalid_request')
  })

  it('어댑터를 모르면 unsupported_op', async () => {
    const t = setup(ok)
    expect((await t.call('nope', { searchText: 'x' }).result()).error.code).toBe('unsupported_op')
  })

  it('허브가 취소하면 큐 항목을 취소한다', async () => {
    const t = setup(hang)
    const c = t.call('epost-zip', { searchText: '역삼동 736-1' })
    await new Promise((r) => setTimeout(r, 20))
    c.emit({ type: 'cancel' })
    const r = await c.result()
    expect(r.error.code).toBe('cancelled')
    expect(t.cancel).toHaveBeenCalledWith(expect.stringMatching(/^plugin:\d+$/))
    expect(t.queue.length).toBe(0)
  })

  it('포트가 끊겨도 큐 항목을 취소한다', async () => {
    const t = setup(hang)
    const c = t.call('epost-zip', { searchText: '역삼동 736-1' })
    await new Promise((r) => setTimeout(r, 20))
    c.close()
    await new Promise((r) => setTimeout(r, 20))
    expect(t.cancel).toHaveBeenCalled()
    expect(t.queue.length).toBe(0)
  })

  it('큐 timeout 은 timeout(재시도 가능)', async () => {
    const t = setup(hang, { queueTimeoutMs: 30 })
    const r = await t.call('epost-zip', { searchText: '역삼동 736-1' }).result()
    expect(r.error).toMatchObject({ code: 'timeout', retryable: true })
  })

  it('허브 timeoutMs 가 먼저 끝나면 큐에서도 빠진다', async () => {
    const t = setup(hang)
    const r = await t.call('epost-zip', { searchText: '역삼동 736-1' }, 30).result()
    expect(r.error.code).toBe('timeout')
    await new Promise((r2) => setTimeout(r2, 20))
    expect(t.queue.length).toBe(0)
  })

  it('허브가 아닌 확장 id 의 연결은 거부하고 호출을 처리하지 않는다', async () => {
    const t = setup(ok)
    const evil = fakePort('someotherextensionidxxxxxxxxxxxxxx')
    t.connect(evil.port)
    expect(evil.port.disconnect).toHaveBeenCalled()
    evil.emit({ type: 'invoke', op: 'web.query', ver: 1, adapter: 'epost-zip', args: { searchText: 'x' }, timeoutMs: 1000, sender: { ns: 'a', origin: 'b' } })
    await new Promise((r) => setTimeout(r, 30))
    expect(evil.sent).toEqual([])
    // sender 없는 연결(웹페이지 등)도 거부
    const anon = fakePort()
    anon.port.sender = undefined
    t.connect(anon.port)
    expect(anon.port.disconnect).toHaveBeenCalled()
  })
})
