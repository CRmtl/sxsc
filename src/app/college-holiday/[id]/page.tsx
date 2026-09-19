import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { ArrowLeft, ExternalLink, PencilLine, Snowflake, Sun } from 'lucide-react'

import { RevisionList } from '@/components/revision-list'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getDataMode, getStore } from '@/lib/data-source'
import { windowsOf } from '@/lib/holidays'
import { HOLIDAY_WINDOW_LABELS, type HolidayWindowType } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** generateMetadata 与页面会取同一份数据，用 React cache 去重 */
const loadCalendar = cache(async (id: string) => {
  const store = getStore()
  const holiday = await store.getCollegeHoliday(id)
  if (!holiday) return null
  const revisions = await store.listCollegeHolidayRevisions(id)
  return { holiday, revisions }
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const data = await loadCalendar(id)
  // 同 school/[id]：必须在这里 notFound()。
  // app/loading.tsx 让路由变成流式渲染，页面组件里的 notFound() 只渲染界面、
  // 不改状态码；metadata 在流式输出前解析，才能给出真正的 404。
  if (!data) notFound()
  const h = data.holiday
  return {
    title: `${h.university_name} ${h.academic_year} 学年校历`,
    description: `${h.university_name} ${h.academic_year} 学年寒假与暑假起止时间、放假天数与校历来源。`,
  }
}

function fmt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

const WINDOW_ICON: Record<HolidayWindowType, typeof Snowflake> = {
  winter: Snowflake,
  summer: Sun,
}

function WindowCard({
  type,
  start,
  end,
  days,
}: {
  type: HolidayWindowType
  start: string | null
  end: string | null
  days: number | null
}) {
  const Icon = WINDOW_ICON[type]
  const known = start && end
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Icon className="size-3.5" />
          {HOLIDAY_WINDOW_LABELS[type]}
        </div>
        {known ? (
          <>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
              {start} → {end}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              共 {days} 天（含首尾）
            </div>
          </>
        ) : (
          <>
            <div className="mt-1 text-lg font-semibold text-muted-foreground">未公布</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              抓取时该假期日期尚未公布，留空而不是猜一个
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default async function CollegeCalendarPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const data = await loadCalendar(id)
  if (!data) notFound()

  const { holiday, revisions } = data
  const windows = windowsOf(holiday)
  const winter = windows.find((w) => w.type === 'winter')
  const summer = windows.find((w) => w.type === 'summer')
  const dataMode = getDataMode()

  return (
    <div className="mx-auto w-full max-w-4xl px-3 py-5 sm:px-4">
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/college-holiday">
          <ArrowLeft className="size-4" />
          返回放假地图
        </Link>
      </Button>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight sm:text-2xl">
            {holiday.university_name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {holiday.province}
            {holiday.city !== holiday.province ? ` · ${holiday.city}` : ''}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{holiday.academic_year} 学年</Badge>
            <Badge variant="outline" className="font-mono">
              v{holiday.version}
            </Badge>
          </div>
        </div>

        <Button asChild>
          <Link href="/submit?type=college">
            <PencilLine className="size-4" />
            修改这份校历
          </Link>
        </Button>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <WindowCard
          type="winter"
          start={holiday.winter_start}
          end={holiday.winter_end}
          days={winter?.days ?? null}
        />
        <WindowCard
          type="summer"
          start={holiday.summer_start}
          end={holiday.summer_end}
          days={summer?.days ?? null}
        />
      </div>

      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">来源与备注</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">校历来源：</span>
            {holiday.source_url ? (
              <a
                href={holiday.source_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 break-all text-primary hover:underline"
              >
                {holiday.source_url}
                <ExternalLink className="size-3.5 shrink-0" />
              </a>
            ) : (
              <span className="text-muted-foreground">
                未标注 —— 欢迎通过「修改这份校历」补上，这是数据可信度的来源
              </span>
            )}
          </div>

          <div className="text-muted-foreground">
            坐标：<span className="font-mono">{holiday.lat.toFixed(6)}, {holiday.lng.toFixed(6)}</span>
          </div>
          <div className="text-muted-foreground">创建：{fmt(holiday.created_at ?? '')}</div>
          <div className="text-muted-foreground">最后更新：{fmt(holiday.updated_at ?? '')}</div>

          {holiday.note ? (
            <div className="rounded-md border bg-muted/40 p-2.5">
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">备注</div>
              <p className="whitespace-pre-wrap break-words">{holiday.note}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            版本历史（{revisions.length}）
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              任意访客均可回滚，回滚也会留下新快照
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RevisionList
            apiBase="/api/college-holidays"
            entityId={holiday.id}
            currentVersion={holiday.version}
            entityLabel="这份校历"
            rows={revisions.map((rev) => {
              const snap = rev.snapshot
              return {
                id: rev.id,
                version: rev.version,
                createdAt: rev.created_at,
                changeNote: rev.change_note,
                title: `${snap.university_name} · ${snap.academic_year}`,
                summary: [
                  { text: `寒假 ${snap.winter_start ?? '—'} → ${snap.winter_end ?? '—'}` },
                  { text: `暑假 ${snap.summer_start ?? '—'} → ${snap.summer_end ?? '—'}` },
                ],
              }
            })}
          />
        </CardContent>
      </Card>

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        校历由匿名访客共同维护，可能与学校最新通知不一致。请以各校教务处公布为准。
        发现错误请点「修改这份校历」更正 —— 修改会保留版本历史，其他人可以随时回滚。
        {dataMode === 'mock' ? (
          <span className="text-amber-700">
            {' '}
            当前为演示数据，接入 Supabase 后自动切换为真实数据。
          </span>
        ) : null}
      </p>
    </div>
  )
}
