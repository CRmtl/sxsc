import type { Metadata } from 'next'
import Link from 'next/link'

import { CollegeHolidayForm } from '@/components/college-holiday-form'
import { SchoolForm } from '@/components/school-form'
import { Badge } from '@/components/ui/badge'
import { getAntiAbuseConfig } from '@/lib/anti-abuse'
import { getDataMode, getStore } from '@/lib/data-source'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '上传 / 修改数据',
  description:
    '匿名上传或修改中学每日在校时长，以及大学寒暑假校历。无需登录，提交后直接生效，并保留可回滚的版本历史。',
}

export default async function SubmitPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>
}) {
  const params = await searchParams
  const isCollege = params.type === 'college'

  const store = getStore()
  const schools = await store.listSchools()
  const cfg = getAntiAbuseConfig()
  const antiAbuse = {
    enabled: !cfg.disabled,
    minFillMs: cfg.minFillMs,
    rateLimitPerHour: cfg.rateLimitPerHour,
  }
  const dataMode = getDataMode()

  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-5 sm:px-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">
          {isCollege ? '上传 / 修改大学假期' : '上传 / 修改中学上学时长'}
        </h1>
        <Badge variant="secondary">匿名 · 无需登录 · 直接生效</Badge>
      </div>

      {/* 两个模块的切换 */}
      <div className="mb-4 inline-flex rounded-lg border p-0.5 text-sm">
        <Link
          href="/submit"
          className={cn(
            'rounded-md px-3 py-1.5 transition-colors',
            !isCollege ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-accent',
          )}
        >
          中学上学时长
        </Link>
        <Link
          href="/submit?type=college"
          className={cn(
            'rounded-md px-3 py-1.5 transition-colors',
            isCollege ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-accent',
          )}
        >
          大学假期
        </Link>
      </div>

      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
        所有提交都会经过三层防护：数据库 RLS 约束（禁止删除）、敏感词过滤、以及
        蜜罐 / 时间陷阱 / IP 限流。文本内容请保持客观中立，不要填写广告、联系方式或人身攻击内容。
        {dataMode === 'mock' ? (
          <span className="text-amber-700">
            {' '}
            当前未配置 Supabase，数据写入服务器进程内存，用于演示完整流程。
          </span>
        ) : null}
      </p>

      {isCollege ? (
        <CollegeHolidayForm antiAbuse={antiAbuse} dataMode={dataMode} />
      ) : (
        <SchoolForm schools={schools} dataMode={dataMode} antiAbuse={antiAbuse} />
      )}
    </div>
  )
}
