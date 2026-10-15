import { describe, expect, it, vi } from 'vitest'
import { BlockedError } from './epost'
import { withPageCache, type PageStore } from './pageCache'
import type { Fetchers } from './provider'
import type { SearchPage } from './search'

const page = (n: number, source: 'epost' | 'juso' = 'epost'): SearchPage => ({
  results: Array.from({ length: n }, (_, i) => ({ zipcode: '06236', roadAddress: `A로 ${i + 1}`, jibunAddress: '' })),
  hasMore: false, nextTargetRow: 2, total: n, source,
})

function memStore(): PageStore & { map: Map<string, { page: SearchPage; at: number }> } {
  const map = new Map<string, { page: SearchPage; at: number }>()
  return { map, get: async (k) => map.get(k), put: async (k, p, at) => { map.set(k, { page: p, at }) } }
}

const none = (): Fetchers['juso'] => vi.fn() as unknown as Fetchers['juso']

describe('withPageCache', () => {
  it('같은 요청은 TTL 안에서 조회처를 다시 부르지 않는다', async () => {
    const epost = vi.fn(async () => page(2))
    const f = withPageCache({ epost, juso: none() }, memStore(), { now: () => 1000 })
    expect((await f.epost('역삼동 736-1', 1, 10)).results).toHaveLength(2)
    expect((await f.epost(' 역삼동 736-1 ', 1, 10)).results).toHaveLength(2)
    expect(epost).toHaveBeenCalledTimes(1)
    await f.epost('역삼동 736-1', 2, 10)
    expect(epost).toHaveBeenCalledTimes(2)
  })
  it('조회처별로 따로 저장하고, 만료되면 다시 조회한다', async () => {
    let t = 0
    const epost = vi.fn(async () => page(1))
    const juso = vi.fn(async () => page(1, 'juso'))
    const f = withPageCache({ epost, juso }, memStore(), { now: () => t, ttlMs: 100 })
    await f.epost('x', 1, 10)
    await f.juso('x', 1, 10)
    expect([epost.mock.calls.length, juso.mock.calls.length]).toEqual([1, 1])
    t = 99
    await f.epost('x', 1, 10)
    expect(epost).toHaveBeenCalledTimes(1)
    t = 100
    await f.epost('x', 1, 10)
    expect(epost).toHaveBeenCalledTimes(2)
  })
  it('빈 응답은 저장하지 않는다', async () => {
    const store = memStore()
    const epost = vi.fn(async () => page(0))
    const f = withPageCache({ epost, juso: none() }, store)
    await f.epost('x', 1, 10)
    await f.epost('x', 1, 10)
    expect(epost).toHaveBeenCalledTimes(2)
    expect(store.map.size).toBe(0)
  })
  it('저장소가 고장 나도 조회는 계속된다', async () => {
    const broken: PageStore = { get: async () => { throw new Error('idb') }, put: async () => { throw new Error('idb') } }
    const f = withPageCache({ epost: async () => page(1), juso: none() }, broken)
    expect((await f.epost('x', 1, 10)).results).toHaveLength(1)
  })
  it('차단 감지와 해제를 알린다', async () => {
    const calls: boolean[] = []
    let blocked = true
    const epost = vi.fn(async () => {
      if (blocked) throw new BlockedError()
      return page(1)
    })
    const f = withPageCache({ epost, juso: none() }, memStore(), { onBlocked: (b) => calls.push(b) })
    await expect(f.epost('x', 1, 10)).rejects.toBeInstanceOf(BlockedError)
    blocked = false
    await f.epost('x', 1, 10)
    expect(calls).toEqual([true, false])
  })
})
