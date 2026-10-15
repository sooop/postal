// 조회 오류를 사용자에게 보여 줄 한국어 문장으로 바꾼다(팝업·백그라운드 공용).
import { BlockedError, HttpError } from './epost'
import { ParseFailedError } from './normalize'

/** 조회처가 접근을 막은 경우(HTML 응답, 401·403) */
export const isBlocked = (err: unknown): boolean =>
  err instanceof BlockedError || (err instanceof HttpError && (err.status === 401 || err.status === 403))

export function userMessage(err: unknown): string {
  if (isBlocked(err)) {
    return '조회처가 접근을 막았습니다(자동 조회 차단 또는 확인 절차). 브라우저에서 우체국몰·도로명주소 사이트를 직접 한 번 열어 확인한 뒤 다시 시도해 주세요.'
  }
  if (err instanceof HttpError && err.status === 429) return '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'
  if (err instanceof HttpError) return `조회처 서버 오류(${err.status})입니다. 잠시 후 다시 시도해 주세요.`
  if (err instanceof ParseFailedError || err instanceof SyntaxError) return '조회처 응답 형식을 읽을 수 없습니다. 사이트가 바뀌었을 수 있습니다.'
  if (err instanceof TypeError) return '네트워크에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.'
  return err instanceof Error ? err.message : String(err)
}
