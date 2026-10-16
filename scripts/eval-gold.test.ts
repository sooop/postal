// 정답 데이터(__fixtures__/gold.tsv)로 후보 선택 정확도를 측정한다. 실제 조회처를 부르므로 기본은 건너뛴다.
//   EVAL_GOLD=1 EVAL_CACHE=<캐시.json 경로> npx vitest run scripts/eval-gold.test.ts
// EVAL_GOLD_FILE=<tsv 경로> 로 다른 정답 파일을 쓴다(기본: __fixtures__/gold.tsv).
// 끝에 확률 보정 지표(구간별 적중률, 로그손실이 가장 낮은 온도·정답없음 기준점)를 함께 출력한다.
// 캐시 파일에 없는 검색어만 실제로 조회하고(요청 간격 450ms), 결과를 캐시에 저장한다.
import fs from 'node:fs'
import { describe, it } from 'vitest'
import { fetchZipcdList } from '../src/lib/epost'
import { fetchJusoList, normalizeJusoPage } from '../src/lib/juso'
import { normalizePage } from '../src/lib/normalize'
import type { Fetchers } from '../src/lib/provider'
import { roadTail, toProbabilities } from '../src/lib/match/rank'
import { smartSearch } from '../src/lib/match/smart'

const CACHE = process.env.EVAL_CACHE ?? ''
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
type Raw = Record<string, unknown>
const cache: Record<string, unknown> = CACHE && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {}
const save = () => CACHE && fs.writeFileSync(CACHE, JSON.stringify(cache))

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (key in cache) return cache[key] as T
  await sleep(450)
  const v = await load()
  cache[key] = v
  save()
  return v
}

const fetchers: Fetchers = {
  epost: async (k, i, n) => normalizePage(await cached(`e|${k}|${i}|${n}`, () => fetchZipcdList(k, i, n) as Promise<Raw>), i, n),
  juso: async (k, i, n) => normalizeJusoPage(await cached(`j|${k}|${i}|${n}`, async () => {
    const j = (await fetchJusoList(k, i, n)) as { results?: { content?: Raw[] } }
    j.results?.content?.forEach((r) => { delete r.queryString })
    return j
  }), i, n),
}

const goldPath = process.env.EVAL_GOLD_FILE ?? new URL('../src/lib/__fixtures__/gold.tsv', import.meta.url)
const gold = fs.readFileSync(goldPath, 'utf8')
  .split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
    const [old, input, zip5, road] = l.split('\t')
    return { old, input, zip5, road }
  })

/** 1위 확률 구간별 실제 적중률과, 로그손실이 최소인 (온도, 정답없음 기준점) 격자 탐색 */
function calibration(pools: { scores: number[]; idx: number }[]): string {
  const lines: string[] = []
  const bins = [[0, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.9], [0.9, 1.01]]
  for (const [lo, hi] of bins) {
    const hit = pools.filter((x) => x.scores.length && (() => { const p = toProbabilities(x.scores)[0]; return p >= lo && p < hi })())
    const ok = hit.filter((x) => x.idx === 0).length
    lines.push(`1위 확률 ${lo}~${Math.min(hi, 1)}: ${hit.length}건 중 ${ok}건 적중${hit.length ? ` (${Math.round((ok / hit.length) * 100)}%)` : ''}`)
  }
  const loss = (t: number, none: number) => {
    let sum = 0
    for (const x of pools) {
      const p = toProbabilities(x.scores, t, none)
      const q = x.idx >= 0 ? p[x.idx] : 1 - p.reduce((a, b) => a + b, 0)
      sum -= Math.log(Math.max(q, 1e-6))
    }
    return sum / Math.max(pools.length, 1)
  }
  const grid: { t: number; none: number; l: number }[] = []
  for (const t of [0.5, 1, 1.5, 2, 3, 4, 6]) for (const none of [0, 2, 4, 5, 6, 8, 10]) grid.push({ t, none, l: loss(t, none) })
  grid.sort((a, b) => a.l - b.l)
  lines.push(`현재(T=2, none=5) 로그손실 ${loss(2, 5).toFixed(3)}`)
  lines.push(`최적 상위: ${grid.slice(0, 3).map((g) => `T=${g.t},none=${g.none}(${g.l.toFixed(3)})`).join(' ')}`)
  return lines.join('\n')
}

describe.skipIf(!process.env.EVAL_GOLD)('정답 데이터 평가', () => {
  it('후보 풀·1위·3위 안 적중률', async () => {
    const rows: string[] = []
    const pools: { scores: number[]; idx: number }[] = []
    const stat = { n: 0, pool: 0, top1: 0, top3: 0, confOk: 0, confBad: 0, unconf: 0 }
    for (const g of gold) {
      const res = await smartSearch(fetchers, `${g.old.slice(0, 3)}-${g.old.slice(3)} ${g.input}`.replace(/^\S+\s/, (m) => m), { stopWhenConfident: false })
      const isGold = (z: string, r: string) => z === g.zip5 && (!g.road || roadTail(r) === roadTail(g.road))
      const idx = res.ranked.findIndex((c) => isGold(c.result.zipcode, c.result.roadAddress))
      stat.n++
      pools.push({ scores: res.ranked.map((c) => c.score), idx })
      if (idx >= 0) stat.pool++
      if (idx === 0) stat.top1++
      if (idx >= 0 && idx < 3) stat.top3++
      if (res.confident) { if (idx === 0) stat.confOk++; else stat.confBad++ } else stat.unconf++
      const [a, b] = [res.ranked[0]?.score ?? 0, res.ranked[1]?.score ?? 0]
      const show = (c: (typeof res.ranked)[number]) => `${c.result.roadAddress.replace(/^\S+\s/, '')}|${c.result.buildingName ?? ''}|${c.score.toFixed(1)}[${c.why.join(',')}]`
      const shown = [...res.ranked.slice(0, 2), ...(idx > 1 ? [res.ranked[idx]] : [])].map(show)
      const dbg = idx === 0 ? '' : ['', ...shown, `정답: ${g.road}`].join('\n      ')
      rows.push(`${idx === 0 ? 'T1' : idx > 0 ? `T${idx + 1}` : '--'} ${res.confident ? '확신' : '선택'} 풀${String(res.ranked.length).padStart(3)} 점수 ${a.toFixed(1)}/${b.toFixed(1)} ${g.input.slice(0, 36)}${dbg}`)
    }
    const text = `${rows.join('\n')}\n${JSON.stringify(stat)}\n${calibration(pools)}`
    if (process.env.EVAL_OUT) fs.writeFileSync(process.env.EVAL_OUT, text)
    else console.log(text)
  }, 1_800_000)
})
