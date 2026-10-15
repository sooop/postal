// 정답 데이터(__fixtures__/gold.tsv)로 후보 선택 정확도를 측정한다. 실제 조회처를 부르므로 기본은 건너뛴다.
//   EVAL_GOLD=1 EVAL_CACHE=<캐시.json 경로> npx vitest run scripts/eval-gold.test.ts
// 캐시 파일에 없는 검색어만 실제로 조회하고(요청 간격 450ms), 결과를 캐시에 저장한다.
import fs from 'node:fs'
import { describe, it } from 'vitest'
import { fetchZipcdList } from '../src/lib/epost'
import { fetchJusoList, normalizeJusoPage } from '../src/lib/juso'
import { normalizePage } from '../src/lib/normalize'
import type { Fetchers } from '../src/lib/provider'
import { roadTail } from '../src/lib/match/rank'
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

const gold = fs.readFileSync(new URL('../src/lib/__fixtures__/gold.tsv', import.meta.url), 'utf8')
  .split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
    const [old, input, zip5, road] = l.split('\t')
    return { old, input, zip5, road }
  })

describe.skipIf(!process.env.EVAL_GOLD)('정답 데이터 평가', () => {
  it('후보 풀·1위·3위 안 적중률', async () => {
    const rows: string[] = []
    const stat = { n: 0, pool: 0, top1: 0, top3: 0, confOk: 0, confBad: 0, unconf: 0 }
    for (const g of gold) {
      const res = await smartSearch(fetchers, `${g.old.slice(0, 3)}-${g.old.slice(3)} ${g.input}`.replace(/^\S+\s/, (m) => m), { stopWhenConfident: false })
      const isGold = (z: string, r: string) => z === g.zip5 && (!g.road || roadTail(r) === roadTail(g.road))
      const idx = res.ranked.findIndex((c) => isGold(c.result.zipcode, c.result.roadAddress))
      stat.n++
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
    const text = `${rows.join('\n')}\n${JSON.stringify(stat)}`
    if (process.env.EVAL_OUT) fs.writeFileSync(process.env.EVAL_OUT, text)
    else console.log(text)
  }, 1_800_000)
})
