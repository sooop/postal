// 팝업 → service worker 판정 요청 클라이언트
import {
  canDecideFrom, decideError, prepareCandidates,
  type DecideError, type DecisionView, type Engine,
} from './decide'
import type { ZipcodeResult } from './search'

export type DecideStage = 'connecting' | 'waiting' | 'scoring' | 'asking_ai'

export type DecideOutcome =
  | { ok: true; view: DecisionView; byRef: Record<string, ZipcodeResult> }
  | { ok: false; error: DecideError }

/** 팝업이 background 에 보내는 요청 */
export interface DecideRequestMessage {
  target: 'background'
  type: 'decide'
  query: { oldAddr: string; oldZip?: string; searchText?: string }
  candidates: ReturnType<typeof prepareCandidates>['candidates']
  /** 사용자가 '로컬로 다시 요청' 을 눌렀을 때 AI 를 끄기 위한 덮어쓰기 */
  engine?: Engine
}

/** background 가 진행 상태를 알리는 브로드캐스트(팝업이 열려 있을 때만 수신) */
export interface DecideStageMessage {
  target: 'popup'
  type: 'decide-stage'
  stage: DecideStage
}

type Response =
  | { ok: true; view: DecisionView }
  | { ok: false; error: DecideError }

export async function requestDecide(
  query: string,
  results: readonly ZipcodeResult[],
  opts: { engine?: Engine; onStage?: (stage: DecideStage) => void; priorOf?: Parameters<typeof prepareCandidates>[2] } = {},
): Promise<DecideOutcome> {
  if (!canDecideFrom(query)) {
    return { ok: false, error: decideError('invalid_request', '구주소(동·번지)로 검색한 결과에서만 사용할 수 있습니다') }
  }
  const { candidates, byRef } = prepareCandidates(results, undefined, opts.priorOf)
  if (candidates.length === 0) {
    return { ok: false, error: decideError('invalid_request', '판정할 후보가 없습니다') }
  }

  const onMsg = (msg: unknown) => {
    const m = msg as Partial<DecideStageMessage> | undefined
    if (m?.target === 'popup' && m.type === 'decide-stage' && m.stage) opts.onStage?.(m.stage)
  }
  chrome.runtime.onMessage.addListener(onMsg)
  try {
    const trimmed = query.trim()
    const digits = trimmed.replace(/\D/g, '')
    const message: DecideRequestMessage = {
      target: 'background',
      type: 'decide',
      query: { oldAddr: trimmed, searchText: trimmed, ...(digits.length === 6 && /^[\d-]+$/.test(trimmed) ? { oldZip: digits } : {}) },
      candidates,
      ...(opts.engine ? { engine: opts.engine } : {}),
    }
    const res = (await chrome.runtime.sendMessage(message)) as Response | undefined
    if (!res) return { ok: false, error: decideError('internal', '확장 백그라운드가 응답하지 않습니다') }
    return res.ok ? { ok: true, view: res.view, byRef } : res
  } finally {
    chrome.runtime.onMessage.removeListener(onMsg)
  }
}

export function cancelDecide(): void {
  void chrome.runtime.sendMessage({ target: 'background', type: 'decide-cancel' }).catch(() => undefined)
}
