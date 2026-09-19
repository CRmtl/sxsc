'use client'

import { useMemo } from 'react'

import { DURATION_BUCKETS, durationBucket } from '@/lib/geo'
import type { CollegeGroup } from '@/lib/holidays'
import { COLLEGE_STATUS_LABELS, type CollegeStatus, type School } from '@/lib/types'
// 注意：必须从 lib 取色，不能从 map/college-markers 取 ——
// 后者顶层引入 Leaflet，值导入会把 Leaflet 拖进服务端渲染并崩掉
import { COLLEGE_STATUS_COLORS } from '@/lib/college-status'

interface MapLegendProps {
  schools: School[]
  colleges: CollegeGroup[]
  /** 当前可见的图层，决定图例显示哪几段 */
  showSchools: boolean
  showColleges: boolean
  showHeat: boolean
}

/**
 * 底部图例：说明颜色对应的上学时长 / 放假状态，并给出当前筛选下的数量分布。
 * 数量分布同时也是一个快速筛选的“读数”，用户能立刻看出样本偏向哪一档。
 */
export function MapLegend({
  schools,
  colleges,
  showSchools,
  showColleges,
  showHeat,
}: MapLegendProps) {
  const bucketCounts = useMemo(() => {
    const counts = { short: 0, mid: 0, long: 0 }
    for (const s of schools) counts[durationBucket(s.daily_hours)]++
    return counts
  }, [schools])

  const statusCounts = useMemo(() => {
    const counts: Record<CollegeStatus, number> = { before: 0, during: 0, after: 0 }
    for (const g of colleges) counts[g.status]++
    return counts
  }, [colleges])

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t bg-background px-3 py-2 text-xs sm:px-4">
      {showSchools || showHeat ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-muted-foreground">
            每日上学时长{showHeat ? '（热力图同色带）' : ''}
          </span>
          {DURATION_BUCKETS.map((b) => (
            <span key={b.id} className="inline-flex items-center gap-1.5" title={b.description}>
              <span
                className="inline-block size-3 rounded-full border border-white shadow"
                style={{ background: b.color }}
              />
              <span>{b.label}</span>
              {showSchools ? (
                <span className="font-mono tabular-nums text-muted-foreground">
                  {bucketCounts[b.id]}
                </span>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      {showColleges ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-muted-foreground">大学状态</span>
          {(['during', 'before', 'after'] as CollegeStatus[]).map((st) => (
            <span key={st} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-3 rounded-full border border-white shadow"
                style={{ background: COLLEGE_STATUS_COLORS[st] }}
              />
              <span>{COLLEGE_STATUS_LABELS[st]}</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {statusCounts[st]}
              </span>
            </span>
          ))}
        </div>
      ) : null}

      <span className="ml-auto text-[10px] text-muted-foreground">
        样本 {schools.length} 所中学 / {colleges.length} 所大学
      </span>
    </div>
  )
}
