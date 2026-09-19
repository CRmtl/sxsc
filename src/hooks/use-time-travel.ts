'use client'

import { useCallback, useMemo, useState } from 'react'
import { useClock } from './use-clock'

/**
 * 时间旅行状态机。
 *
 * 三个概念要分清：
 * - `now`        真实的当前时刻，每秒刷新，用于顶栏时钟。
 * - `manualDate` 用户手动指定的日期（YYYY-MM-DD）；为 null 表示“跟随今天”。
 * - `offsetHours` 相对锚点的偏移，范围 −12 ~ +12，步长 0.25。
 *
 * `effectiveDate` = (manualDate 指定的那一天 + 当前钟点) + offsetHours。
 * 也就是说：拖滑块是在“这一天”的基础上前后移动，而不是跳到别的日期。
 *
 * 为避免 SSR / CSR 时间不一致导致的 hydration 报错，`now` 初值为 null，
 * 只在浏览器挂载后赋值，所有显示处都要处理 null。
 */
export interface TimeTravel {
  now: Date | null
  offsetHours: number
  setOffsetHours: (hours: number) => void
  manualDate: string | null
  setManualDate: (date: string | null) => void
  /** 晨昏线 / 地图使用的时刻 */
  effectiveDate: Date | null
  /** 量化到 5 秒的版本：晨昏线每秒重算没有意义，5 秒足够平滑 */
  geometryDate: Date | null
  /** 是否完全等同于“此刻” */
  isLive: boolean
  resetToNow: () => void
}

export const OFFSET_MIN = -12
export const OFFSET_MAX = 12
export const OFFSET_STEP = 0.25

function dateKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

export function useTimeTravel(): TimeTravel {
  const now = useClock(1000)
  const [offsetHours, setOffsetHoursRaw] = useState(0)
  const [manualDate, setManualDate] = useState<string | null>(null)

  const setOffsetHours = useCallback((hours: number) => {
    const clamped = Math.min(OFFSET_MAX, Math.max(OFFSET_MIN, hours))
    // 对齐到 0.25 的整数倍，避免浮点误差累积出 0.2500000000000001
    setOffsetHoursRaw(Math.round(clamped / OFFSET_STEP) * OFFSET_STEP)
  }, [])

  const effectiveDate = useMemo(() => {
    if (!now) return null
    let anchor = now
    if (manualDate) {
      const [y, m, d] = manualDate.split('-').map(Number)
      anchor = new Date(y, (m ?? 1) - 1, d ?? 1, now.getHours(), now.getMinutes(), now.getSeconds())
    }
    return new Date(anchor.getTime() + offsetHours * 3_600_000)
  }, [now, manualDate, offsetHours])

  const geometryDate = useMemo(() => {
    if (!effectiveDate) return null
    // 量化到 5 秒网格
    return new Date(Math.floor(effectiveDate.getTime() / 5000) * 5000)
  }, [effectiveDate])

  const isLive = offsetHours === 0 && manualDate === null

  const resetToNow = useCallback(() => {
    setOffsetHoursRaw(0)
    setManualDate(null)
  }, [])

  return {
    now,
    offsetHours,
    setOffsetHours,
    manualDate,
    setManualDate,
    effectiveDate,
    geometryDate,
    isLive,
    resetToNow,
  }
}

/** 供“日期选择”输入框使用：把今天转换成 YYYY-MM-DD */
export function todayKey(d: Date | null): string {
  return d ? dateKeyOf(d) : ''
}
