import * as React from 'react'

import { cn } from '@/lib/utils'

/** shadcn/ui Skeleton：占位骨架块 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted', className)}
      aria-hidden
      {...props}
    />
  )
}

export { Skeleton }
