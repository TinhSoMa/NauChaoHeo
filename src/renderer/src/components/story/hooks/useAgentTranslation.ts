import { useState, useCallback, useEffect, useRef } from 'react'
import type { Chapter } from '@shared/types'

export interface AgentTranslationState {
  detected: boolean | null
  detecting: boolean
  running: boolean
  completedBatches: number
  totalBatches: number
  error: string | null
}

export function useAgentTranslation() {
  const [state, setState] = useState<AgentTranslationState>({
    detected: null,
    detecting: false,
    running: false,
    completedBatches: 0,
    totalBatches: 0,
    error: null
  })

  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      cleanupRef.current?.()
    }
  }, [])

  const detect = useCallback(async (agentId?: string) => {
    setState((s) => ({ ...s, detecting: true, error: null }))
    try {
      const result = await window.electronAPI.agentTranslation.detect(agentId)
      setState((s) => ({
        ...s,
        detected: result.detected,
        detecting: false,
        error: result.detected ? null : result.error || 'Agent not found'
      }))
      return result.detected
    } catch (err) {
      setState((s) => ({
        ...s,
        detected: false,
        detecting: false,
        error: err instanceof Error ? err.message : String(err)
      }))
      return false
    }
  }, [])

  const start = useCallback(async (
    chapters: Chapter[],
    sourceLang: string,
    targetLang: string,
    batchSize: number = 10,
    _memory?: { glossary?: string; continuity?: string } | null,
    agentId?: string
  ) => {
    const detected = await detect(agentId)
    if (!detected) {
      setState((s) => ({ ...s, error: `Agent "${agentId || 'opencode'}" is not installed or not found on PATH` }))
      return false
    }

    setState((s) => ({
      ...s,
      running: true,
      error: null,
      completedBatches: 0,
      totalBatches: Math.ceil(chapters.length / batchSize)
    }))

    cleanupRef.current?.()
    const unsub = window.electronAPI.agentTranslation.onProgress((progress) => {
      setState((s) => ({
        ...s,
        completedBatches: progress.batchNumber,
        running: progress.status !== 'error',
        error: progress.error || null
      }))
    })
    cleanupRef.current = unsub

    try {
      const result = await window.electronAPI.agentTranslation.start({
        agentId,
        chapters,
        sourceLang,
        targetLang,
        batchSize,
        memory: _memory || null
      })

      if (!result.success) {
        setState((s) => ({ ...s, running: false, error: result.error || 'Failed to start' }))
        return false
      }

      setState((s) => ({
        ...s,
        totalBatches: result.totalBatches || 0
      }))
      return true
    } catch (err) {
      setState((s) => ({
        ...s,
        running: false,
        error: err instanceof Error ? err.message : String(err)
      }))
      return false
    }
  }, [detect])

  const cancel = useCallback(async () => {
    cleanupRef.current?.()
    await window.electronAPI.agentTranslation.cancel()
    setState((s) => ({ ...s, running: false }))
  }, [])

  return {
    ...state,
    detect,
    start,
    cancel
  }
}
