import { DEFAULT_THRESHOLDS, type Thresholds } from './decide'
import { isCopyFormat, type CopyFormat } from './copy'
import type { SearchMode } from './search'

export interface Settings {
  /** 후보 판정 기능 사용(기본 꺼짐). 켜면 구주소와 후보가 앱 프레임으로 전송된다 */
  decideEnabled: boolean
  /** AI 판정 허용. 꺼져 있으면 항상 engine:'local' 로 요청한다 */
  aiEnabled: boolean
  /** 입력 분석 검색에서 확실한 1순위가 없으면 판정 창을 자동으로 연다(기본 꺼짐). decideEnabled 가 켜져 있어야 한다 */
  autoDecide: boolean
  /** 앱 주소 오버라이드(빈 문자열이면 DEFAULT_APP_URL 사용) */
  appUrl: string
  thresholds: Thresholds
  /** 검색 방식: auto(우체국 → 필요 시 도로명주소), epost, juso */
  searchMode: SearchMode
  /** 결과를 눌렀을 때 복사하는 형식(마지막으로 고른 것을 기억) */
  copyFormat: CopyFormat
}

export const DEFAULT_SETTINGS: Settings = {
  decideEnabled: false,
  aiEnabled: false,
  autoDecide: false,
  appUrl: '',
  thresholds: DEFAULT_THRESHOLDS,
  searchMode: 'auto',
  copyFormat: 'zip',
}

const KEY = 'settings'

/**
 * 앱 기본 주소(상수). 설정에서 비워 두면 이 값을 쓰고, 설정에 값이 있으면 그 값이 우선한다(오버라이드).
 * 아티팩트가 교체되면 이 상수만 고치면 된다. `sk` 는 비공개 아티팩트의 공유 키이므로 이 저장소를 공개하지 않는다.
 */
export const DEFAULT_APP_URL = 'https://claude.ai/artifact/7k3do6wFLMuQmzczJvb15K?sk=IwRw-2OI0xobj2zNfGEe7w'

/** claude-ex 허브 확장의 고정 ID(허브 manifest 의 key 로 고정됨). 플러그인 등록·호출 연결의 상대를 이 ID 로만 인정한다 */
export const HUB_ID = 'cmnfclffoomldhdnghjbcdgednhaknho'

/** 실제로 여는 앱 주소: 설정의 오버라이드가 있으면 그것, 없으면 기본값 */
export function effectiveAppUrl(settings: Pick<Settings, 'appUrl'>): string {
  return settings.appUrl || DEFAULT_APP_URL
}

/**
 * claude.ai 의 아티팩트 URL 만 허용한다. 올바르면 정규화한 URL, 아니면 null.
 * 쿼리는 비공개 아티팩트의 공유 키 `sk` 만 보존하고 나머지(추적 값 등)와 해시는 버린다.
 */
export function normalizeAppUrl(input: string): string | null {
  let u: URL
  try { u = new URL(input.trim()) } catch { return null }
  if (u.protocol !== 'https:' || u.hostname !== 'claude.ai' || u.port) return null
  if (!/^\/(code\/)?artifacts?\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)) return null
  const sk = u.searchParams.get('sk')
  if (sk !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(sk)) return null
  return `${u.origin}${u.pathname}${sk ? `?sk=${sk}` : ''}`
}

const num = (x: unknown, fallback: number): number =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1 ? x : fallback

export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const th = (r.thresholds && typeof r.thresholds === 'object' ? r.thresholds : {}) as Record<string, unknown>
  return {
    decideEnabled: r.decideEnabled === true,
    aiEnabled: r.aiEnabled === true,
    autoDecide: r.autoDecide === true,
    appUrl: typeof r.appUrl === 'string' ? (normalizeAppUrl(r.appUrl) ?? '') : '',
    copyFormat: isCopyFormat(r.copyFormat) ? r.copyFormat : 'zip',
    searchMode: r.searchMode === 'epost' || r.searchMode === 'juso' ? r.searchMode : 'auto',
    thresholds: {
      minP: num(th.minP, DEFAULT_THRESHOLDS.minP),
      minGap: num(th.minGap, DEFAULT_THRESHOLDS.minGap),
    },
  }
}

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(KEY)
  return sanitizeSettings(got[KEY])
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = sanitizeSettings({ ...(await loadSettings()), ...patch })
  await chrome.storage.local.set({ [KEY]: next })
  return next
}
