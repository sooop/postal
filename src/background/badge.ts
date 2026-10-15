// 확장 아이콘 배지: 조회처 차단('!' 빨강)을 최우선으로, 아니면 앱 요청 대기 건수(파랑)를 표시한다.
export interface BadgeView {
  text: string
  color: string
  title: string
}

const TITLE = '우편번호 검색'

export function badgeView(blocked: boolean, queued: number): BadgeView {
  if (blocked) return { text: '!', color: '#dc2626', title: `${TITLE} — 조회처가 접근을 막았습니다. 사이트를 직접 열어 확인해 주세요` }
  if (queued > 0) return { text: queued > 99 ? '99+' : String(queued), color: '#2563eb', title: `${TITLE} — 앱 요청 ${queued}건 처리 중` }
  return { text: '', color: '#2563eb', title: TITLE }
}

let blocked = false
let queued = 0

function render() {
  const v = badgeView(blocked, queued)
  try {
    void chrome.action.setBadgeText({ text: v.text })
    void chrome.action.setBadgeBackgroundColor({ color: v.color })
    void chrome.action.setTitle({ title: v.title })
  } catch {
    // 배지 갱신 실패는 기능에 영향이 없으므로 무시
  }
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
