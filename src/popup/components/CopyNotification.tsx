import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

interface CopyNotificationProps {
  message: string
  onDone: () => void
}

export function CopyNotification({ message, onDone }: CopyNotificationProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => { setVisible(false); onDone() }, 2000)
    return () => clearTimeout(timer)
  }, [onDone])

  if (!visible) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-md bg-foreground px-3.5 py-2 text-[12px] text-background shadow-md">
      <CheckCircle2 size={13} className="shrink-0 text-amber-400" />
      {message}
    </div>
  )
}
