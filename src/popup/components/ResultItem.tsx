import { useState, type KeyboardEvent } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COPY_FORMATS, formatCopy, type CopyFormat } from '@/lib/copy'
import type { ZipcodeResult } from '@/lib/search'
import { Highlight } from './Highlight'

interface ResultItemProps {
  result: ZipcodeResult
  onCopy: (result: ZipcodeResult) => void
  isCopied: boolean
  /** 결과 내 필터 질의(일치 글자 강조용) */
  query?: string
  /** 입력 분석 검색에서 확신 있는 1순위로 판정된 항목 */
  recommended?: boolean
  /** 필터 가점을 포함한 확장 점수와, 보이는 후보 안에서의 확률(0~1). 입력 분석 검색일 때만 */
  score?: number
  prob?: number
  /** 항목을 눌렀을 때 복사하는 형식(마지막으로 고른 것) */
  format: CopyFormat
  /** 마우스를 올린 항목의 버튼으로 다른 형식을 고르면 그 형식으로 복사하고 기억한다 */
  onFormatChange: (format: CopyFormat) => void
}

export function ResultItem({ result, onCopy, isCopied, query = '', recommended = false, score, prob, format, onFormatChange }: ResultItemProps) {
  // 주소가 한 줄에서 잘렸을 때만 전체 주소 레이어를 띄운다
  const [truncated, setTruncated] = useState(false)
  const copyAs = (f: CopyFormat) => {
    navigator.clipboard.writeText(formatCopy(f, result)).then(() => onCopy(result))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyAs(format) }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${result.zipcode} ${result.roadAddress || result.jibunAddress} 복사`}
      className={cn(
        'group relative w-full cursor-pointer rounded-md border px-3 py-2.5 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isCopied
          ? 'border-amber-200 bg-amber-50 hover:bg-amber-100/80'
          : recommended
            ? 'border-emerald-200 bg-emerald-50/70 hover:bg-emerald-50'
            : 'border-transparent hover:border-border hover:bg-accent/60'
      )}
      onClick={() => copyAs(format)}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center gap-2">
        {/* 우편번호 칩 */}
        <span className={cn(
          'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums tracking-wider',
          isCopied
            ? 'bg-amber-500 text-white'
            : 'bg-secondary text-secondary-foreground'
        )}>
          <Highlight text={result.zipcode} query={query} />
        </span>

        {/* 도로명 주소 + 건물명 */}
        <span
          className="min-w-0 flex-1 truncate text-[13px] leading-snug text-foreground"
          onMouseEnter={(e) => setTruncated(e.currentTarget.scrollWidth > e.currentTarget.clientWidth)}
        >
          <Highlight text={result.roadAddress || result.jibunAddress} query={query} />
          {result.detail && (
            <span className="ml-1 text-[11px] text-muted-foreground">
              <Highlight text={result.detail} query={query} />
            </span>
          )}
        </span>

        {/* 확률 배지: 입력 분석 점수를 softmax 로 환산한 값. 근거·원점수는 툴팁 */}
        {prob !== undefined && (
          <span
            title={`점수 ${score?.toFixed(1)}${result.match?.why.length ? ` · ${result.match.why.join(' · ')}` : ''}`}
            className={cn(
              'shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold tabular-nums',
              prob >= 0.7 ? 'bg-emerald-100 text-emerald-800' : prob >= 0.3 ? 'bg-amber-100 text-amber-800' : 'bg-secondary text-muted-foreground'
            )}
          >
            {Math.round(prob * 100)}%
          </span>
        )}

        {/* 복사됨 아이콘 */}
        {isCopied && (
          <CheckCircle2 size={13} className="shrink-0 text-amber-500" />
        )}
      </div>

      {result.match && result.match.why.length > 0 && (
        <p className="mt-1 ml-[calc(1.5rem+0.5rem)] text-[11px] leading-relaxed text-emerald-700">
          {recommended && <span className="mr-1 rounded bg-emerald-600 px-1 py-px text-[10px] font-semibold text-white">추천</span>}
          {result.match.why.join(' · ')}
        </p>
      )}

      {result.roadAddress && result.jibunAddress && (
        <p className="mt-1 ml-[calc(1.5rem+0.5rem)] text-[11px] leading-relaxed text-muted-foreground">
          (지번) <Highlight text={result.jibunAddress} query={query} />
        </p>
      )}

      {/* 잘린 주소의 전체 내용: 주소 위에 잠시 머물면 항목 아래에 겹쳐 표시 */}
      {truncated && (
        <div
          role="tooltip"
          className="pointer-events-none absolute inset-x-2 top-full z-30 mt-0.5 hidden rounded-md border border-border bg-background px-2.5 py-2 text-[12px] leading-relaxed text-foreground opacity-0 shadow-lg transition-opacity delay-0 group-hover:block group-hover:opacity-100 group-hover:delay-500"
        >
          <div className="break-keep font-medium">{result.zipcode} {result.roadAddress || result.jibunAddress}</div>
          {result.detail && <div className="break-keep text-muted-foreground">{result.detail}</div>}
          {result.roadAddress && result.jibunAddress && <div className="break-keep text-muted-foreground">(지번) {result.jibunAddress}</div>}
        </div>
      )}

      {/* 마우스를 올리거나 포커스가 있을 때만 보이는 복사 형식 버튼 */}
      <div
        role="group"
        aria-label="복사 형식"
        className="absolute right-1.5 top-1.5 hidden items-center gap-0.5 rounded-md border border-border bg-background/95 p-0.5 shadow-sm group-hover:flex group-focus-within:flex"
      >
        {COPY_FORMATS.map((f) => (
          <button
            key={f.value}
            type="button"
            title={f.title}
            aria-pressed={format === f.value}
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] transition-colors',
              format === f.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
            onClick={(e) => { e.stopPropagation(); onFormatChange(f.value); copyAs(f.value) }}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  )
}
