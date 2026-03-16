import { Badge } from '@/components/ui/badge'
import type { ZipcodeResult } from '@/lib/search'

interface ResultItemProps {
  result: ZipcodeResult
  onCopy: (text: string) => void
}

export function ResultItem({ result, onCopy }: ResultItemProps) {
  const handleClick = () => {
    const text = `[${result.zipcode}] ${result.roadAddress}`
    navigator.clipboard.writeText(text).then(() => onCopy(text))
  }

  return (
    <button
      className="w-full cursor-pointer rounded-md border border-transparent px-3 py-2 text-left transition-colors hover:border-slate-200 hover:bg-slate-50"
      onClick={handleClick}
    >
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{result.zipcode}</Badge>
        <span className="text-sm font-medium">{result.roadAddress}</span>
      </div>
      {result.jibunAddress && (
        <p className="mt-1 pl-1 text-xs text-slate-500">(지번) {result.jibunAddress}</p>
      )}
    </button>
  )
}
