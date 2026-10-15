// 사용자가 확정한 선택을 기억하기 위한 순수 로직(저장은 db.ts). 사용자가 직접 "기억"을 눌렀을 때만 쓴다.
import { nameKey, parseInput, type ParsedInput } from './match/parse'
import { roadTail } from './match/rank'
import type { CandidateInput } from './decide'
import type { ZipcodeResult } from './search'

export interface LearnedSelection {
  zip5: string
  road: string
  jibun?: string
  detail?: string
  buildingName?: string
}

export interface LearnedRecord {
  /** 정규화한 입력 키 + 구우편번호. 같은 구주소 입력이면 같은 키가 된다 */
  key: string
  /** 처음 기억할 때의 입력 원문(참고용) */
  input: string
  selected: LearnedSelection
  /** 사용자가 확정한 횟수 */
  hits: number
  createdAt: number
  lastUsedAt: number
}

/** 키를 만들 만큼 단서가 없는 입력(지역만, 숫자만 등)은 기억하지 않는다 */
export function learnKeyOf(p: ParsedInput): string | null {
  const sgg = p.sigungu[p.sigungu.length - 1] ?? ''
  const where = p.roadName && p.roadNo ? `${p.roadName}${p.roadNo}` : p.jibun ? `${p.emd ?? ''}${p.jibun}` : ''
  const name = p.core ? nameKey(p.core) + (/\d+(?:차|단지)/.exec(p.name)?.[0] ?? '') : ''
  if (!where && !name) return null
  return [p.oldZip ?? '', sgg, p.emd && !where ? p.emd : '', where, name].join('|')
}

export const learnKey = (input: string): string | null => learnKeyOf(parseInput(input))

export function selectionOf(r: ZipcodeResult): LearnedSelection {
  const s: LearnedSelection = { zip5: r.zipcode, road: r.roadAddress }
  if (r.jibunAddress) s.jibun = r.jibunAddress
  if (r.detail) s.detail = r.detail
  if (r.buildingName) s.buildingName = r.buildingName
  return s
}

/** 결과가 기억된 선택과 같은 도로명주소인지(신우편번호 + 도로명·건물번호) */
export function isSameAddress(r: Pick<ZipcodeResult, 'zipcode' | 'roadAddress'>, s: Pick<LearnedSelection, 'zip5' | 'road'>): boolean {
  const t = roadTail(s.road)
  return r.zipcode === s.zip5 && t !== '' && roadTail(r.roadAddress) === t
}

/** 같은 키가 이미 있으면 확정 횟수를 늘리고(선택이 바뀌었으면 새 선택으로 교체), 없으면 새로 만든다 */
export function upsertRecord(prev: LearnedRecord | undefined, key: string, input: string, r: ZipcodeResult, now: number): LearnedRecord {
  const selected = selectionOf(r)
  if (prev && isSameAddress(r, prev.selected)) return { ...prev, selected, hits: prev.hits + 1, lastUsedAt: now }
  return { key, input: prev?.input ?? input, selected, hits: 1, createdAt: prev?.createdAt ?? now, lastUsedAt: now }
}

/** 결과 목록에서 기억된 선택에 해당하는 항목 */
export function findLearnedIn(results: readonly ZipcodeResult[], rec: LearnedRecord | null | undefined): ZipcodeResult | undefined {
  return rec ? results.find((r) => isSameAddress(r, rec.selected)) : undefined
}

/** decide 후보의 prior 를 만든다 */
export function priorFor(r: ZipcodeResult, rec: LearnedRecord | null | undefined): CandidateInput['prior'] | undefined {
  return rec && isSameAddress(r, rec.selected) ? { preferred: true, confirmedCount: rec.hits } : undefined
}

/** 내보내기·가져오기용 직렬화 */
export function serializeLearned(list: readonly LearnedRecord[]): string {
  return JSON.stringify({ format: 'postal-learned', version: 1, records: list }, null, 2)
}

const isStr = (x: unknown): x is string => typeof x === 'string'

/** 가져온 파일을 검증해 쓸 수 있는 레코드만 돌려준다(모양이 어긋난 항목은 건너뛴다) */
export function parseLearned(text: string): { records: LearnedRecord[]; skipped: number } | null {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return null }
  const o = raw as { format?: unknown; records?: unknown } | null
  if (!o || o.format !== 'postal-learned' || !Array.isArray(o.records)) return null
  const records: LearnedRecord[] = []
  let skipped = 0
  for (const x of o.records as Record<string, unknown>[]) {
    const s = x?.selected as Record<string, unknown> | undefined
    if (!x || !isStr(x.key) || !x.key || !isStr(x.input) || !s || !isStr(s.zip5) || !/^\d{5}$/.test(s.zip5) || !isStr(s.road) || !s.road) { skipped++; continue }
    const sel: LearnedSelection = { zip5: s.zip5, road: s.road }
    if (isStr(s.jibun)) sel.jibun = s.jibun
    if (isStr(s.detail)) sel.detail = s.detail
    if (isStr(s.buildingName)) sel.buildingName = s.buildingName
    const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)
    records.push({ key: x.key.slice(0, 300), input: x.input.slice(0, 300), selected: sel, hits: Math.max(1, Math.floor(n(x.hits, 1))), createdAt: n(x.createdAt, 0), lastUsedAt: n(x.lastUsedAt, 0) })
  }
  return { records, skipped }
}
