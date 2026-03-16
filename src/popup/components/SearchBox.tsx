import { useState, type KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface SearchBoxProps {
  onSearch: (query: string) => void
  loading: boolean
}

export function SearchBox({ onSearch, loading }: SearchBoxProps) {
  const [query, setQuery] = useState('')

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onSearch(query)
  }

  return (
    <div className="flex gap-2">
      <Input
        autoFocus
        placeholder="주소 또는 지역명 입력"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <Button onClick={() => onSearch(query)} disabled={loading}>
        {loading ? '검색 중...' : '검색'}
      </Button>
    </div>
  )
}
