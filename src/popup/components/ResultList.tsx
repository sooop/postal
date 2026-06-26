import { Button } from '@/components/ui/button'
import type { ZipcodeResult } from '@/lib/search'
import { ResultItem } from './ResultItem'

interface ResultListProps {
  results: ZipcodeResult[]
  onCopy: (zipcode: string) => void
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  copiedZipcodes: Set<string>
}

export function ResultList({
  results, onCopy, hasMore, loadingMore, onLoadMore, copiedZipcodes,
}: ResultListProps) {
  if (results.length === 0) return null

  const copied = results.filter((r) => copiedZipcodes.has(r.zipcode))
  const rest = results.filter((r) => !copiedZipcodes.has(r.zipcode))
  const hasSplit = copied.length > 0 && rest.length > 0

  return (
    <div className="mt-3 flex flex-col">
      {/* 복사한 항목 */}
      {copied.length > 0 && (
        <div className="flex flex-col gap-0.5 mb-1">
          {copied.map((result) => (
            <ResultItem
              key={result.zipcode}
              result={result}
              onCopy={onCopy}
              isCopied={true}
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
              key={result.zipcode}
              result={result}
              onCopy={onCopy}
              isCopied={false}
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
