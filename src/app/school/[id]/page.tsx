import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { ArrowLeft, PencilLine } from 'lucide-react'

import { RevisionList } from '@/components/revision-list'
import { SchoolDetailMap } from '@/components/school-detail-map'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DURATION_BUCKET_MAP, durationBucket } from '@/lib/geo'
import { getDataMode, getStore } from '@/lib/data-source'
import { STAGE_LABELS } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * generateMetadata 和页面组件都会取同一份数据，用 React cache 去重，
 * 避免同一次请求里对数据库查两遍。
 */
const loadSchool = cache(async (id: string) => {
  const store = getStore()
  const school = await store.getSchool(id)
  if (!school) return null
  const revisions = await store.listRevisions(id)
  return { school, revisions }
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const data = await loadSchool(id)
  // 注意：这里必须真的 notFound()，不能只返回一个「不存在」标题。
  // 原因：app/loading.tsx 让这些路由进入**流式渲染** —— 响应体的状态码
  // 在页面组件执行完之前就已经发出去了，页面里再调 notFound() 只会渲染
  // 未找到界面，HTTP 状态仍然是 200。
  // generateMetadata 在响应体开始流式输出**之前**解析完，在这里抛出
  // 才能让状态码正确落成 404（这对 SEO 与「资源是否真的存在」都重要）。
  if (!data) notFound()
  return {
    title: `${data.school.name} · 上学时长`,
    description: `${data.school.province}${data.school.city}${data.school.district} ${data.school.name}：每日在校 ${data.school.daily_hours} 小时，每周 ${data.school.weekly_days} 天。`,
  }
}

function fmt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

export default async function SchoolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const data = await loadSchool(id)
  if (!data) notFound()

  const { school, revisions } = data
  const bucket = DURATION_BUCKET_MAP[durationBucket(school.daily_hours)]
  const sj = school.schedule_json
  const dataMode = getDataMode()

  return (
    <div className="mx-auto w-full max-w-4xl px-3 py-5 sm:px-4">
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/">
          <ArrowLeft className="size-4" />
          返回地图
        </Link>
      </Button>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight sm:text-2xl">{school.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {school.province}
            {school.city !== school.province ? ` · ${school.city}` : ''} · {school.district}
            {school.address ? ` · ${school.address}` : ''}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{STAGE_LABELS[school.stage]}</Badge>
            <Badge variant="outline">{school.boarding ? '住宿制' : '走读'}</Badge>
            <Badge variant="outline" className="font-mono">
              v{school.version}
            </Badge>
          </div>
        </div>

        <Button asChild>
          <Link href="/submit">
            <PencilLine className="size-4" />
            修改这所学校
          </Link>
        </Button>
      </div>

      {/* 核心数字 */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">每日在校时长</div>
            <div
              className="mt-1 font-mono text-2xl font-bold tabular-nums"
              style={{ color: bucket.color }}
            >
              {school.daily_hours}
              <span className="ml-0.5 text-sm font-normal">h</span>
            </div>
            <div className="mt-0.5 text-[11px]" style={{ color: bucket.color }}>
              {bucket.label}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">每周上学</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums">
              {school.weekly_days}
              <span className="ml-0.5 text-sm font-normal">天</span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              每月 {school.monthly_days} 天
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">每周在校总时长</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums">
              {(school.daily_hours * school.weekly_days).toFixed(1)}
              <span className="ml-0.5 text-sm font-normal">h</span>
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              按每日 × 每周天数估算
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="text-[11px] text-muted-foreground">上下学时间</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums">
              {sj.arrive_time ?? '—'} → {sj.leave_time ?? '—'}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">主口径</div>
          </CardContent>
        </Card>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">作息明细</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="走读生">
                {sj.day_schedule
                  ? `${sj.day_schedule.arrive_time ?? '—'} → ${sj.day_schedule.leave_time ?? '—'}`
                  : '未填写'}
              </Row>
              <Row label="住宿生">
                {sj.boarding_schedule
                  ? `${sj.boarding_schedule.arrive_time ?? '—'} → ${
                      sj.boarding_schedule.leave_time ?? '—'
                    }`
                  : '未填写'}
              </Row>
              <Row label="住宿制">{school.boarding ? '是' : '否'}</Row>
              <Row label="创建时间">{fmt(school.created_at)}</Row>
              <Row label="最后更新">{fmt(school.updated_at)}</Row>
            </dl>

            {school.remark ? (
              <div className="mt-3 rounded-md border bg-muted/40 p-2.5 text-sm">
                <div className="mb-1 text-[11px] font-medium text-muted-foreground">备注</div>
                <p className="whitespace-pre-wrap break-words">{school.remark}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">位置</CardTitle>
          </CardHeader>
          <CardContent>
            <SchoolDetailMap school={school} />
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              {school.lat.toFixed(6)}, {school.lng.toFixed(6)}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              底图 © OpenStreetMap contributors（ODbL）。
            </p>
          </CardContent>
        </Card>
      </div>

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
            apiBase="/api/schools"
            entityId={school.id}
            currentVersion={school.version}
            entityLabel="这所学校"
            rows={revisions.map((rev) => {
              const snap = rev.snapshot
              const b = DURATION_BUCKET_MAP[durationBucket(snap.daily_hours)]
              return {
                id: rev.id,
                version: rev.version,
                createdAt: rev.created_at,
                changeNote: rev.change_note,
                title: snap.name,
                summary: [
                  { text: `${snap.daily_hours}h`, color: b.color },
                  { text: `每周 ${snap.weekly_days} 天` },
                  { text: snap.boarding ? '住宿' : '走读' },
                ],
              }
            })}
          />
        </CardContent>
      </Card>

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        数据由匿名访客共同维护，可能存在误差。发现错误请点「修改这所学校」直接更正 ——
        修改会保留版本历史，其他人可以随时回滚。
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-[13px] tabular-nums">{children}</dd>
    </div>
  )
}
