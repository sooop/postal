import { useMemo } from 'react'
import { highlightSegments } from '@/lib/fuzzy'

interface HighlightProps {
  text: string
  query: string
}

/** 필터 질의와 일치한 글자를 강조해서 보여준다 */
export function Highlight({ text, query }: HighlightProps) {
  const segments = useMemo(() => highlightSegments(text, query), [text, query])

  return (
    <>
      {segments.map((seg, i) =>
        seg.hit ? (
          <mark key={i} className="rounded-[2px] bg-yellow-200 px-px text-foreground">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  )
}
