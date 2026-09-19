'use client'

import { Toaster } from 'sonner'

/**
 * 全局 toast。sonner 只在客户端工作，所以单独包一层 'use client'，
 * 由 layout（服务端组件）直接引用即可。
 */
export function AppToaster() {
  return (
    <Toaster
      position="top-center"
      richColors
      closeButton
      toastOptions={{
        className: 'text-sm',
        duration: 5000,
      }}
    />
  )
}
