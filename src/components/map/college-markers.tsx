'use client'

import L from 'leaflet'
import { Marker, Popup } from 'react-leaflet'
import type { CollegeGroup } from '@/lib/holidays'
import type { CollegeStatus } from '@/lib/types'
import { COLLEGE_STATUS_LABELS, HOLIDAY_WINDOW_LABELS } from '@/lib/types'
import { COLLEGE_STATUS_COLORS } from '@/lib/college-status'

export { COLLEGE_STATUS_COLORS }

function collegeIcon(status: CollegeStatus, active: boolean): L.DivIcon {
  const color = COLLEGE_STATUS_COLORS[status]
  const size = active ? 22 : 15
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

interface CollegeMarkersProps {
  groups: CollegeGroup[]
  activeKey: string | null
  onSelect: (key: string) => void
}

/**
 * 大学标记。数量少（几十所），直接用 react-leaflet 的 Marker + Popup，
 * 弹窗内容是 React 节点，不存在 HTML 字符串注入问题。
 */
export function CollegeMarkers({ groups, activeKey, onSelect }: CollegeMarkersProps) {
  return (
    <>
      {groups.map((g) => {
        const active = g.key === activeKey
        return (
          <Marker
            key={g.key}
            position={[g.lat, g.lng]}
            icon={collegeIcon(g.status, active)}
            zIndexOffset={active ? 1000 : 0}
            eventHandlers={{ click: () => onSelect(g.key) }}
          >
            <Popup autoPan closeButton>
              <div className="min-w-[220px] max-w-[280px] text-[13px] leading-relaxed">
                <div className="pr-4 font-semibold text-[14px]">{g.university_name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {g.province}
                  {g.city !== g.province ? ` · ${g.city}` : ''}
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <span
                    className="inline-block size-2.5 shrink-0 rounded-full"
                    style={{ background: COLLEGE_STATUS_COLORS[g.status] }}
                  />
                  <span
                    className="font-medium"
                    style={{ color: COLLEGE_STATUS_COLORS[g.status] }}
                  >
                    {COLLEGE_STATUS_LABELS[g.status]}
                  </span>
                  {g.window ? (
                    <span className="text-xs text-muted-foreground">
                      {HOLIDAY_WINDOW_LABELS[g.window.type]} · {g.window.days} 天
                    </span>
                  ) : null}
                </div>

                <div className="mt-2 space-y-1.5 border-t pt-2">
                  {g.all.map((h) => (
                    <div key={h.id} className="text-xs">
                      <div className="font-medium">
                        {h.academic_year} 学年
                        <span className="ml-1 font-normal text-muted-foreground">v{h.version}</span>
                      </div>
                      <div className="text-muted-foreground">
                        寒假 {h.winter_start ?? '未公布'} → {h.winter_end ?? '未公布'}
                      </div>
                      <div className="text-muted-foreground">
                        暑假 {h.summer_start ?? '未公布'} → {h.summer_end ?? '未公布'}
                      </div>
                      {h.note ? (
                        <div className="text-[11px] text-muted-foreground">{h.note}</div>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
                  校历来源：
                  {g.current.source_url ? (
                    <a
                      href={g.current.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      查看原始校历页
                    </a>
                  ) : (
                    '未标注'
                  )}
                </div>

                <div className="mt-2 flex items-center justify-between border-t pt-2">
                  <span className="text-[11px] text-muted-foreground">
                    当前命中 {g.current.academic_year}
                  </span>
                  <a
                    href={`/college-holiday/${g.current.id}`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    查看详情 / 版本历史 →
                  </a>
                </div>
              </div>
            </Popup>
          </Marker>
        )
      })}
    </>
  )
}
