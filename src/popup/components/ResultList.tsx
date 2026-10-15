import { useMemo, useState, type KeyboardEvent } from 'react'
import { Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { copiedKey } from '@/lib/db'
import { filterResults } from '@/lib/fuzzy'
import type { CopyFormat } from '@/lib/copy'
import type { ZipcodeResult } from '@/lib/search'
import { ResultItem } from './ResultItem'

interface ResultListProps {
  results: ZipcodeResult[]
  onCopy: (result: ZipcodeResult) => void
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  copiedKeys: Set<string>
  /** 있으면 '앱에 추천 요청' 버튼을 표시한다 */
  onRequestDecide?: () => void
  /** 입력 분석 검색 결과(점수순)일 때만 전달. confident 가 아니면 '선택 필요' 안내를 보여 준다 */
  ranked?: { confident: boolean }
  copyFormat: CopyFormat
  onCopyFormatChange: (format: CopyFormat) => void
}

export function ResultList({
  results, onCopy, hasMore, loadingMore, onLoadMore, copiedKeys, onRequestDecide, ranked, copyFormat, onCopyFormatChange,
}: ResultListProps) {
  const [filter, setFilter] = useState('')

  const visible = useMemo(() => filterResults(results, filter), [results, filter])

  if (results.length === 0) return null

  const copied = visible.filter((r) => copiedKeys.has(copiedKey(r)))
  const rest = visible.filter((r) => !copiedKeys.has(copiedKey(r)))
  const hasSplit = copied.length > 0 && rest.length > 0
  const filtering = filter.trim() !== ''

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && filter) {
      e.stopPropagation()
      setFilter('')
    }
  }

  return (
    <div className="mt-3 flex flex-col">
      {/* 결과 내 필터 */}
      <div className="mb-2 flex items-center gap-1.5">
      <div className="relative min-w-0 flex-1">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="결과 내 찾기 (초성·일부 글자 가능)"
          aria-label="결과 내 필터"
          className="h-8 pr-8 text-[12px]"
        />
        {filter && (
          <button
            type="button"
            aria-label="필터 지우기"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => setFilter('')}
          >
            <X size={12} />
          </button>
        )}
      </div>
        {onRequestDecide && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 px-2 text-[12px]"
            aria-label="앱에 추천 요청"
            onClick={onRequestDecide}
          >
            <Sparkles />
            앱에 추천 요청
          </Button>
        )}
      </div>

      {ranked && results.length > 1 && !ranked.confident && (
        <p className="mb-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800">
          확실한 1순위가 없습니다. 후보 {results.length}건을 확인해 선택해 주세요{onRequestDecide ? ' (앱에 추천 요청 가능)' : ''}.
        </p>
      )}

      {filtering && (
        <p className="mb-1 px-1 text-[11px] text-muted-foreground">
          불러온 {results.length}건 중 {visible.length}건
          {hasMore && ' · 더 보기로 추가 결과를 불러올 수 있습니다'}
        </p>
      )}

      {filtering && visible.length === 0 && (
        <p className="py-6 text-center text-[12px] text-muted-foreground">
          일치하는 항목이 없습니다.
        </p>
      )}

      {/* 복사한 항목 */}
      {copied.length > 0 && (
        <div className="flex flex-col gap-0.5 mb-1">
          {copied.map((result) => (
            <ResultItem
              key={copiedKey(result)}
              result={result}
              onCopy={onCopy}
              isCopied={true}
              query={filter}
              format={copyFormat}
              onFormatChange={onCopyFormatChange}
            />
          ))}
        </div>
      )}

      {/* 섹션 구분 */}
      {hasSplit && (
        <div className="my-1.5 flex items-center gap-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[11px] text-muted-foreground">기타</span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )}

      {/* 나머지 항목 */}
      {rest.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {rest.map((result) => (
            <ResultItem
              key={copiedKey(result)}
              result={result}
              onCopy={onCopy}
              isCopied={false}
              query={filter}
              format={copyFormat}
              onFormatChange={onCopyFormatChange}
              recommended={!!ranked?.confident && result === results[0]}
            />
          ))}
        </div>
      )}

      {/* 더 보기 */}
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full text-[12px] text-muted-foreground hover:text-foreground"
          onClick={onLoadMore}
          disabled={loadingMore}
        >
          {loadingMore ? '불러오는 중…' : '더 보기'}
        </Button>
      )}
    </div>
  )
}
