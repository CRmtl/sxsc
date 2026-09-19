'use client'

import { useEffect, useState } from 'react'

/**
 * 每秒跳动的时钟。
 *
 * 初值必须是 null：服务端渲染出的时间与浏览器挂载后的时间必然不同，
 * 直接 useState(new Date()) 会触发 hydration mismatch 报错。
 */
export function useClock(intervalMs = 1000): Date | null {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])

  return now
}
