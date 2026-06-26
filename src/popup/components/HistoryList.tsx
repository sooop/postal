import { Clock } from 'lucide-react'
import type { SearchRecord } from '@/lib/db'

interface Props {
  items: SearchRecord[]
  onSelect: (keyword: string) => void
  onClearAll: () => void
}

export function HistoryList({ items, onSelect, onClearAll }: Props) {
  if (items.length === 0) return (
    <p className="py-10 text-center text-[12px] text-muted-foreground">검색 이력이 없습니다.</p>
  )

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          최근 검색
        </span>
        <button
          className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={onClearAll}
        >
          전체 지우기
        </button>
      </div>

      <div className="flex flex-col gap-0.5">
        {items.map((item) => {
          const empty = item.results.length === 0
          return (
            <button
              key={item.keyword}
              disabled={empty}
              onClick={() => onSelect(item.keyword)}
              className={[
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                empty
                  ? 'cursor-not-allowed opacity-40'
                  : 'cursor-pointer hover:bg-accent',
              ].join(' ')}
            >
              <Clock
                size={12}
                className={empty ? 'text-muted-foreground' : 'shrink-0 text-muted-foreground'}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                {item.keyword}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {empty ? '결과없음' : `${item.results.length}건${item.hasMore ? '+' : ''}`}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
