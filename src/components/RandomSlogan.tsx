'use client'

import { useEffect, useState } from 'react'

/**
 * 顶部随机标语。
 *
 * 关键约束：服务端必须渲染空内容。
 * 随机数在服务端和客户端必然不同，直接 useState(随机) 会导致 hydration
 * 不匹配（React 会报 text content did not match）。
 * 所以初值固定为空串，挂载后再随机选。
 *
 * 渲染时保留一行高度，避免文案填进来时把下方内容顶下去（CLS）。
 */
const SLOGANS = ['适当的休息是必要的噢！', '祝你好运！'] as const

export function RandomSlogan() {
  const [slogan, setSlogan] = useState('')

  useEffect(() => {
    setSlogan(SLOGANS[Math.floor(Math.random() * SLOGANS.length)])
  }, [])

  return (
    <p
      className="min-h-[1.25rem] px-3 pb-1.5 text-center text-[13px] leading-5 text-muted-foreground"
      // 文案是装饰性的，用 polite 播报即可，不要抢焦点
      aria-live="polite"
    >
      {slogan}
    </p>
  )
}
