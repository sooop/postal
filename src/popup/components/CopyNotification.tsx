import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

interface CopyNotificationProps {
  message: string
  onDone: () => void
  /** 있으면 알림에 버튼을 보여 주고 표시 시간을 늘린다(예: '기억') */
  action?: { label: string; onClick: () => void }
}

export function CopyNotification({ message, onDone, action }: CopyNotificationProps) {
  const [visible, setVisible] = useState(true)
  const hasAction = action !== undefined

  useEffect(() => {
    const timer = setTimeout(() => { setVisible(false); onDone() }, hasAction ? 5000 : 2000)
    return () => clearTimeout(timer)
  }, [onDone, hasAction])

  if (!visible) return null

  return (
    <div className="fixed bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-md bg-foreground px-3.5 py-2 text-[12px] text-background shadow-md">
      <CheckCircle2 size={13} className="shrink-0 text-amber-400" />
      {message}
      {action && (
        <button
          type="button"
          className="ml-1.5 rounded bg-background/20 px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-background/30"
          onClick={() => { action.onClick(); setVisible(false); onDone() }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
