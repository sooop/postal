import { useEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { saveSettings, normalizeAppUrl, DEFAULT_APP_URL, type Settings } from '@/lib/settings'
import { Switch } from './Switch'
import { clearLearned, importLearned, listLearned } from '@/lib/db'
import { parseLearned, serializeLearned } from '@/lib/learn'

interface SettingsPanelProps {
  settings: Settings
  onChange: (next: Settings) => void
  onClose: () => void
}

export function SettingsPanel({ settings, onChange, onClose }: SettingsPanelProps) {
  const [url, setUrl] = useState(settings.appUrl)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => { setUrl(settings.appUrl) }, [settings.appUrl])

  // 기억한 주소 관리
  const [learnedCount, setLearnedCount] = useState<number | null>(null)
  const [learnedMsg, setLearnedMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const refreshLearned = () => listLearned().then((l) => setLearnedCount(l.length)).catch(() => setLearnedCount(null))
  useEffect(() => { void refreshLearned() }, [])

  const exportLearned = async () => {
    const blob = new Blob([serializeLearned(await listLearned())], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `postal-learned-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const onImportFile = async (file: File | undefined) => {
    if (!file) return
    const parsed = parseLearned(await file.text())
    if (!parsed) { setLearnedMsg('올바른 기억 파일이 아닙니다'); return }
    const n = await importLearned(parsed.records)
    setLearnedMsg(`${n}건을 가져왔습니다${parsed.skipped ? ` (형식이 맞지 않는 ${parsed.skipped}건 제외)` : ''}`)
    void refreshLearned()
  }

  const forgetAll = async () => {
    if (!window.confirm('기억한 주소를 모두 지울까요? 되돌릴 수 없습니다.')) return
    await clearLearned()
    setLearnedMsg('모두 지웠습니다')
    void refreshLearned()
  }

  const save = async (patch: Partial<Settings>) => {
    try {
      onChange(await saveSettings(patch))
      setSaveError(null)
    } catch (e) {
      setSaveError(`설정을 저장하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const commitUrl = async () => {
    const raw = url.trim()
    if (raw === '') {
      setUrlError(null)
      if (settings.appUrl !== '') await save({ appUrl: '' })
      return
    }
    const normalized = normalizeAppUrl(raw)
    if (!normalized) { setUrlError('claude.ai 아티팩트 주소만 입력할 수 있습니다'); return }
    setUrlError(null)
    setUrl(normalized)
    if (normalized !== settings.appUrl) await save({ appUrl: normalized })
  }

  return (
    <div className="px-4 py-3 flex flex-col gap-4">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="설정 닫기"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft size={14} />
        </button>
        <h2 className="text-[13px] font-semibold text-foreground">설정</h2>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-foreground">앱 후보 판정 사용</span>
          <p className="text-[11px] leading-snug text-muted-foreground">
            구주소로 검색한 결과에서 앱이 후보별 일치 확률을 계산해 추천합니다.
            켜면 검색한 구주소와 후보 주소가 앱 화면으로 전송되며, 앱이 Claude(AI)에 질의할 수 있습니다.
          </p>
        </div>
        <Switch
          aria-label="앱 후보 판정 사용"
          checked={settings.decideEnabled}
          onChange={(v) => void save({ decideEnabled: v })}
        />
      </div>

      <div className={`flex items-start justify-between gap-3 ${settings.decideEnabled ? '' : 'opacity-60'}`}>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-foreground">확실하지 않으면 자동으로 추천 요청</span>
          <p className="text-[11px] leading-snug text-muted-foreground">
            입력을 분석해 검색한 결과에서 확실한 1순위가 없을 때 앱 판정 창을 자동으로 엽니다. 끄면 버튼을 눌렀을 때만 요청합니다.
          </p>
        </div>
        <Switch
          aria-label="확실하지 않으면 자동으로 추천 요청"
          checked={settings.autoDecide}
          disabled={!settings.decideEnabled}
          onChange={(v) => void save({ autoDecide: v })}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="app-url" className="text-[12px] font-medium text-foreground">앱 주소(URL)</label>
        <p className="text-[11px] leading-snug text-muted-foreground">
          앱이 열려 있지 않을 때 새 탭으로 여는 데 사용합니다.
          {settings.appUrl ? ' 지금은 직접 지정한 주소를 쓰고 있습니다.' : ' 비워 두면 기본 앱 주소를 사용합니다.'}
        </p>
        <Input
          id="app-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => void commitUrl()}
          onKeyDown={(e) => { if (e.key === 'Enter') void commitUrl() }}
          placeholder={`기본값 사용 (${DEFAULT_APP_URL.split('?')[0]})`}
          aria-invalid={urlError ? true : undefined}
          aria-describedby={urlError ? 'app-url-error' : undefined}
          className="h-8 text-[12px]"
        />
        {urlError && <p id="app-url-error" className="text-[11px] text-destructive">{urlError}</p>}
        {settings.appUrl && (
          <button
            type="button"
            className="self-start text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={() => { setUrl(''); setUrlError(null); void save({ appUrl: '' }) }}
          >
            기본 주소로 되돌리기
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-foreground">기억한 주소{learnedCount !== null ? ` (${learnedCount}건)` : ''}</span>
        <p className="text-[11px] leading-snug text-muted-foreground">
          복사 후 '이 주소 기억'을 눌러 저장한 입력→주소 쌍입니다. 같은 입력을 다시 검색하면 바로 보여 주고 순위에 반영합니다. 이 기기에만 저장되며 검색 기록을 지워도 유지됩니다.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="rounded border border-border px-2 py-1 text-[11px] hover:bg-accent" onClick={() => void exportLearned()}>내보내기</button>
          <button type="button" className="rounded border border-border px-2 py-1 text-[11px] hover:bg-accent" onClick={() => fileRef.current?.click()}>가져오기</button>
          <button type="button" className="rounded border border-border px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10" onClick={() => void forgetAll()}>모두 지우기</button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { void onImportFile(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        {learnedMsg && <p className="text-[11px] text-muted-foreground">{learnedMsg}</p>}
      </div>

      {saveError && <p className="text-[11px] text-destructive">{saveError}</p>}
    </div>
  )
}
