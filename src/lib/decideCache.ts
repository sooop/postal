// 앱 판정 결과를 검색어 단위로 기억해 두고 다시 쓰기 위한 순수 로직(저장은 db.ts).
// 후보 목록이 같을 때만 재사용한다. 목록이 바뀌었거나 사용자가 원하면 다시 요청한다.
import { roadTail } from './match/rank'
import type { CandidateInput, DecisionView } from './decide'

export interface DecisionRecord {
  /** 검색어 키(공백 정리) */
  key: string
  query: string
  /** 판정을 요청한 후보 목록의 서명(순서 포함). 같을 때만 재사용한다 */
  signature: string
  view: DecisionView
  /** 판정을 받은 시각(ms) */
  at: number
}

export const MAX_DECISIONS = 200

export const decisionKey = (query: string): string => query.replace(/\s+/g, ' ').trim()

/** 후보 목록의 서명: 신우편번호 + 도로명·건물번호를 순서대로 잇는다 */
export function signatureOf(candidates: readonly Pick<CandidateInput, 'zip5' | 'road'>[]): string {
  return candidates.map((c) => `${c.zip5}:${roadTail(c.road) || c.road}`).join(',')
}

export function toRecord(query: string, candidates: readonly Pick<CandidateInput, 'zip5' | 'road'>[], view: DecisionView, at: number): DecisionRecord {
  return { key: decisionKey(query), query, signature: signatureOf(candidates), view, at }
}

/** 저장된 판정이 지금 후보 목록에 그대로 쓸 수 있는지 */
export function isReusable(rec: DecisionRecord | undefined, candidates: readonly Pick<CandidateInput, 'zip5' | 'road'>[]): rec is DecisionRecord {
  return !!rec && rec.signature === signatureOf(candidates) && rec.view.scores.length === candidates.length
}

/** "3분 전", "2시간 전", "5일 전" */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - at) / 1000))
  if (s < 60) return '방금'
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
  return `${Math.floor(s / 86400)}일 전`
}
