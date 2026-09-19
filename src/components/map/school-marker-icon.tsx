'use client'

import L from 'leaflet'
import type { School } from '@/lib/types'
import { DURATION_BUCKET_MAP, durationBucket, durationColor } from '@/lib/geo'
import { STAGE_LABELS } from '@/lib/types'

/**
 * 学校标记的 divIcon。
 *
 * 注意：这里唯一插入 HTML 的值是 `color`，而它来自我们自己的
 * DURATION_BUCKET_MAP 常量（固定十六进制色），不含任何用户输入。
 * 学校名、备注等匿名用户内容**一律不进入 HTML 字符串**，
 * 而是通过 React 渲染在 <Popup> 子节点里 —— 从根上消除 XSS 面。
 */
export function schoolIcon(color: string, active = false): L.DivIcon {
  const size = active ? 20 : 13
  return L.divIcon({
    className: '',
    html: `<div class="school-marker${
      active ? ' school-marker--active' : ''
    }" style="width:${size}px;height:${size}px;background:${color}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  })
}

export function schoolMarkerIconFor(school: School, active = false): L.DivIcon {
  return schoolIcon(durationColor(school.daily_hours), active)
}

/** 学校详情弹窗内容（React 节点，天然转义） */
export function SchoolPopupContent({ school }: { school: School }) {
  const bucket = DURATION_BUCKET_MAP[durationBucket(school.daily_hours)]
  const sj = school.schedule_json

  return (
    <div className="min-w-[210px] max-w-[260px] text-[13px] leading-relaxed">
      <div className="pr-4 font-semibold text-[14px]">{school.name}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {school.province}
        {school.city !== school.province ? ` · ${school.city}` : ''} · {school.district}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span
          className="inline-block size-2.5 shrink-0 rounded-full"
          style={{ background: bucket.color }}
        />
        <span className="font-medium" style={{ color: bucket.color }}>
          每日 {school.daily_hours} 小时
        </span>
        <span className="text-xs text-muted-foreground">{bucket.label}</span>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
        <dt className="text-muted-foreground">每周</dt>
        <dd>
          {school.weekly_days} 天 · 每月 {school.monthly_days} 天
        </dd>
        <dt className="text-muted-foreground">学段</dt>
        <dd>{STAGE_LABELS[school.stage] ?? school.stage}</dd>
        <dt className="text-muted-foreground">住宿</dt>
        <dd>{school.boarding ? '住宿制' : '走读'}</dd>
        {sj.arrive_time || sj.leave_time ? (
          <>
            <dt className="text-muted-foreground">上下学</dt>
            <dd>
              {sj.arrive_time ?? '—'} → {sj.leave_time ?? '—'}
            </dd>
          </>
        ) : null}
      </dl>

      {school.remark ? (
        <p className="mt-1.5 line-clamp-3 border-t pt-1.5 text-xs text-muted-foreground">
          {school.remark}
        </p>
      ) : null}

      <div className="mt-2 flex items-center justify-between border-t pt-2">
        <span className="text-[11px] text-muted-foreground">v{school.version}</span>
        <a
          href={`/school/${school.id}`}
          className="text-xs font-medium text-primary hover:underline"
        >
          查看详情 / 修改 →
        </a>
      </div>
    </div>
  )
}
