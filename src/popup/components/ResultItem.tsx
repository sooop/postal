import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ZipcodeResult } from '@/lib/search'

interface ResultItemProps {
  result: ZipcodeResult
  onCopy: (zipcode: string) => void
  isCopied: boolean
}

export function ResultItem({ result, onCopy, isCopied }: ResultItemProps) {
  const handleClick = () => {
    navigator.clipboard.writeText(result.zipcode).then(() => onCopy(result.zipcode))
  }

  return (
    <button
      className={cn(
        'w-full cursor-pointer rounded-md border px-3 py-2.5 text-left transition-all duration-150',
        isCopied
          ? 'border-amber-200 bg-amber-50 hover:bg-amber-100/80'
          : 'border-transparent hover:border-border hover:bg-accent/60'
      )}
      onClick={handleClick}
    >
      <div className="flex items-center gap-2">
        {/* 우편번호 칩 */}
        <span className={cn(
          'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums tracking-wider',
          isCopied
            ? 'bg-amber-500 text-white'
            : 'bg-secondary text-secondary-foreground'
        )}>
          {result.zipcode}
        </span>

        {/* 도로명 주소 */}
        <span className="min-w-0 flex-1 truncate text-[13px] leading-snug text-foreground">
          {result.roadAddress}
        </span>

        {/* 복사됨 아이콘 */}
        {isCopied && (
          <CheckCircle2 size={13} className="shrink-0 text-amber-500" />
        )}
      </div>

      {result.jibunAddress && (
        <p className="mt-1 ml-[calc(1.5rem+0.5rem)] text-[11px] leading-relaxed text-muted-foreground">
          (지번) {result.jibunAddress}
        </p>
      )}
    </button>
  )
}
