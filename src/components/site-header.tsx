'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarRange, GraduationCap, HelpCircle, Map as MapIcon, PlusCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { RandomSlogan } from '@/components/RandomSlogan'
import { cn } from '@/lib/utils'
import { useClock } from '@/hooks/use-clock'
import { describeTimezone, formatChineseDate, formatClock } from '@/lib/holidays'

const NAV = [
  { href: '/', label: '上学时长地图', icon: MapIcon },
  { href: '/college-holiday', label: '大学放假', icon: CalendarRange },
  { href: '/submit', label: '上传/修改', icon: PlusCircle },
  // 锚点链接：跳到页面底部的常见问题区块。
  // 用 /#faq 而不是 #faq，是为了在任意子页面点击都能回到首页并定位。
  { href: '/#faq', label: '常见问题', icon: HelpCircle },
]

interface SiteHeaderProps {
  siteName: string
  dataMode: 'mock' | 'supabase'
}

export function SiteHeader({ siteName, dataMode }: SiteHeaderProps) {
  const now = useClock(1000)
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-[1000] border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 sm:px-4">
        {/* 站点名 */}
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          {/*
            Logo：「sxsc」四个字母按阅读顺序排成 2×2 网格 ——
            s x
            s c
            用 CSS Grid 的两列布局实现，比塞一个字符串更能精确控制字距与居中。
            它是装饰性的（旁边就有文字站点名），因此 aria-hidden，
            避免读屏把四个字母逐个念出来。
          */}
          <span
            aria-hidden
            className="grid size-9 shrink-0 grid-cols-2 place-items-center rounded-md bg-primary leading-none text-primary-foreground"
          >
            <span className="text-[11px] font-bold">s</span>
            <span className="text-[11px] font-bold">x</span>
            <span className="text-[11px] font-bold">s</span>
            <span className="text-[11px] font-bold">c</span>
          </span>
          <span className="text-base">{siteName}</span>
        </Link>

        {/* 导航 */}
        <nav className="order-3 -mx-1 flex w-full items-center gap-1 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto">
          {NAV.map((item) => {
            const active =
              item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                  active
                    ? 'bg-secondary font-medium text-secondary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* 日期 / 时间 / 时区 */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-right">
          <div className="leading-tight">
            <div className="text-xs text-muted-foreground">
              {now ? formatChineseDate(now) : '\u00a0'}
            </div>
            <div className="flex items-baseline justify-end gap-2">
              <span className="font-mono text-lg font-semibold tabular-nums">
                {now ? formatClock(now) : '--:--:--'}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {now ? describeTimezone(now) : ''}
              </span>
            </div>
          </div>

          {dataMode === 'mock' ? (
            <Badge variant="secondary" className="shrink-0" title="未配置 Supabase，使用内置演示数据">
              演示数据
            </Badge>
          ) : (
            <Badge className="shrink-0" title="已连接 Supabase">
              已连接
            </Badge>
          )}
        </div>
      </div>

      {/* 站点名下方的居中随机标语 */}
      <RandomSlogan />
    </header>
  )
}

/** 供大学生放假页复用的小徽标 */
export function DataModeHint({ dataMode }: { dataMode: 'mock' | 'supabase' }) {
  if (dataMode === 'supabase') return null
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <GraduationCap className="size-3.5" />
      当前为演示数据，接入 Supabase 后自动切换为真实数据
    </span>
  )
}
