import { useEffect, useRef, useState } from 'react'
import { useMemosaStore } from '../../store'

const BAR_COUNT = 32
const FLOOR_LEVEL = 0.08

interface WaveformProps {
  color?: string
  height?: number
}

export function Waveform({ color = 'var(--accent)', height = 40 }: WaveformProps) {
  const { audioLevel, recordingStatus } = useMemosaStore()
  const isRecording = recordingStatus.is_recording

  // Keep a ref so the RAF loop always reads the latest level without stale closure
  const levelRef = useRef(audioLevel)
  useEffect(() => { levelRef.current = audioLevel }, [audioLevel])
  const visualLevelRef = useRef(0)

  const [bars, setBars] = useState<number[]>(() => Array(BAR_COUNT).fill(0.05))
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!isRecording) {
      cancelAnimationFrame(rafRef.current)
      setBars(Array(BAR_COUNT).fill(0.02))
      visualLevelRef.current = 0
      return
    }

    const animate = () => {
      const level = levelRef.current
      const boostedLevel = Math.pow(Math.max(0, level) * 18, 0.52) / Math.pow(18, 0.52)
      visualLevelRef.current = Math.max(
        boostedLevel,
        visualLevelRef.current * 0.94,
        FLOOR_LEVEL
      )
      const visualLevel = visualLevelRef.current
      const t = Date.now() * 0.003
      setBars(Array.from({ length: BAR_COUNT }, (_, i) => {
        const phase = Math.sin((i / BAR_COUNT) * Math.PI * 2 + t)
        const ripple = (Math.sin(t * 1.7 + i * 0.42) + 1) * 0.5
        const phaseWeight = 0.45 + 0.55 * Math.abs(phase) + ripple * 0.3
        const shaped = visualLevel * phaseWeight
        return Math.max(0.05, Math.min(1, shaped))
      }))
      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isRecording])

  return (
    <div
      className="flex items-center justify-center gap-px"
      style={{ height, width: '100%' }}
      aria-hidden="true"
    >
      {bars.map((h, i) => (
        <div
          key={i}
          className={isRecording ? undefined : 'waveform-bar-idle'}
          style={{
            width: 3,
            height: `${Math.round(Math.max(3, h * height))}px`,
            maxHeight: height,
            background: color,
            borderRadius: 2,
            animationDelay: isRecording ? undefined : `${i * 40}ms`,
            opacity: 0.2 + h * 0.8,
          }}
        />
      ))}
    </div>
  )
}
