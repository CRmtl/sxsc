'use client'

import { useEffect, useState } from 'react'

import { LoadingSpinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

interface MapLoadingOverlayProps {
  visible: boolean
  label: string
  /** 延迟多少毫秒才真正显示，用于躲开「一闪而过」 */
  delayMs?: number
  className?: string
}

/**
 * 地图区域加载覆盖层。
 *
 * 解决的具体问题：瓦片还没到的时候地图容器是一片空白（底色），
 * 用户不知道是在加载还是坏了。
 *
 * 两个细节：
 *  1. **延迟显示**。本地/快网下瓦片几十毫秒就回来了，立刻显示 spinner
 *     会造成「闪一下」，比不显示更难受。默认等 250ms 还处于加载中才显示。
 *  2. z-index 取 650：盖住瓦片(200)、晨昏线(350)、标记(600)，
 *     但低于 Leaflet 自己的弹层(700) 与控件(800+)，不会把「重试」按钮
 *     那类交互元素压在下面。
 */
export function MapLoadingOverlay({
  visible,
  label,
  delayMs = 250,
  className,
}: MapLoadingOverlayProps) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!visible) {
      setShow(false)
      return
    }
    const timer = window.setTimeout(() => setShow(true), delayMs)
    return () => window.clearTimeout(timer)
  }, [visible, delayMs])

  if (!show) return null

  return (
    <div
      className={cn(
        'absolute inset-0 z-[650] flex flex-col items-center justify-center gap-3',
        'bg-background/65 backdrop-blur-[2px]',
        className,
      )}
    >
      <LoadingSpinner label={label} size="lg" />
      <p className="max-w-[80%] text-center text-xs text-muted-foreground">
        首次加载需要下载瓦片，之后就快了
      </p>
    </div>
  )
}
