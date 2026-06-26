import { useState, useCallback, useEffect } from 'react'
import { Mail } from 'lucide-react'
import { searchZipcode, type ZipcodeResult } from '@/lib/search'
import {
  saveSearch, getSearch, listRecentFull, clearAll, pruneOld,
  markCopied, getCopiedZipcodes,
  type SearchRecord,
} from '@/lib/db'
import { SearchBox } from './components/SearchBox'
import { ResultList } from './components/ResultList'
import { HistoryList } from './components/HistoryList'
import { CopyNotification } from './components/CopyNotification'

export function App() {
  const [results, setResults] = useState<ZipcodeResult[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [recentItems, setRecentItems] = useState<SearchRecord[]>([])
  const [currentQuery, setCurrentQuery] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [nextTargetRow, setNextTargetRow] = useState(1)
  const [copiedZipcodes, setCopiedZipcodes] = useState<Set<string>>(new Set())

  const refreshRecent = async () => {
    const items = await listRecentFull()
    setRecentItems(items)
  }

  useEffect(() => {
    Promise.all([refreshRecent(), getCopiedZipcodes()])
      .then(([, copied]) => setCopiedZipcodes(copied))
      .catch(console.error)
  }, [])

  const handleSearch = async (query: string) => {
    const q = query.trim()
    if (!q) { setError('검색어를 입력해주세요.'); return }

    setLoading(true)
    setError(null)
    setResults([])
    setSearched(false)
    setHasMore(false)
    setCurrentQuery(q)

    try {
      const page = await searchZipcode(q, 1)
      setResults(page.results)
      setHasMore(page.hasMore)
      setNextTargetRow(page.nextTargetRow)
      setSearched(true)
      await saveSearch({ keyword: q, results: page.results, lastTargetRow: page.nextTargetRow, hasMore: page.hasMore, updatedAt: Date.now() })
      await pruneOld(50)
      await refreshRecent()
    } catch (err) {
      setError(`검색 중 오류가 발생했습니다: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectRecent = async (keyword: string) => {
    const cached = await getSearch(keyword).catch(() => undefined)
    if (cached) {
      setResults(cached.results)
      setHasMore(cached.hasMore)
      setNextTargetRow(cached.lastTargetRow)
      setCurrentQuery(keyword)
      setSearched(true)
      setError(null)
      await saveSearch({ ...cached, updatedAt: Date.now() }).catch(console.error)
      await refreshRecent()
    } else {
      await handleSearch(keyword)
    }
  }

  const handleLoadMore = async () => {
    if (!currentQuery || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await searchZipcode(currentQuery, nextTargetRow)
      const merged = [...results, ...page.results]
      setResults(merged)
      setHasMore(page.hasMore)
      setNextTargetRow(page.nextTargetRow)
      await saveSearch({ keyword: currentQuery, results: merged, lastTargetRow: page.nextTargetRow, hasMore: page.hasMore, updatedAt: Date.now() }).catch(console.error)
    } catch (err) {
      setError(`더 보기 오류: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoadingMore(false)
    }
  }

  const handleClearRecent = async () => {
    await clearAll().catch(console.error)
    setRecentItems([])
    setCopiedZipcodes(new Set())
  }

  const handleCopy = useCallback(async (zipcode: string) => {
    await markCopied(zipcode).catch(console.error)
    setCopiedZipcodes((prev) => new Set([...prev, zipcode]))
    setCopyMessage('복사되었습니다')
  }, [])

  const handleCopyDone = useCallback(() => setCopyMessage(null), [])

  const recentKeywords = recentItems.map((r) => r.keyword)

  return (
    /* 팝업 루트: 폭 360px, 최대 높이 내에서 스크롤 */
    <div className="relative w-[360px] max-h-[580px] overflow-y-auto bg-background">

      {/* ── sticky 헤더: 타이틀 + 검색박스 ── */}
      <div className="sticky top-0 z-20 bg-background/97 backdrop-blur-sm border-b border-border px-4 pt-4 pb-3">
        <div className="flex items-center gap-1.5 mb-3">
          <Mail size={14} className="text-primary shrink-0" strokeWidth={2.2} />
          <h1 className="text-[15px] font-semibold tracking-tight text-foreground leading-none">
            우편번호 검색
          </h1>
        </div>
        <SearchBox
          onSearch={handleSearch}
          loading={loading}
          recent={recentKeywords}
          onSelectRecent={handleSelectRecent}
          onClearRecent={handleClearRecent}
        />
        {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
      </div>

      {/* ── 스크롤 콘텐츠 영역 ── */}
      <div className="px-4 pb-5">
        {searched && (
          <>
            {results.length === 0 && !loading && (
              <p className="py-8 text-center text-[13px] text-muted-foreground">
                검색 결과가 없습니다.
              </p>
            )}
            <ResultList
              results={results}
              onCopy={handleCopy}
              hasMore={hasMore}
              loadingMore={loadingMore}
              onLoadMore={handleLoadMore}
              copiedZipcodes={copiedZipcodes}
            />
          </>
        )}

        {!searched && !loading && (
          <HistoryList
            items={recentItems}
            onSelect={handleSelectRecent}
            onClearAll={handleClearRecent}
          />
        )}
      </div>

      {copyMessage && (
        <CopyNotification message={copyMessage} onDone={handleCopyDone} />
      )}
    </div>
  )
}
