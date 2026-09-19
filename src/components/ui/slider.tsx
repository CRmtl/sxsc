'use client'

import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { cn } from '@/lib/utils'

/** 支持横竖两个方向的 shadcn 风格 Slider */
const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, orientation = 'horizontal', ...props }, ref) => {
  const vertical = orientation === 'vertical'
  return (
    <SliderPrimitive.Root
      ref={ref}
      orientation={orientation}
      className={cn(
        'relative flex touch-none select-none',
        vertical ? 'h-full w-6 flex-col items-center justify-center' : 'w-full items-center',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        className={cn(
          'relative grow overflow-hidden rounded-full bg-secondary',
          vertical ? 'h-full w-1.5' : 'h-1.5 w-full',
        )}
      >
        <SliderPrimitive.Range
          className={cn('absolute bg-primary', vertical ? 'w-full' : 'h-full')}
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          'block size-5 rounded-full border-2 border-primary bg-background shadow-md transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:pointer-events-none disabled:opacity-50',
          'hover:bg-accent',
        )}
      />
    </SliderPrimitive.Root>
  )
})
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
