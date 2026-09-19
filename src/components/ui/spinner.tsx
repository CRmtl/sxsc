import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'

interface LoadingSpinnerProps {
  /** 结合场景的文案，例如「正在加载地图数据…」；不传则只有图标 */
  label?: string
  size?: 'sm' | 'default' | 'lg'
  className?: string
}

const SIZE = {
  sm: 'size-3.5',
  default: 'size-4',
  lg: 'size-6',
} as const

/**
 * 统一加载指示器。
 *
 * 之前项目里 6 处各写一遍 <Loader2 className="animate-spin"/> + 文案，
 * 文案字号、颜色、无障碍标注都不一致。收敛成一个组件后：
 *   · 统一带 role="status" + aria-live，读屏会播报「加载中」；
 *   · 没有 label 时用 sr-only 文本兜底，避免出现「只有动画没有语义」。
 */
export function LoadingSpinner({ label, size = 'default', className }: LoadingSpinnerProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center gap-2 text-muted-foreground', className)}
    >
      <Loader2 className={cn('animate-spin', SIZE[size])} aria-hidden />
      {label ? <span className="text-sm">{label}</span> : <span className="sr-only">加载中</span>}
    </span>
  )
}
