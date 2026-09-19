import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 原生 <select> 的 shadcn 风格封装。
 *
 * 为什么不用 Radix Select：省市区分别是 34 / 374 / 3397 条，
 * 原生 select 在移动端会调用系统级滚轮选择器（体验明显更好），
 * 也没有 portal 层级、滚动锁定、可访问性一类问题。
 */
const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'h-9 w-full appearance-none rounded-md border border-input bg-background px-3 pr-8 text-sm shadow-sm',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  ),
)
Select.displayName = 'Select'

export { Select }
