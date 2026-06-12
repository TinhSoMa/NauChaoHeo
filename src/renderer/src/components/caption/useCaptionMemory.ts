import { useState, useEffect } from 'react'

export function useCaptionMemory() {
  const [memoryAvailable, setMemoryAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    const fetchHealth = async () => {
      try {
        const healthRes: any = await window.electronAPI.invoke('memoryContext:getHealth')
        if (!active) return
        if (healthRes?.success && healthRes.pythonOk && healthRes.backend !== 'unavailable') {
          setMemoryAvailable(true)
        } else {
          setMemoryAvailable(false)
        }
      } catch {
        if (active) setMemoryAvailable(false)
      }
    }
    if (memoryAvailable === null) {
      void fetchHealth()
    }
    return () => { active = false }
  }, [memoryAvailable])

  return { memoryAvailable }
}
