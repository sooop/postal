import { useEffect, useState } from 'react'

interface CopyNotificationProps {
  message: string
  onDone: () => void
}

export function CopyNotification({ message, onDone }: CopyNotificationProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false)
      onDone()
    }, 2000)
    return () => clearTimeout(timer)
  }, [onDone])

  if (!visible) return null

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
      {message}
    </div>
  )
}
