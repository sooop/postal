import { useState, useRef, type KeyboardEvent } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface SearchBoxProps {
  onSearch: (query: string) => void
  loading: boolean
  recent: string[]
  onSelectRecent: (keyword: string) => void
  onClearRecent: () => void
}

export function SearchBox({ onSearch, loading, recent, onSelectRecent, onClearRecent }: SearchBoxProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { setOpen(false); onSearch(query) }
    if (e.key === 'Escape') setOpen(false)
  }

  const handleSelect = (kw: string) => {
    setQuery(kw)
    setOpen(false)
    onSelectRecent(kw)
  }

  const handleSearch = () => { setOpen(false); onSearch(query) }

  return (
    <div className="relative flex gap-2">
      <div className="relative flex-1">
        <Input
          ref={inputRef}
          autoFocus
          placeholder="주소 또는 지역명 입력"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => recent.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="pr-2"
        />

        {open && recent.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-card shadow-sm">
            {recent.map((kw) => (
              <button
                key={kw}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                onMouseDown={(e) => { e.preventDefault(); handleSelect(kw) }}
              >
                <Search size={11} className="shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{kw}</span>
              </button>
            ))}
            <div className="border-t border-border">
              <button
                className="w-full px-3 py-1.5 text-center text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                onMouseDown={(e) => { e.preventDefault(); onClearRecent(); setOpen(false) }}
              >
                전체 지우기
              </button>
            </div>
          </div>
        )}
      </div>

      <Button onClick={handleSearch} disabled={loading} className="shrink-0">
        {loading ? '검색 중…' : '검색'}
      </Button>
    </div>
  )
}
