import { useState, useCallback } from 'react'
import { searchZipcode, type ZipcodeResult } from '@/lib/search'
import { SearchBox } from './components/SearchBox'
import { ResultList } from './components/ResultList'
import { CopyNotification } from './components/CopyNotification'

export function App() {
  const [results, setResults] = useState<ZipcodeResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      setError('검색어를 입력해주세요.')
      return
    }

    setLoading(true)
    setError(null)
    setResults([])
    setSearched(false)

    try {
      const data = await searchZipcode(query)
      setResults(data)
      setSearched(true)
    } catch (err) {
      setError(`검색 중 오류가 발생했습니다: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = useCallback((text: string) => {
    setCopyMessage(`복사됨: ${text}`)
  }, [])

  const handleCopyDone = useCallback(() => {
    setCopyMessage(null)
  }, [])

  return (
    <div className="w-80 p-4">
      <h1 className="mb-3 text-base font-semibold text-slate-800">우편번호 검색</h1>
      <SearchBox onSearch={handleSearch} loading={loading} />

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      {searched && results.length === 0 && !loading && (
        <p className="mt-4 text-center text-sm text-slate-400">검색 결과가 없습니다.</p>
      )}

      <ResultList results={results} onCopy={handleCopy} />

      {copyMessage && (
        <CopyNotification message="클립보드에 복사되었습니다" onDone={handleCopyDone} />
      )}
    </div>
  )
}
