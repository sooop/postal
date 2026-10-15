// 입력 문자열에서 "알 수 있는 단서"만 뽑는다. 전체 주소를 받는다고 가정하지 않는다:
// 지역·지번·도로명·건물명·동 중 있는 것만 채우고 나머지는 비워 둔다.
import { normalizeDigits } from '../input'
import { isEmdLike, isSido, isSigungu } from '../regions'

export interface ParsedInput {
  raw: string
  /** 구우편번호 6자리(숫자만) */
  oldZip?: string
  /** 신우편번호 5자리가 입력에 있으면 */
  zip5?: string
  sido?: string
  /** 입력에 나온 시군구 토큰(예: ['고양시', '일산동구']) */
  sigungu: string[]
  /** 읍면동·리(행정동 숫자는 법정동 추정으로 정리: 암사3동 → 암사동) */
  emd?: string
  roadName?: string
  roadNo?: string
  jibun?: string
  /** 건물(단지)명 원문(공백 유지) */
  name: string
  /** 공백·'아파트' 접미를 뺀 건물명 */
  core: string
  /** 아파트 동 번호(예: '107'). 없으면 undefined */
  aptDong?: string
}

const ROAD_TOKEN = /^[가-힣\d]+(?:로|길)$/
const NUM_TOKEN = /^\d+(?:-\d+)?$/

/** 입력에서 우편번호를 떼어낸다. 동·호수와 헷갈리는 형태는 건드리지 않는다 */
function takeZips(text: string): { rest: string; oldZip?: string; zip5?: string } {
  let rest = text
  let oldZip: string | undefined
  let zip5: string | undefined
  rest = rest.replace(/(?<![\d-])(\d{3})-(\d{3})(?![\d-]|\s*[호동층])/, (_m, a: string, b: string) => {
    oldZip ??= a + b
    return ' '
  })
  if (!oldZip) {
    // 공백·점으로 떨어진 '135 924' 는 입력의 맨 앞이나 맨 끝에 있을 때만 우편번호로 본다(호수·번지와 구분)
    rest = rest.replace(/^(\d{3})[\s.](\d{3})(?=\s|$)(?!\s*[호동층])|(?<=\s)(\d{3})[\s.](\d{3})$/, (_m, a?: string, b?: string, c?: string, d?: string) => {
      oldZip = (a ?? c ?? '') + (b ?? d ?? '')
      return ' '
    })
  }
  if (!oldZip) {
    rest = rest.replace(/(?<![\d-])(\d{6})(?![\d-]|\s*[호동층])/, (_m, a: string) => {
      oldZip = a
      return ' '
    })
  }
  rest = rest.replace(/(?<![\d-])(\d{5})(?![\d-]|\s*[호동층])/, (_m, a: string) => {
    zip5 = a
    return ' '
  })
  return { rest, oldZip, zip5 }
}

/** 동·호·층 같은 상세 호수 표기를 제거하고, 아파트 동 번호를 뽑는다 */
function stripUnits(text: string): { rest: string; aptDong?: string } {
  let t = text.replace(/\([\d~,\s]+동\)/g, ' ') // 단지 동 범위: (101~125동)
  t = t.replace(/[()]/g, ' ')
  let aptDong: string | undefined
  const m = t.match(/(?:^|\s)(\d{1,4})\s*동(?=\s|$|\d)/) ?? t.match(/(?<=[가-힣\s])(\d{1,4})동(?=\d+호|\d{3,4}(?:\s|$))/)
  if (m) aptDong = m[1]
  t = t.replace(/번지/g, ' ')
  t = t.replace(/(?:^|\s)\d{1,4}\s*동\s*\d*호?/g, ' ')
  t = t.replace(/\s[가-힣]동\s*\d+호/g, ' ')
  t = t.replace(/(?<=\D)(\d{1,4})동(?=\d+호|\d{3,4}(?:\s|$))/g, ' ')
  t = t.replace(/\d+호|\d+층/g, ' ')
  t = t.replace(/(?:^|\s)\d{1,3}[-,ㅡ]\d{3,4}(?=\s|$)/g, ' ')
  // 번지 숫자와 이름이 붙은 경우: 452-25해성팰리스 → 452-25 해성팰리스
  t = t.replace(/(^|\s)(\d+(?:-\d+)?)(?=[가-힣])/g, '$1$2 ')
  t = t.replace(/\s\d+-(?=\s|$)/g, ' ')
  return { rest: t.replace(/\s+/g, ' ').trim(), aptDong }
}

export function parseInput(raw: string): ParsedInput {
  const cleaned = normalizeDigits(raw).replace(/["“”]/g, ' ').replace(/\s+/g, ' ').trim()
  const { rest: noZip, oldZip, zip5 } = takeZips(cleaned)
  const { rest, aptDong } = stripUnits(noZip)

  const out: ParsedInput = { raw, oldZip, zip5, sigungu: [], name: '', core: '', aptDong }
  const nameTokens: string[] = []
  const toks = rest.split(' ').filter(Boolean)

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    const nameStarted = nameTokens.length > 0
    if (!nameStarted && isSido(t)) { out.sido = t; continue }
    if (!nameStarted && isSigungu(t)) { out.sigungu.push(t); continue }
    if (!nameStarted && !out.roadName && ROAD_TOKEN.test(t)) {
      out.roadName = t
      if (NUM_TOKEN.test(toks[i + 1] ?? '')) { out.roadNo = toks[i + 1]; i++ }
      continue
    }
    if (!nameStarted && isEmdLike(t)) {
      // '개나리' 처럼 리로 끝나는 건물명이 있으므로, 리는 읍·면 다음이거나 뒤에 번지가 올 때만 지역으로 본다
      const isRi = t.endsWith('리')
      const ok = !isRi || /(읍|면)$/.test(out.emd ?? '') || NUM_TOKEN.test(toks[i + 1] ?? '')
      if (ok && (!out.emd || isRi)) { out.emd = t.replace(/(?<=[가-힣])\d+동$/, '동'); continue }
    }
    if (!out.jibun && NUM_TOKEN.test(t)) { out.jibun = t; continue }
    if (NUM_TOKEN.test(t)) continue
    nameTokens.push(t)
  }

  out.name = nameTokens.join(' ')
  out.core = out.name.replace(/\s/g, '').replace(/아파트$/, '')
  return out
}

/** 이름·숫자 비교용: 공백·'아파트'·'단지'·차수 표기를 지운다 */
export const nameKey = (s: string): string => s.replace(/\s/g, '').replace(/아파트|단지|\d+차|\d+/g, '')

/** '2차', '1단지' 같은 차수 번호 집합 */
export function nameNumbers(s: string): Set<string> {
  return new Set([...s.matchAll(/(\d+)\s*(?:차|단지)/g)].map((m) => m[1]))
}
