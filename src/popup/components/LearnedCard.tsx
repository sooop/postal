import { Bookmark, X } from 'lucide-react'
import type { LearnedRecord } from '@/lib/learn'

interface LearnedCardProps {
  record: LearnedRecord
  /** 우편번호 복사 */
  onCopy: (record: LearnedRecord) => void
  onForget: (record: LearnedRecord) => void
}

/** 이 입력에 대해 사용자가 이전에 확정한 주소. 검색이 끝나기 전에도 바로 복사할 수 있다 */
export function LearnedCard({ record, onCopy, onForget }: LearnedCardProps) {
  const s = record.selected
  return (
    <div className="mt-3 flex items-stretch gap-1 rounded-md border border-sky-200 bg-sky-50/70">
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 rounded-l-md px-3 py-2 text-left transition-colors hover:bg-sky-100/70"
        aria-label={`기억된 주소 ${s.zip5} 복사`}
        onClick={() => onCopy(record)}
      >
        <span className="flex items-center gap-2">
          <span className="shrink-0 rounded bg-sky-600 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums tracking-wider text-white">{s.zip5}</span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{s.road}</span>
        </span>
        <span className="flex items-center gap-1 text-[11px] text-sky-800">
          <Bookmark size={11} />
          기억된 주소 · {record.hits}회 확정{s.buildingName ? ` · ${s.buildingName}` : ''}
        </span>
      </button>
      <button
        type="button"
        aria-label="기억 해제"
        title="이 입력에 대한 기억 해제"
        className="shrink-0 rounded-r-md px-2 text-muted-foreground transition-colors hover:bg-sky-100 hover:text-foreground"
        onClick={() => onForget(record)}
      >
        <X size={13} />
      </button>
    </div>
  )
}
