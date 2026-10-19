import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { requestDecide, cancelDecide, type DecideOutcome, type DecideStage } from '@/lib/decideClient'
import { prepareCandidates, reconcile, recommend, DEFAULT_THRESHOLDS, type Engine, type ScoreView, type Signals, type Thresholds } from '@/lib/decide'
import { ago, decisionKey, isReusable, toRecord } from '@/lib/decideCache'
import { getDecision, putDecision } from '@/lib/db'
import { formatCopy, type CopyFormat } from '@/lib/copy'
import { priorFor, type LearnedRecord } from '@/lib/learn'
import type { ZipcodeResult } from '@/lib/search'

export interface DecideModalProps {
  /** 현재 검색어(구주소) */
  query: string
  /** 불러온 전체 결과(필터와 무관) */
  results: ZipcodeResult[]
  /** AI 판정 허용 여부. false 면 항상 engine:'local' */
  /** 이 입력에 기억된 주소(있으면 후보의 prior 로 전달) */
  learned?: LearnedRecord | null
  /** 선택·복사할 때의 복사 형식 */
  copyFormat?: CopyFormat
  /** 추천 판단 기준(저장된 결과를 다시 쓸 때 현재 설정으로 추천을 다시 계산한다) */
  thresholds?: Thresholds
  onClose: () => void
  /** 후보 선택·복사. 우편번호 복사 후 호출된다(학습 저장 연결 지점) */
  onSelect: (result: ZipcodeResult) => void
  onOpenSettings: () => void
}

const STAGE_TEXT: Record<DecideStage, string> = {
  connecting: '앱에 연결하는 중…',
  waiting: '앱이 준비되길 기다리는 중…',
  scoring: '후보를 계산하는 중…',
  asking_ai: 'AI 에 물어보는 중…',
}

const pct = (p: number) => `${Math.round(p * 100)}%`

function chips(s?: Signals): { text: string; good: boolean }[] {
  if (!s) return []
  const out: { text: string; good: boolean }[] = []
  if (s.dong === 'match') out.push({ text: '동 일치', good: true })
  else if (s.dong === 'mismatch') out.push({ text: '동 불일치', good: false })
  if (s.bunji === 'exact') out.push({ text: '번지 정확', good: true })
  else if (s.bunji === 'near') out.push({ text: '번지 근접', good: true })
  else if (s.bunji === 'different') out.push({ text: '번지 다름', good: false })
  if (s.oldZip === 'match') out.push({ text: '구우편번호 일치', good: true })
  else if (s.oldZip === 'mismatch') out.push({ text: '구우편번호 불일치', good: false })
  return out
}

export function DecideModal({ query, results, learned, copyFormat = 'zip', thresholds = DEFAULT_THRESHOLDS, onClose, onSelect, onOpenSettings }: DecideModalProps) {
  const [stage, setStage] = useState<DecideStage>('connecting')
  const [outcome, setOutcome] = useState<DecideOutcome | null>(null)
  /** 저장된 판정 결과를 다시 쓰는 중이면 그 시각 */
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const runRef = useRef(0)
  const pendingRef = useRef(false)

  const run = useCallback(async (engine?: Engine) => {
    const id = ++runRef.current
    pendingRef.current = true
    setOutcome(null)
    setStage('connecting')
    let res: DecideOutcome
    try {
      res = await requestDecide(query, results, {
        engine,
        onStage: (s) => { if (runRef.current === id) setStage(s) },
        priorOf: (r) => priorFor(r, learned),
      })
    } catch (e) {
      res = { ok: false, error: { code: 'internal', message: e instanceof Error ? e.message : String(e), retryable: false } }
    }
    if (runRef.current !== id) return
    pendingRef.current = false
    setSavedAt(null)
    setOutcome(res)
    // 성공한 판정은 검색어 단위로 기억해 두었다가 같은 후보 목록이면 다시 쓴다
    if (res.ok) void putDecision(toRecord(query, prepareCandidates(results).candidates, res.view, Date.now())).catch(console.error)
  }, [query, results, learned])

  /** 같은 검색어·같은 후보 목록으로 저장된 판정이 있으면 요청 없이 보여 주고, 없으면 앱에 요청한다 */
  const start = useCallback(async () => {
    const { candidates, byRef } = prepareCandidates(results)
    const rec = await getDecision(decisionKey(query)).catch(() => undefined)
    if (isReusable(rec, candidates)) {
      setSavedAt(rec.at)
      setOutcome({ ok: true, view: { ...rec.view, recommendedRef: recommend(rec.view.scores, thresholds) }, byRef })
      return
    }
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void start()
    return () => {
      runRef.current++
      if (pendingRef.current) { pendingRef.current = false; cancelDecide() }
    }
    // 마운트 시 1회만 요청
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { dialogRef.current?.focus() }, [])

  // cancelled 는 조용히 닫는다
  useEffect(() => {
    if (outcome && !outcome.ok && outcome.error.code === 'cancelled') onClose()
  }, [outcome, onClose])

  const pending = outcome === null
  // 앱 추천이 확장의 로컬 점수(확신 있는 1순위)와 충돌하면 추천을 보류한다
  const rec = outcome?.ok ? reconcile(outcome.view, outcome.byRef) : null

  // 진행 중 취소는 unmount cleanup 에서 cancelDecide 를 호출한다
  const close = () => onClose()

  const select = async (r: ZipcodeResult) => {
    try { await navigator.clipboard.writeText(formatCopy(copyFormat, r)) } catch (e) { console.error(e) }
    onSelect(r)
    close()
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/40 p-3"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="앱 추천 결과"
        tabIndex={-1}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}
        className="flex max-h-[540px] w-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg outline-none"
      >
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
          <Sparkles size={13} className="text-primary" />
          <h2 className="text-[13px] font-semibold text-foreground">앱 추천</h2>
          {outcome?.ok && (
            <span className="ml-auto rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">
              {outcome.view.engine === 'ai' ? 'AI' : '로컬 계산'}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2.5">
          {pending && (
            <div className="flex flex-col items-center gap-3 py-6" role="status" aria-live="polite">
              <Loader2 size={20} className="animate-spin text-primary" />
              <p className="text-[12px] text-muted-foreground">{STAGE_TEXT[stage]}</p>
              <Button variant="outline" size="sm" className="text-[12px]" aria-label="추천 요청 취소" onClick={close}>
                취소
              </Button>
            </div>
          )}

          {outcome && !outcome.ok && outcome.error.code !== 'cancelled' && (
            <ErrorView
              outcome={outcome}
              onRetryLocal={() => void run('local')}
              onRetry={() => void run()}
              onOpenSettings={onOpenSettings}
            />
          )}

          {outcome?.ok && (
            <div className="flex flex-col gap-2">
              {savedAt !== null && (
                <p className="rounded border border-sky-200 bg-sky-50 px-2 py-1.5 text-[11px] text-sky-800">
                  저장된 판정 결과입니다(요청 {ago(savedAt)}). 후보가 바뀌었거나 다시 확인하려면 '다시 요청'을 누르세요.
                </p>
              )}
              {outcome.view.summary && (
                <p className="text-[12px] leading-snug text-foreground">{outcome.view.summary}</p>
              )}
              {rec?.conflict && (
                <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                  앱 추천이 입력 분석 1순위와 다릅니다. 근거를 비교해 직접 선택해 주세요.
                </p>
              )}
              {!rec?.conflict && outcome.view.recommendedRef === null && (
                <p className="rounded border border-border bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
                  확신할 만한 후보가 없습니다. 확률만 참고하세요.
                </p>
              )}
              {outcome.view.scores.map((s) => (
                <CandidateRow
                  key={s.ref}
                  score={s}
                  result={outcome.byRef[s.ref]}
                  recommended={s.ref === rec?.recommendedRef}
                  onSelect={select}
                />
              ))}
              <div className="flex items-center justify-between rounded border border-dashed border-border px-2 py-1.5 text-[12px] text-muted-foreground">
                <span>해당 없음</span>
                <span className="tabular-nums">{pct(outcome.view.pNone)}</span>
              </div>
            </div>
          )}
        </div>

        {!pending && (
          <div className="flex justify-end gap-1 border-t border-border px-3 py-2">
            {outcome?.ok && (
              <Button variant="outline" size="sm" className="text-[12px]" aria-label="앱에 다시 요청" onClick={() => void run()}>다시 요청</Button>
            )}
            <Button variant="ghost" size="sm" className="text-[12px]" aria-label="닫기" onClick={close}>닫기</Button>
          </div>
        )}
      </div>
    </div>
  )
}

function CandidateRow({ score, result, recommended, onSelect }: {
  score: ScoreView
  result?: ZipcodeResult
  recommended: boolean
  onSelect: (r: ZipcodeResult) => void
}) {
  const [busy, setBusy] = useState(false)
  if (!result) return null
  const cs = chips(score.signals)
  return (
    <div className={`flex flex-col gap-1.5 rounded-md border px-2.5 py-2 ${recommended ? 'border-primary ring-1 ring-primary/40' : 'border-border'}`}>
      <div className="flex items-start gap-2">
        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[12px] font-semibold tabular-nums text-primary">
          {result.zipcode}
        </span>
        <p className="min-w-0 flex-1 break-words text-[12px] leading-snug text-foreground">
          {result.roadAddress}{result.detail ? ` (${result.detail})` : ''}
        </p>
        {recommended && (
          <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground">추천</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(score.p * 100)}
          aria-label="일치 확률"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(score.p * 100)}%` }} />
        </div>
        <span className="w-9 text-right text-[12px] font-medium tabular-nums text-foreground">{pct(score.p)}</span>
      </div>
      {score.reason && <p className="text-[11px] leading-snug text-muted-foreground">{score.reason}</p>}
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {cs.map((c) => (
            <span
              key={c.text}
              className={`rounded px-1.5 py-0.5 text-[11px] ${c.good ? 'bg-secondary text-secondary-foreground' : 'bg-destructive/10 text-destructive'}`}
            >
              {c.text}
            </span>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 px-2 text-[11px]"
          aria-label={`우편번호 ${result.zipcode} 선택 및 복사`}
          disabled={busy}
          onClick={() => { setBusy(true); onSelect(result) }}
        >
          선택·복사
        </Button>
      </div>
    </div>
  )
}

function ErrorView({ outcome, onRetryLocal, onRetry, onOpenSettings }: {
  outcome: Extract<DecideOutcome, { ok: false }>
  onRetryLocal: () => void
  onRetry: () => void
  onOpenSettings: () => void
}) {
  const { code, message } = outcome.error
  return (
    <div className="flex flex-col gap-2 py-2" role="alert">
      {code === 'app_unavailable' && (
        <p className="text-[12px] text-foreground">앱을 열어 두거나 설정에서 앱 주소를 입력하세요</p>
      )}
      <p className="text-[12px] text-destructive">{message}</p>
      <div className="flex gap-2">
        {code === 'ai_unavailable' && (
          <Button size="sm" variant="outline" className="text-[12px]" aria-label="로컬만으로 다시 요청" onClick={onRetryLocal}>다시 요청(로컬만)</Button>
        )}
        {(code === 'busy' || code === 'timeout') && (
          <Button size="sm" variant="outline" className="text-[12px]" aria-label="다시 시도" onClick={onRetry}>다시 시도</Button>
        )}
        {code === 'app_unavailable' && (
          <Button size="sm" variant="outline" className="text-[12px]" aria-label="설정 열기" onClick={onOpenSettings}>설정 열기</Button>
        )}
      </div>
    </div>
  )
}
