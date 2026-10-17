// 확장 아이콘 배지: 조회처 차단('!' 빨강)을 최우선으로, 아니면 앱 요청 대기 건수(파랑)를 표시한다.
// 앱 요청을 처리하는 동안에는 아이콘도 작동 중 아이콘(Lucide mailbox, scripts/gen-busy-icon.mjs)으로 바꾼다.
export type IconKind = 'idle' | 'busy'

export interface BadgeView {
  text: string
  color: string
  title: string
  icon: IconKind
}

const TITLE = '우편번호 검색'

const ICON_PATHS: Record<IconKind, Record<string, string>> = {
  idle: { '16': '/icon16.png', '48': '/icon48.png', '128': '/icon128.png' },
  busy: { '16': '/icon-busy16.png', '32': '/icon-busy32.png' },
}

export function badgeView(blocked: boolean, queued: number): BadgeView {
  if (blocked) return { text: '!', color: '#dc2626', title: `${TITLE} — 조회처가 접근을 막았습니다. 사이트를 직접 열어 확인해 주세요`, icon: 'idle' }
  if (queued > 0) return { text: queued > 99 ? '99+' : String(queued), color: '#2563eb', title: `${TITLE} — 앱 요청 ${queued}건 처리 중`, icon: 'busy' }
  return { text: '', color: '#2563eb', title: TITLE, icon: 'idle' }
}

let blocked = false
let queued = 0
let shownIcon: IconKind | null = null

function render() {
  const v = badgeView(blocked, queued)
  try {
    void chrome.action.setBadgeText({ text: v.text })
    void chrome.action.setBadgeBackgroundColor({ color: v.color })
    void chrome.action.setTitle({ title: v.title })
    if (shownIcon !== v.icon) {
      shownIcon = v.icon
      chrome.action.setIcon({ path: ICON_PATHS[v.icon] }).catch(() => { shownIcon = null })
    }
  } catch {
    // 배지 갱신 실패는 기능에 영향이 없으므로 무시
  }
}

/** service worker 가 처리 도중 종료되면 아이콘·배지가 그대로 남으므로, 시작할 때 평상시 상태로 되돌린다 */
export function initBadge(): void {
  render()
}

export function setBlocked(next: boolean): void {
  if (blocked === next) return
  blocked = next
  render()
}

export function setQueued(next: number): void {
  if (queued === next) return
  queued = next
  render()
}
