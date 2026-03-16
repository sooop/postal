import { Separator } from '@/components/ui/separator'
import type { ZipcodeResult } from '@/lib/search'
import { ResultItem } from './ResultItem'

interface ResultListProps {
  results: ZipcodeResult[]
  onCopy: (text: string) => void
}

export function ResultList({ results, onCopy }: ResultListProps) {
  if (results.length === 0) return null

  return (
    <div className="mt-3 flex flex-col gap-1">
      {results.map((result, i) => (
        <div key={`${result.zipcode}-${i}`}>
          {i > 0 && <Separator className="my-1" />}
          <ResultItem result={result} onCopy={onCopy} />
        </div>
      ))}
    </div>
  )
}
