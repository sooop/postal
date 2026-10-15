import type { AddrKind, SearchPage, ZipcodeResult } from './search'

export const PARSER_VERSION = '2.0.0'

/** 우체국 응답 구조가 기대와 다를 때 (오류 코드 parse_failed 에 대응) */
export class ParseFailedError extends Error {
  constructor(message = '우체국 응답 형식을 읽을 수 없습니다') {
    super(message)
    this.name = 'ParseFailedError'
  }
}

export interface RawRow {
  addr_type?: string
  zipcd?: string
  areacd?: string
  addr?: string
  sidosggnm?: string
  rdNm?: string
  bdsn?: string
  aptNm?: string
  buildnm?: string
  dualaddr?: string
}

const clean = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim()

const ROAD_TAIL = /(로|길)\s*\d+(-\d+)?$/
const DONG_LIKE = /[동읍면리가]$/

/** "본문 (a, b, c)" 를 본문과 괄호 안 조각으로 나눈다 */
function splitParen(addr: string): { base: string; parts: string[]; tail: string } {
  const m = addr.match(/^(.*?)\s*\(([^)]*)\)\s*(.*)$/)
  if (!m) return { base: addr, parts: [], tail: '' }
  return { base: clean(m[1]), parts: m[2].split(',').map(clean).filter(Boolean), tail: clean(m[3]) }
}

function toOldZip(zipcd: string): string | undefined {
  const digits = zipcd.replace(/\D/g, '')
  return digits.length === 6 ? digits : undefined
}

export function normalizeRow(row: RawRow): ZipcodeResult | null {
  const zipcode = clean(row.areacd)
  if (!/^\d{5}$/.test(zipcode)) return null

  const addr = clean(row.addr)
  if (!addr) return null

  const kind = clean(row.addr_type) as AddrKind
  const sido = clean(row.sidosggnm)
  const rdNm = clean(row.rdNm)
  const bdsn = clean(row.bdsn)
  const { base, parts, tail } = splitParen(addr)
  const oldZipcode = toOldZip(clean(row.zipcd))
  const buildingName = clean(row.aptNm) || clean(row.buildnm) || undefined
  const common = { zipcode, oldZipcode, kind, buildingName, dongText: tail || undefined }

  const isRange = bdsn === '' || bdsn.includes('~')

  if (kind === '사서함' || isRange) {
    return { ...common, roadAddress: '', jibunAddress: kind === '지번' ? addr : '', detail: kind === '사서함' ? addr : undefined, range: true }
  }

  const prefix = sido || base.replace(new RegExp(`\\s*${escapeRe(rdNm)}.*$`), '')

  if (kind === '도로명') {
    const dong = parts[0] && DONG_LIKE.test(parts[0]) ? parts[0] : ''
    const detail = (dong ? parts.slice(1) : parts).join(', ')
    return {
      ...common,
      roadAddress: `${prefix} ${rdNm} ${bdsn}`,
      jibunAddress: dong ? `${prefix} ${dong}${lotOf(row.dualaddr, dong)}` : '',
      detail: detail || undefined,
    }
  }

  if (kind === '지번') {
    const last = parts[parts.length - 1] ?? ''
    const hasRoad = ROAD_TAIL.test(last)
    const detail = (hasRoad ? parts.slice(0, -1) : parts).join(', ')
    return {
      ...common,
      roadAddress: hasRoad ? `${prefix} ${last}` : '',
      jibunAddress: `${prefix} ${rdNm} ${bdsn}`,
      detail: detail || undefined,
    }
  }

  return null
}

/** dualaddr('… 잠실동 320 우성4차아파트 …')에서 동 다음의 번지를 뽑아 ' 320' 형태로 돌려준다 */
function lotOf(dualaddr: unknown, dong: string): string {
  const m = clean(dualaddr).match(new RegExp(`${escapeRe(dong)}\\s+(산?\\d+(?:-\\d+)?)(?:\\s|$)`))
  return m ? ` ${m[1]}` : ''
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** newZipcdList.do 의 JSON 응답을 검증하고 정규화한다 */
export function normalizePage(json: unknown, pageIdx: number, pageSize: number): SearchPage {
  const obj = json as { totCnt?: unknown; newZipcdList?: unknown } | null
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.newZipcdList)) {
    throw new ParseFailedError()
  }
  const total = Number(obj.totCnt)
  if (!Number.isFinite(total)) throw new ParseFailedError()

  const results = (obj.newZipcdList as RawRow[])
    .map(normalizeRow)
    .filter((r): r is ZipcodeResult => r !== null)
    .map((r) => ({ ...r, source: 'epost' as const }))

  return {
    results,
    hasMore: pageIdx * pageSize < total,
    nextTargetRow: pageIdx + 1,
    total,
    source: 'epost',
  }
}
