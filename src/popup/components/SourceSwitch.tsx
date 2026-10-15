import type { SearchMode } from '@/lib/search'

const OPTIONS: { value: SearchMode; label: string; title: string }[] = [
  { value: 'auto', label: '자동', title: '우체국 먼저, 결과가 없거나 실패하면 도로명주소(juso)로 검색' },
  { value: 'epost', label: '우체국', title: '우체국몰 우편번호 검색 (구우편번호 검색 가능)' },
  { value: 'juso', label: '도로명주소', title: '행정안전부 도로명주소 안내시스템 검색' },
]

interface SourceSwitchProps {
  mode: SearchMode
  onChange: (mode: SearchMode) => void
}

/** 검색 방식 선택(분할 버튼). 바꾸면 현재 검색어로 다시 검색한다 */
export function SourceSwitch({ mode, onChange }: SourceSwitchProps) {
  return (
    <div role="radiogroup" aria-label="검색 방식" className="mt-2 flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">검색 방식</span>
      <div className="inline-flex overflow-hidden rounded-md border border-border">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={mode === o.value}
            title={o.title}
            onClick={() => mode !== o.value && onChange(o.value)}
            className={
              'px-2 py-0.5 text-[11px] transition-colors ' +
              (mode === o.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground')
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
