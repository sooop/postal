import { useState, useCallback, useEffect } from 'react'
import { Mail, Settings as SettingsIcon } from 'lucide-react'
import { searchZipcode, smartSearchZipcode, type SearchMode, type Source, type ZipcodeResult } from '@/lib/search'
import { parseInput } from '@/lib/match/parse'
import { shouldUseSmart } from '@/lib/match/plan'
import { isConfident } from '@/lib/match/rank'
import {
  saveSearch, getSearch, deleteSearch, deleteDecision, clearPageCache, listRecentFull, clearAll, pruneOld,
  markCopied, getCopiedKeys, copiedKey, getLearned, putLearned, deleteLearned, isFresh,
  type SearchRecord,
} from '@/lib/db'
import { SearchBox } from './components/SearchBox'
import { ResultList } from './components/ResultList'
import { HistoryList } from './components/HistoryList'
import { CopyNotification } from './components/CopyNotification'
import { SettingsPanel } from './components/SettingsPanel'
import { SourceSwitch } from './components/SourceSwitch'
import { DecideModal } from './components/DecideModal'
import { loadSettings, saveSettings, DEFAULT_SETTINGS, sanitizeSettings, type Settings } from '@/lib/settings'
import { canDecideFrom } from '@/lib/decide'
import { decisionKey } from '@/lib/decideCache'
import { formatCopy } from '@/lib/copy'
import { normalizeQuery } from '@/lib/input'
import { isSameAddress, learnKey, upsertRecord, type LearnedRecord } from '@/lib/learn'
import { LearnedCard } from './components/LearnedCard'

export function App() {
  const [results, setResults] = useState<ZipcodeResult[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const [copyAction, setCopyAction] = useState<{ label: string; onClick: () => void } | undefined>()
  /** 현재 입력에 대해 사용자가 기억해 둔 주소 */
  const [learned, setLearned] = useState<LearnedRecord | null>(null)
  const [searched, setSearched] = useState(false)
  const [recentItems, setRecentItems] = useState<SearchRecord[]>([])
  const [currentQuery, setCurrentQuery] = useState('')
  /** 검색창에 보이는 입력값 */
  const [inputQuery, setInputQuery] = useState('')
  /** 현재 결과가 검색 이력(캐시)에서 불러온 것인지. 같은 검색어로 다시 검색하면 캐시를 버리고 새로 조회한다 */
  const [fromHistory, setFromHistory] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextTargetRow, setNextTargetRow] = useState(1)
  /** 현재 결과를 가져온 조회처(더 보기는 이 조회처로 고정) */
  const [source, setSource] = useState<Source>('epost')
  const [copiedKeys, setCopiedKeys] = useState<Set<string>>(new Set())
  /** 입력 분석 검색으로 가져온 결과인지(점수순). 아니면 null */
  const [smart, setSmart] = useState<{ queries: string[] } | null>(null)

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [showSettings, setShowSettings] = useState(false)
  const [decideOpen, setDecideOpen] = useState(false)

  useEffect(() => {
    loadSettings().then(setSettings).catch(console.error)
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.settings) setSettings(sanitizeSettings(changes.settings.newValue))
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [])

  const refreshRecent = async () => {
    const items = await listRecentFull()
    setRecentItems(items)
  }

  useEffect(() => {
    Promise.all([refreshRecent(), getCopiedKeys()])
      .then(([, copied]) => setCopiedKeys(copied))
      .catch(console.error)
  }, [])

  /** 입력에 해당하는 기억된 주소를 읽어 화면에 올린다(검색이 끝나기 전에도 바로 쓸 수 있게) */
  const loadLearned = async (q: string): Promise<LearnedRecord | undefined> => {
    const key = learnKey(q)
    const rec = key ? await getLearned(key).catch(() => undefined) : undefined
    setLearned(rec ?? null)
    return rec
  }

  const handleSearch = async (query: string, mode: SearchMode = settings.searchMode) => {
    // 전각 숫자·하이픈 변형을 정리하고, 구우편번호는 000-000 으로 통일한다
    const q = normalizeQuery(query).query
    if (!q) { setError('검색어를 입력해주세요.'); return }

    // 이력에서 불러온 결과를 같은 검색어로 다시 검색하면: 이력·응답 캐시·판정 기억을 지우고 새로 조회·평가한다
    if (fromHistory && q === currentQuery) {
      await Promise.all([
        deleteSearch(q).catch(console.error),
        clearPageCache().catch(console.error),
        deleteDecision(decisionKey(q)).catch(console.error),
      ])
    }
    setFromHistory(false)
    setLoading(true)
    setError(null)
    setResults([])
    setSearched(false)
    setHasMore(false)
    setCurrentQuery(q)
    const rec = await loadLearned(q)

    try {
      // 구우편번호만의 입력이나 단서가 없는 입력이 아니면, 입력을 분석해 여러 검색어로 조회하고 점수순으로 보여 준다
      if (shouldUseSmart(parseInput(q))) {
        const r = await smartSearchZipcode(q, mode, rec ? [{ zip5: rec.selected.zip5, road: rec.selected.road }] : [])
        setSmart({ queries: r.queries.slice(0, r.queriesRun) })
        setSource(mode === 'juso' ? 'juso' : 'epost')
        setResults(r.results)
        setHasMore(false)
        setNextTargetRow(2)
        setSearched(true)
        await saveSearch({ keyword: q, results: r.results, lastTargetRow: 2, hasMore: false, source: mode === 'juso' ? 'juso' : 'epost', updatedAt: Date.now() })
        await pruneOld(50)
        await refreshRecent()
        // 확실한 1순위가 없으면(설정에 따라) 앱 판정을 자동으로 요청한다
        if (!r.confident && r.results.length > 1 && settings.decideEnabled && settings.autoDecide && canDecideFrom(q)) setDecideOpen(true)
        return
      }
      setSmart(null)
      const page = await searchZipcode(q, 1, mode)
      setSource(page.source)
      setResults(page.results)
      setHasMore(page.hasMore)
      setNextTargetRow(page.nextTargetRow)
      setSearched(true)
      await saveSearch({ keyword: q, results: page.results, lastTargetRow: page.nextTargetRow, hasMore: page.hasMore, source: page.source, updatedAt: Date.now() })
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
    // 오래된 이력(7일 초과)은 결과를 그대로 쓰지 않고 다시 조회한다
    if (cached && isFresh(cached.updatedAt)) {
      setResults(cached.results)
      setHasMore(cached.hasMore)
      setNextTargetRow(cached.lastTargetRow)
      setSource(cached.source ?? 'epost')
      setSmart(cached.results.some((r) => r.match) ? { queries: [] } : null)
      setCurrentQuery(keyword)
      setInputQuery(keyword)
      setFromHistory(true)
      await loadLearned(keyword)
      setSearched(true)
      setError(null)
      await saveSearch({ ...cached, updatedAt: Date.now() }).catch(console.error)
      await refreshRecent()
    } else {
      setInputQuery(keyword)
      await handleSearch(keyword)
    }
  }

  const handleLoadMore = async () => {
    if (!currentQuery || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await searchZipcode(currentQuery, nextTargetRow, source)
      const merged = [...results, ...page.results]
      setResults(merged)
      setHasMore(page.hasMore)
      setNextTargetRow(page.nextTargetRow)
      await saveSearch({ keyword: currentQuery, results: merged, lastTargetRow: page.nextTargetRow, hasMore: page.hasMore, source, updatedAt: Date.now() }).catch(console.error)
    } catch (err) {
      setError(`더 보기 오류: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoadingMore(false)
    }
  }

  /** 검색 방식을 바꾸면 저장하고, 이미 검색한 결과가 있으면 같은 검색어로 바로 다시 검색한다 */
  const handleModeChange = async (mode: SearchMode) => {
    setSettings((prev) => ({ ...prev, searchMode: mode }))
    await saveSettings({ searchMode: mode }).catch(console.error)
    if (searched && currentQuery) await handleSearch(currentQuery, mode)
  }

  /** 복사 형식을 바꾸면 기억해 다음에도 항목을 눌렀을 때 그 형식으로 복사한다 */
  const handleCopyFormatChange = (copyFormat: Settings['copyFormat']) => {
    setSettings((prev) => ({ ...prev, copyFormat }))
    void saveSettings({ copyFormat }).catch(console.error)
  }

  const handleClearRecent = async () => {
    await clearAll().catch(console.error)
    setRecentItems([])
    setCopiedKeys(new Set())
  }

  const remember = async (result: ZipcodeResult) => {
    const key = learnKey(currentQuery)
    if (!key) return
    const rec = upsertRecord(learned ?? undefined, key, currentQuery, result, Date.now())
    await putLearned(rec).catch(console.error)
    setLearned(rec)
    setCopyAction(undefined)
    setCopyMessage('기억했습니다')
  }

  const handleCopy = async (result: ZipcodeResult) => {
    const key = copiedKey(result)
    await markCopied(key).catch(console.error)
    setCopiedKeys((prev) => new Set([...prev, key]))
    if (learned && isSameAddress(result, learned.selected)) {
      // 이미 기억한 주소를 다시 쓰면 확정 횟수만 올린다
      const rec = upsertRecord(learned, learned.key, learned.input, result, Date.now())
      await putLearned(rec).catch(console.error)
      setLearned(rec)
      setCopyAction(undefined)
    } else {
      // 학습은 사용자가 직접 누를 때만 한다. 기억할 수 없는 입력(단서 없음)에는 버튼을 보이지 않는다
      setCopyAction(learnKey(currentQuery) ? { label: '이 주소 기억', onClick: () => void remember(result) } : undefined)
    }
    setCopyMessage('복사되었습니다')
  }

  const handleCopyLearned = async (rec: LearnedRecord) => {
    await navigator.clipboard.writeText(formatCopy(settings.copyFormat, { zipcode: rec.selected.zip5, roadAddress: rec.selected.road, jibunAddress: rec.selected.jibun ?? '' })).catch(console.error)
    const next = { ...rec, hits: rec.hits + 1, lastUsedAt: Date.now() }
    await putLearned(next).catch(console.error)
    setLearned(next)
    setCopyAction(undefined)
    setCopyMessage('복사되었습니다')
  }

  const handleForget = async (rec: LearnedRecord) => {
    await deleteLearned(rec.key).catch(console.error)
    setLearned(null)
  }

  const handleCopyDone = useCallback(() => { setCopyMessage(null); setCopyAction(undefined) }, [])

  const recentKeywords = recentItems.map((r) => r.keyword)

  return (
    /* 팝업 루트: 폭 470px, 최대 높이 내에서 스크롤 */
    <div className={`relative w-[470px] max-h-[580px] overflow-y-auto bg-background ${decideOpen ? 'min-h-[420px]' : ''}`}>

      {/* ── sticky 헤더: 타이틀 + 검색박스 ── */}
      <div className="sticky top-0 z-20 bg-background/97 backdrop-blur-sm border-b border-border px-4 pt-4 pb-3">
        <div className="flex items-center gap-1.5 mb-3">
          <Mail size={14} className="text-primary shrink-0" strokeWidth={2.2} />
          <h1 className="text-[15px] font-semibold tracking-tight text-foreground leading-none">
            우편번호 검색
          </h1>
          <button
            type="button"
            aria-label="설정"
            aria-pressed={showSettings}
            onClick={() => setShowSettings((v) => !v)}
            className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <SettingsIcon size={14} />
          </button>
        </div>
        <SearchBox
          query={inputQuery}
          onQueryChange={setInputQuery}
          onSearch={handleSearch}
          loading={loading}
          recent={recentKeywords}
          onSelectRecent={handleSelectRecent}
          onClearRecent={handleClearRecent}
        />
        <SourceSwitch mode={settings.searchMode} onChange={handleModeChange} />
        {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
      </div>

      {/* ── 스크롤 콘텐츠 영역 ── */}
      {showSettings ? (
        <SettingsPanel settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />
      ) : (
      <div className="px-4 pb-5">
        {learned && (loading || searched) && (
          <LearnedCard record={learned} onCopy={handleCopyLearned} onForget={handleForget} />
        )}
        {searched && (
          <>
            {results.length === 0 && !loading && (
              <p className="py-8 text-center text-[13px] text-muted-foreground">
                검색 결과가 없습니다.
              </p>
            )}
            {!loading && fromHistory && (
              <p className="mt-3 text-[11px] text-amber-700">
                검색 이력에서 불러온 결과입니다. 같은 검색어로 다시 검색하면 캐시를 지우고 새로 조회·평가합니다.
              </p>
            )}
            {!loading && smart && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                입력을 분석해 {smart.queries.length > 0 ? `${smart.queries.length}개 검색어로 ` : ''}우체국·도로명주소를 함께 조회했습니다
                {' · '}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground"
                  title={smart.queries.length ? `검색어: ${smart.queries.join(' / ')}` : '입력 그대로 단순 검색'}
                  onClick={async () => {
                    setSmart(null)
                    const page = await searchZipcode(currentQuery, 1, settings.searchMode).catch((e) => { setError(String(e)); return null })
                    if (!page) return
                    setSource(page.source); setResults(page.results); setHasMore(page.hasMore); setNextTargetRow(page.nextTargetRow)
                  }}
                >
                  입력 그대로 검색
                </button>
              </p>
            )}
            {!loading && !smart && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                출처: {source === 'juso' ? '도로명주소(juso)' : '우체국'}
                {settings.searchMode === 'auto' && source === 'juso' && ' · 우체국 결과가 없거나 조회에 실패해 대체했습니다'}
                {' · '}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={() => handleSearch(currentQuery, source === 'juso' ? 'epost' : 'juso')}
                >
                  {source === 'juso' ? '우체국으로 다시 검색' : '도로명주소로 다시 검색'}
                </button>
              </p>
            )}
            <ResultList
              key={currentQuery}
              results={results}
              onCopy={handleCopy}
              hasMore={hasMore}
              loadingMore={loadingMore}
              onLoadMore={handleLoadMore}
              copiedKeys={copiedKeys}
              copyFormat={settings.copyFormat}
              onCopyFormatChange={handleCopyFormatChange}
              ranked={smart ? { confident: isConfident(results.map((r) => ({ score: r.match?.score ?? 0 }))) } : undefined}
              onRequestDecide={
                settings.decideEnabled && canDecideFrom(currentQuery) && results.length > 0
                  ? () => setDecideOpen(true)
                  : undefined
              }
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
      )}

      {decideOpen && settings.decideEnabled && (
        <DecideModal
          query={currentQuery}
          results={results}
          aiEnabled={settings.aiEnabled}
          learned={learned}
          copyFormat={settings.copyFormat}
          thresholds={settings.thresholds}
          onClose={() => setDecideOpen(false)}
          onSelect={handleCopy}
          onOpenSettings={() => { setDecideOpen(false); setShowSettings(true) }}
        />
      )}

      {copyMessage && (
        <CopyNotification message={copyMessage} onDone={handleCopyDone} action={copyAction} />
      )}
    </div>
  )
}
