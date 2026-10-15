import { describe, expect, it } from 'vitest'
import { DecideClient, type AppEndpoint } from './decide'
import type { CandidateInput, DecideRequest } from '@/lib/decide'

type Msg = Record<string, any>

const cands: CandidateInput[] = [
  { ref: 'c0', zip5: '06236', road: '서울특별시 강남구 테헤란로 142' },
  { ref: 'c1', zip5: '06237', road: '서울특별시 강남구 논현로 429' },
]
const req = (over: Partial<DecideRequest> = {}): DecideRequest => ({
  oldAddr: '서울시 강남구 역삼동 736-1', candidates: cands, engine: 'local', timeoutMs: 2000, ...over,
})

const goodDecision = (id: string, over: Msg = {}): Msg => ({
  type: 'decision', id, ok: true,
  scores: [{ ref: 'c0', p: 0.86, reason: '동·번지 일치' }, { ref: 'c1', p: 0.04 }],
  pNone: 0.1, bestRef: 'c0', verdict: 'match', meta: { engine: 'local' }, ...over,
})

/** 앱 프레임 흉내. decide 에 대한 응답 동작을 바꿔 가며 쓴다 */
class FakeApp implements AppEndpoint {
  sent: Msg[] = []
  alive = true
  engines = ['local', 'ai']
  onDecide: (m: Msg) => void = (m) => this.client.onAppMessage(this, goodDecision(m.id) as any)
  constructor(public client: DecideClient, public tabId?: number) {}

  ready(id = 'init') {
    this.client.onAppMessage(this, {
      type: 'ready', id, ok: true, features: ['decide'], supportedVersions: [1],
      engines: this.engines, limits: { maxCandidates: 20 }, appVersion: 't',
    } as any)
  }
  send(msg: Msg) {
    this.sent.push(msg)
    if (msg.type === 'probe' && this.alive) queueMicrotask(() => this.ready(msg.id))
    if (msg.type === 'decide') queueMicrotask(() => this.onDecide(msg))
  }
  of(type: string) { return this.sent.filter((m) => m.type === type) }
}

function make(extra: Partial<ConstructorParameters<typeof DecideClient>[0]> = {}) {
  const opened: string[] = []
  const closed: number[] = []
  let n = 0
  const client = new DecideClient({
    uuid: () => `id${++n}`,
    openTab: async (url) => { opened.push(url); return 77 },
    closeTab: async (id) => { closed.push(id) },
    idleCloseMs: 20,
    readyTimeoutMs: 80,
    ...extra,
  })
  return { client, opened, closed }
}

describe('DecideClient', () => {
  it('열려 있는 앱에 판정을 요청하고 검증된 결과를 돌려준다', async () => {
    const { client } = make()
    const app = new FakeApp(client); app.ready()
    const r = await client.decide(req(), { appUrl: '' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.view.scores.map((s) => s.ref)).toEqual(['c0', 'c1'])
      expect(r.view.recommendedRef).toBe('c0')
    }
    const sent = app.of('decide')[0]
    expect(sent.query.oldAddr).toBe('서울시 강남구 역삼동 736-1')
    expect(sent.candidates).toHaveLength(2)
    expect(sent.options).toEqual({ engine: 'local', timeoutMs: 2000 })
  })

  it('응답하지 않는 앱은 probe 로 걸러내고, 앱도 URL 도 없으면 app_unavailable', async () => {
    const { client } = make()
    const app = new FakeApp(client); app.ready(); app.alive = false
    const r = await client.decide(req(), { appUrl: '' })
    expect(r).toMatchObject({ ok: false, error: { code: 'app_unavailable' } })
    expect(app.of('decide')).toHaveLength(0)
  }, 10000)

  it('앱이 없으면 저장된 URL 을 열고 ready 를 기다린 뒤 판정하고, 확장이 연 탭은 나중에 닫는다', async () => {
    const stages: string[] = []
    const { client, opened, closed } = make()
    const app = new FakeApp(client, 77)
    ;(client as any).deps.openTab = async (url: string) => { opened.push(url); setTimeout(() => app.ready(), 10); return 77 }
    const r = await client.decide(req(), { appUrl: 'https://claude.ai/artifact/abc', onStage: (s) => stages.push(s) })
    expect(r.ok).toBe(true)
    expect(opened).toEqual(['https://claude.ai/artifact/abc'])
    expect(stages).toEqual(['connecting', 'waiting'])
    await new Promise((res) => setTimeout(res, 60))
    expect(closed).toEqual([77])
  })

  it('앱이 시간 안에 준비되지 않으면 app_unavailable 이고 연 탭을 닫는다', async () => {
    const { client, closed } = make()
    const r = await client.decide(req(), { appUrl: 'https://claude.ai/artifact/abc' })
    expect(r).toMatchObject({ ok: false, error: { code: 'app_unavailable' } })
    expect(closed).toEqual([77])
  })

  it('사용자가 연 탭(열려 있던 앱)은 닫지 않는다', async () => {
    const { client, closed } = make()
    const app = new FakeApp(client, 5); app.ready()
    await client.decide(req(), { appUrl: '' })
    await new Promise((res) => setTimeout(res, 60))
    expect(closed).toEqual([])
  })

  it('engine ai 인데 앱이 local 만 지원하면 요청을 보내지 않고 ai_unavailable', async () => {
    const { client } = make()
    const app = new FakeApp(client); app.engines = ['local']; app.ready()
    const r = await client.decide(req({ engine: 'ai' }), { appUrl: '' })
    expect(r).toMatchObject({ ok: false, error: { code: 'ai_unavailable' } })
    expect(app.of('decide')).toHaveLength(0)
  })

  it('앱이 보낸 오류 코드를 그대로 전달하고, 모르는 코드는 internal', async () => {
    const { client } = make()
    const app = new FakeApp(client); app.ready()
    app.onDecide = (m) => client.onAppMessage(app, { type: 'decision', id: m.id, ok: false, error: { code: 'busy', message: '처리 중' } } as any)
    expect(await client.decide(req(), { appUrl: '' })).toMatchObject({ ok: false, error: { code: 'busy', retryable: true } })
    app.onDecide = (m) => client.onAppMessage(app, { type: 'decision', id: m.id, ok: false, error: { code: 'weird' } } as any)
    expect(await client.decide(req(), { appUrl: '' })).toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('E2/E3. ref 누락·미지의 ref·확률 합 오류 응답은 버린다', async () => {
    const { client } = make()
    const app = new FakeApp(client); app.ready()
    const cases: Msg[] = [
      { scores: [{ ref: 'c0', p: 0.9 }] }, // ref 누락
      { scores: [{ ref: 'c0', p: 0.5 }, { ref: 'zz', p: 0.4 }] }, // 미지의 ref
      { scores: [{ ref: 'c0', p: 0.5 }, { ref: 'c0', p: 0.4 }] }, // 중복
      { scores: [{ ref: 'c0', p: 0.9 }, { ref: 'c1', p: 0.9 }], pNone: 0 }, // 합 > 1
      { scores: [{ ref: 'c0', p: 1.2 }, { ref: 'c1', p: 0 }], pNone: 0 }, // 범위
    ]
    for (const c of cases) {
      app.onDecide = (m) => client.onAppMessage(app, goodDecision(m.id, c) as any)
      expect(await client.decide(req(), { appUrl: '' })).toMatchObject({ ok: false, error: { code: 'internal' } })
    }
  })

  it('E4. reason 의 HTML 은 문자열 그대로(길이만 제한) 전달된다', async () => {
    const { client } = make()
    const app = new FakeApp(client); app.ready()
    const html = '<img src=x onerror=alert(1)>' + 'ㄱ'.repeat(200)
    app.onDecide = (m) => client.onAppMessage(app, goodDecision(m.id, { scores: [{ ref: 'c0', p: 0.86, reason: html }, { ref: 'c1', p: 0.04 }] }) as any)
    const r = await client.decide(req(), { appUrl: '' })
    expect(r.ok && r.view.scores[0].reason).toBe(html.slice(0, 80))
  })

  it('E6. 무응답이면 timeoutMs 뒤 cancel 을 보내고 timeout, 늦은 decision 은 무시', async () => {
    const { client } = make()
    const app = new FakeApp(client); app.ready()
    let late: Msg | undefined
    app.onDecide = (m) => { late = m }
    const r = await client.decide(req({ timeoutMs: 40 }), { appUrl: '' })
    expect(r).toMatchObject({ ok: false, error: { code: 'timeout', retryable: true } })
    expect(app.of('cancel')).toHaveLength(1)
    client.onAppMessage(app, goodDecision(late!.id) as any) // 늦게 도착해도 아무 일 없음
    // 다음 판정은 정상 동작
    app.onDecide = (m) => client.onAppMessage(app, goodDecision(m.id) as any)
    expect((await client.decide(req(), { appUrl: '' })).ok).toBe(true)
  })

  it('취소하면 cancel 을 보내고 cancelled', async () => {
    const { client } = make()
    const app = new FakeApp(client); app.ready()
    app.onDecide = () => undefined
    const ctrl = new AbortController()
    const p = client.decide(req(), { appUrl: '', signal: ctrl.signal })
    await new Promise((res) => setTimeout(res, 20))
    ctrl.abort()
    expect(await p).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(app.of('cancel')).toHaveLength(1)
  })

  it('한 번에 하나씩만 보낸다(직렬)', async () => {
    const { client } = make()
    const app = new FakeApp(client); app.ready()
    const order: string[] = []
    app.onDecide = (m) => setTimeout(() => { order.push(`done:${m.id}`); client.onAppMessage(app, goodDecision(m.id) as any) }, 30)
    const a = client.decide(req(), { appUrl: '' })
    const b = client.decide(req(), { appUrl: '' })
    await Promise.all([a, b])
    const sentIds = app.of('decide').map((m) => m.id)
    expect(sentIds).toHaveLength(2)
    expect(order[0]).toBe(`done:${sentIds[0]}`) // 첫 응답이 끝난 뒤에 두 번째를 보냈다
  })

  it('다른 프레임이 보낸 decision 은 무시한다', async () => {
    const { client } = make()
    const app = new FakeApp(client); app.ready()
    const other = new FakeApp(client)
    app.onDecide = (m) => { client.onAppMessage(other, goodDecision(m.id) as any); setTimeout(() => client.onAppMessage(app, goodDecision(m.id, { pNone: 0.1 }) as any), 20) }
    const r = await client.decide(req(), { appUrl: '' })
    expect(r.ok).toBe(true)
    expect(other.sent).toHaveLength(0)
  })

  it('progress 의 stage 를 전달한다(알려진 값만)', async () => {
    const { client } = make()
    const app = new FakeApp(client); app.ready()
    const stages: string[] = []
    app.onDecide = (m) => {
      client.onAppMessage(app, { type: 'progress', id: m.id, stage: 'asking_ai' } as any)
      client.onAppMessage(app, { type: 'progress', id: m.id, stage: 'hack' } as any)
      client.onAppMessage(app, goodDecision(m.id) as any)
    }
    await client.decide(req(), { appUrl: '', onStage: (s) => stages.push(s) })
    expect(stages).toEqual(['asking_ai'])
  })

  it('decide 를 지원하지 않는 ready 는 등록하지 않는다', async () => {
    const { client } = make()
    const app = new FakeApp(client)
    client.onAppMessage(app, { type: 'ready', id: 'init', features: ['lookup'] } as any)
    const r = await client.decide(req(), { appUrl: '' })
    expect(r).toMatchObject({ ok: false, error: { code: 'app_unavailable' } })
  })
})

describe('DecideClient 연결 탐색', () => {
  it('앱의 최초 ready 를 놓쳤어도, 포트가 연결될 때 greet(probe) 로 등록된다', async () => {
    const { client } = make()
    const app = new FakeApp(client, 9) // ready() 를 한 번도 보내지 않은 프레임
    client.greet(app)
    await new Promise((res) => setTimeout(res, 10))
    const r = await client.decide(req(), { appUrl: '' })
    expect(r.ok).toBe(true)
    expect(app.of('probe').length).toBeGreaterThan(0)
  })

  it('사용자가 보고 있는 탭의 앱 프레임을 먼저 쓴다', async () => {
    const { client } = make()
    const a = new FakeApp(client, 1); a.ready()
    const b = new FakeApp(client, 2); b.ready() // 더 최근에 ready 를 알렸지만 보고 있는 탭은 1번
    const r = await client.decide(req(), { appUrl: '', preferTabId: 1 })
    expect(r.ok).toBe(true)
    expect(a.of('decide')).toHaveLength(1)
    expect(b.of('decide')).toHaveLength(0)
  })

  it('백그라운드 탭이 준비되지 않으면 탭을 앞으로 가져와 더 기다린다', async () => {
    const activated: number[] = []
    const app = (c: DecideClient) => new FakeApp(c, 77)
    const { client } = make({ readyTimeoutMs: 200, foregroundAfterMs: 30, activateTab: async (id) => { activated.push(id) } })
    const a = app(client)
    ;(client as any).deps.openTab = async () => { setTimeout(() => a.ready(), 80); return 77 } // 전면 전환 뒤에 준비됨
    const r = await client.decide(req(), { appUrl: 'https://claude.ai/artifact/abc' })
    expect(activated).toEqual([77])
    expect(r.ok).toBe(true)
  })

  it('연결 자체가 없으면 연결 실패로, 연결은 됐지만 ready 가 없으면 판정 미지원으로 안내한다', async () => {
    const none = make({ readyTimeoutMs: 40, foregroundAfterMs: 20 })
    const r1 = await none.client.decide(req(), { appUrl: 'https://claude.ai/artifact/abc' })
    expect(r1).toMatchObject({ ok: false, error: { code: 'app_unavailable' } })
    expect(!r1.ok && r1.error.message).toContain('연결되지 못했습니다')

    const conn = make({ readyTimeoutMs: 40, foregroundAfterMs: 20 })
    const silent = new FakeApp(conn.client, 77)
    silent.alive = false
    ;(conn.client as any).deps.openTab = async () => { conn.client.greet(silent); return 77 }
    const r2 = await conn.client.decide(req(), { appUrl: 'https://claude.ai/artifact/abc' })
    expect(!r2.ok && r2.error.message).toContain('판정 준비 응답이 없습니다')
  })
})
