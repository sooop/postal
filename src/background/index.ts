import { PAGE_SIZE } from '@/lib/epost'
import { DECIDE, decideError, parseDecideInput, type DecideRequest } from '@/lib/decide'
import type { DecideStageMessage } from '@/lib/decideClient'
import { userMessage } from '@/lib/errors'
import { searchPage } from '@/lib/provider'
import { smartSearch } from '@/lib/match/smart'
import type { SearchMode, SearchResponse, SmartResponse } from '@/lib/search'
import { effectiveAppUrl, loadSettings } from '@/lib/settings'
import { initBadge } from './badge'
import { decideClient, initBridge } from './bridge'
import { fetchers } from './fetchers'

initBadge()
initBridge()

async function handleSearch(query: string, pageIdx: number, mode: SearchMode): Promise<SearchResponse> {
  try {
    return { ok: true, page: await searchPage(fetchers, query, pageIdx, PAGE_SIZE, mode) }
  } catch (err) {
    return { ok: false, error: userMessage(err) }
  }
}

// 입력 분석 검색: 검색어마다 조회처를 연달아 부르므로 요청 간격(우체국 500ms 규칙)을 지키고, 새 검색이 오면 이전 것을 중단한다
let currentSmart: AbortController | null = null
let lastSmartRequestAt = 0
const SMART_GAP_MS = 450

async function smartThrottle(): Promise<void> {
  const wait = lastSmartRequestAt + SMART_GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastSmartRequestAt = Date.now()
}

async function handleSmartSearch(query: string, mode: SearchMode, learned: { zip5: string; road: string }[]): Promise<SmartResponse> {
  currentSmart?.abort()
  const controller = new AbortController()
  currentSmart = controller
  try {
    const r = await smartSearch(fetchers, query, { mode, stopWhenConfident: true, signal: controller.signal, throttle: smartThrottle, learned })
    const results = r.ranked.map((c) => ({ ...c.result, match: { score: c.score, why: c.why } }))
    return { ok: true, results, confident: r.confident, queries: r.queries, queriesRun: r.queriesRun }
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, error: '새 검색으로 대체되었습니다' }
    return { ok: false, error: userMessage(err) }
  } finally {
    if (currentSmart === controller) currentSmart = null
  }
}

// 팝업은 한 번에 하나의 판정만 요청한다
let currentDecide: AbortController | null = null

function broadcastStage(stage: DecideStageMessage['stage']) {
  const msg: DecideStageMessage = { target: 'popup', type: 'decide-stage', stage }
  chrome.runtime.sendMessage(msg).catch(() => undefined) // 팝업이 닫혀 있으면 수신자 없음
}

async function activeTabId(): Promise<number | undefined> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    return tab?.id
  } catch {
    return undefined
  }
}

async function handleDecide(msg: Record<string, unknown>) {
  // 취소가 설정을 읽는 동안 도착해도 놓치지 않도록, 컨트롤러를 요청 수신 즉시 등록한다
  currentDecide?.abort()
  const controller = new AbortController()
  currentDecide = controller

  try {
    const settings = await loadSettings()
    if (!settings.decideEnabled) {
      return { ok: false as const, error: decideError('disabled', '설정에서 앱 후보 판정을 켜 주세요') }
    }

    const parsed = parseDecideInput(msg)
    if (!parsed.ok) return { ok: false as const, error: parsed.error }

    // 사용자가 AI 를 허용하지 않았다면 어떤 요청이든 항상 local
    const forceLocal = msg.engine === 'local'
    const engine: DecideRequest['engine'] = !settings.aiEnabled || forceLocal ? 'local' : 'auto'

    // 사용자가 지금 보고 있는 탭에 앱이 열려 있으면 그것을 먼저 쓴다
    const preferTabId = await activeTabId()
    return await decideClient.decide(
      { ...parsed.req, engine, timeoutMs: DECIDE.defaultTimeoutMs },
      { appUrl: effectiveAppUrl(settings), thresholds: settings.thresholds, preferTabId, onStage: broadcastStage, signal: controller.signal },
    )
  } finally {
    if (currentDecide === controller) currentDecide = null
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 확장 자신의 페이지(팝업)에서 온 메시지만 처리한다.
  if (sender.id !== chrome.runtime.id) return false
  if (!msg || msg.target !== 'background') return false

  if (msg.type === 'search') {
    if (typeof msg.query !== 'string' || typeof msg.targetRow !== 'number') return false
    const mode: SearchMode = msg.mode === 'epost' || msg.mode === 'juso' ? msg.mode : 'auto'
    handleSearch(msg.query, msg.targetRow, mode).then(sendResponse)
    return true
  }

  if (msg.type === 'smart-search') {
    if (typeof msg.query !== 'string') return false
    const mode: SearchMode = msg.mode === 'epost' || msg.mode === 'juso' ? msg.mode : 'auto'
    const learned = Array.isArray(msg.learned)
      ? msg.learned.filter((l: unknown): l is { zip5: string; road: string } => !!l && typeof (l as { zip5?: unknown }).zip5 === 'string' && typeof (l as { road?: unknown }).road === 'string').slice(0, 5)
      : []
    handleSmartSearch(msg.query, mode, learned).then(sendResponse)
    return true
  }

  if (msg.type === 'decide') {
    handleDecide(msg).then(sendResponse)
    return true
  }

  if (msg.type === 'decide-cancel') {
    currentDecide?.abort()
    sendResponse({ ok: true })
    return false
  }

  return false
})
