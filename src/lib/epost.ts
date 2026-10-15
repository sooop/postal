// 우체국몰 우편번호 조회 JSON 엔드포인트. 호스트와 경로는 고정이며 입력은 keyword 로만 사용한다.
const ENDPOINT = 'https://mall.epost.go.kr/fo/comm/newZipcdList.do'

export const PAGE_SIZE = 10

/** HTTP 상태가 정상이 아닐 때 */
export class HttpError extends Error {
  constructor(public status: number, public retryAfterMs?: number) {
    super(`서버 응답 오류: ${status}`)
    this.name = 'HttpError'
  }
}

/** 조회처가 JSON 대신 HTML(차단 안내·캡차·확인 화면)을 돌려줄 때 */
export class BlockedError extends Error {
  constructor(message = '조회처가 JSON 대신 웹 페이지를 돌려주었습니다(자동 조회 차단 또는 확인 절차)') {
    super(message)
    this.name = 'BlockedError'
  }
}

/** 응답 본문을 JSON 으로 읽는다. HTML 이면 차단으로, 그 밖의 형식 오류는 SyntaxError 로 던진다 */
export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch (err) {
    if (/^\s*(<!doctype html|<html|<head|<body)/i.test(text)) throw new BlockedError()
    throw err
  }
}

export async function fetchZipcdList(
  keyword: string,
  pageIdx = 1,
  pageSize = PAGE_SIZE,
  signal?: AbortSignal,
): Promise<unknown> {
  const body = new URLSearchParams({
    keyword,
    pageIdx: String(pageIdx),
    pageSize: String(pageSize),
  })

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: body.toString(),
    credentials: 'omit',
    signal,
  })

  if (!response.ok) {
    const secs = Number(response.headers.get('Retry-After'))
    throw new HttpError(response.status, Number.isFinite(secs) && secs > 0 ? secs * 1000 : undefined)
  }

  return readJson(response)
}
