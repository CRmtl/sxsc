'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import { CalendarDays, Loader2, Plus, PlusCircle, X } from 'lucide-react'

import { LayerSwitcher } from '@/components/layer-switcher'
import { TimeSlider } from '@/components/time-slider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { MapFocusRequest } from '@/components/map/map-effects'
import type { VisibleLayers } from '@/components/map/leaflet-map'
import { COLLEGE_STATUS_COLORS } from '@/lib/college-status'
import { useTimeTravel } from '@/hooks/use-time-travel'
import { PROVINCE_NAMES } from '@/lib/china-area'
import { formatKm, haversineKm } from '@/lib/geo'
import {
  formatChineseDate,
  groupByUniversity,
  holidayOn,
  toDateKey,
  type CollegeGroup,
} from '@/lib/holidays'
import { DEFAULT_TILE_PROVIDER_ID } from '@/lib/tileProviders'
import {
  COLLEGE_STATUS_LABELS,
  HOLIDAY_WINDOW_LABELS,
  type CollegeHoliday,
  type CollegeStatus,
  type Holiday,
} from '@/lib/types'

const LeafletMap = dynamic(() => import('@/components/map/leaflet-map'), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-muted">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在加载地图…
      </div>
    </div>
  ),
})

interface CollegeExplorerProps {
  holidays: CollegeHoliday[]
  festivals: Holiday[]
  dataMode: 'mock' | 'supabase'
}

const NEARBY_RADIUS_KM = 150

export function CollegeExplorer({ holidays, festivals, dataMode }: CollegeExplorerProps) {
  const time = useTimeTravel()

  const [province, setProvince] = useState('')
  const [keyword, setKeyword] = useState('')
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [focus, setFocus] = useState<MapFocusRequest | null>(null)
  const [visitor, setVisitor] = useState<[number, number] | null>(null)
  const [locating, setLocating] = useState(false)
  const [nearbyOnly, setNearbyOnly] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)

  const [layers, setLayers] = useState<VisibleLayers>({
    schools: false,
    heat: false,
    terminator: true,
    colleges: true,
  })
  const [showTwilight, setShowTwilight] = useState(true)
  const [tileProviderId, setTileProviderId] = useState(DEFAULT_TILE_PROVIDER_ID)

  const dateKey = time.effectiveDate ? toDateKey(time.effectiveDate) : ''
  const todayKey = time.now ? toDateKey(time.now) : ''
  const festival = useMemo(
    () => (dateKey ? holidayOn(festivals, dateKey) : null),
    [festivals, dateKey],
  )

  /* ---------------- 数据 ---------------- */

  const allGroups = useMemo(
    () => (dateKey ? groupByUniversity(holidays, dateKey) : []),
    [holidays, dateKey],
  )

  const groups = useMemo(() => {
    let list = allGroups
    if (province) list = list.filter((g) => g.province === province)
    const kw = keyword.trim().toLowerCase()
    if (kw) list = list.filter((g) => g.university_name.toLowerCase().includes(kw))
    if (nearbyOnly && visitor) {
      list = list
        .filter((g) => haversineKm(visitor[0], visitor[1], g.lat, g.lng) <= NEARBY_RADIUS_KM)
        .sort(
          (a, b) =>
            haversineKm(visitor[0], visitor[1], a.lat, a.lng) -
            haversineKm(visitor[0], visitor[1], b.lat, b.lng),
        )
    }
    return list
  }, [allGroups, province, keyword, nearbyOnly, visitor])

  const counts = useMemo(() => {
    const c: Record<CollegeStatus, number> = { before: 0, during: 0, after: 0 }
    for (const g of groups) c[g.status]++
    return c
  }, [groups])

  /** 正在放假的大学，按“还剩多少天”排序 —— 这个页面的核心信息 */
  const duringList = useMemo(
    () =>
      groups.filter((g) => g.status === 'during').sort((a, b) => a.daysToEnd - b.daysToEnd),
    [groups],
  )

  const upcomingList = useMemo(
    () =>
      groups.filter((g) => g.status === 'before').sort((a, b) => a.daysToStart - b.daysToStart),
    [groups],
  )

  /* ---------------- 交互 ---------------- */

  const pickGroup = useCallback((g: CollegeGroup) => {
    setActiveKey(g.key)
    setFocus({ lat: g.lat, lng: g.lng, zoom: 12, key: Date.now() })
  }, [])

  const handleLocate = useCallback(() => {
    setLocateError(null)
    if (!('geolocation' in navigator)) {
      setLocateError('当前浏览器不支持定位。')
      return
    }
    if (!window.isSecureContext) {
      setLocateError('定位需要 HTTPS 或 localhost 环境。')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setVisitor([pos.coords.latitude, pos.coords.longitude])
        setNearbyOnly(true)
        setLocating(false)
        setFocus({ lat: pos.coords.latitude, lng: pos.coords.longitude, zoom: 8, key: Date.now() })
      },
      () => {
        setLocating(false)
        setLocateError('定位失败或被拒绝，已显示全国视图。')
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    )
  }, [])

  return (
    <div className="flex flex-col">
      {/* 日期与节日 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 pt-3 text-sm sm:px-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="font-medium">
            {time.now ? formatChineseDate(time.now) : '　'}
          </span>
          {todayKey === dateKey ? (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">
              今天
            </span>
          ) : (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
              查看 {dateKey}
            </span>
          )}
        </div>

        {festival ? (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
            {festival.name}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">当天非法定节假日</span>
        )}

        <div className="ml-auto text-[11px] text-muted-foreground">
          拖动右侧滑块可查看任意日期
        </div>
      </div>

      {/* 搜索 */}
      <div className="flex flex-col gap-2 px-3 pt-3 sm:flex-row sm:items-center sm:px-4">
        <Select
          id="college-search-province"
          name="province"
          aria-label="省份"
          value={province}
          onChange={(e) => setProvince(e.target.value)}
          className="sm:w-[150px]"
        >
          <option value="">全部省份</option>
          {PROVINCE_NAMES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>

        <Input
          id="college-search-keyword"
          name="keyword"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="输入大学名称…"
          className="flex-1"
          aria-label="大学名称"
        />

        <div className="flex items-center gap-3 text-[11px]">
          {(['during', 'before', 'after'] as CollegeStatus[]).map((st) => (
            <span key={st} className="inline-flex items-center gap-1">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ background: COLLEGE_STATUS_COLORS[st] }}
              />
              {COLLEGE_STATUS_LABELS[st]}
              <strong className="font-mono tabular-nums">{counts[st]}</strong>
            </span>
          ))}
        </div>

        <Button asChild size="sm" className="shrink-0">
          <Link href="/submit?type=college">
            <PlusCircle className="size-4" />
            上传/修改校历
          </Link>
        </Button>
      </div>

      {/* 地图 */}
      <div className="relative mt-3 h-[70vh] min-h-[440px] w-full overflow-hidden border-y">
        <LeafletMap
          colleges={layers.colleges ? groups : []}
          visibleLayers={layers}
          geometryDate={time.geometryDate}
          showTwilight={showTwilight}
          visitor={visitor}
          activeCollegeKey={activeKey}
          onSelectCollege={(key) => setActiveKey(key || null)}
          focus={focus}
          tileProviderId={tileProviderId}
        />

        <LayerSwitcher
          className="absolute right-[68px] top-2 z-[500] sm:right-[88px]"
          layers={layers}
          onLayersChange={setLayers}
          showTwilight={showTwilight}
          onShowTwilightChange={setShowTwilight}
          tileProviderId={tileProviderId}
          onTileProviderChange={setTileProviderId}
          onLocate={handleLocate}
          locating={locating}
          hasVisitor={Boolean(visitor)}
          available={['colleges', 'terminator']}
        />

        <TimeSlider
          time={time}
          className="absolute bottom-2 right-2 top-2 z-[500] sm:bottom-3 sm:right-3 sm:top-3"
        />

        <Button
          asChild
          size="fab"
          className="absolute bottom-4 right-[68px] z-[500] sm:right-[92px]"
          title="上传或修改大学假期"
        >
          <Link href="/submit?type=college" aria-label="上传或修改大学假期">
            <Plus />
          </Link>
        </Button>

        {visitor || locateError ? (
          <div className="absolute bottom-2 left-2 z-[500] flex flex-col gap-1">
            {visitor ? (
              <div className="flex items-center gap-2 rounded-full border bg-background/92 px-3 py-1 text-[11px] shadow backdrop-blur">
                <span className="inline-block size-2 rounded-full bg-blue-600" />
                <span>已定位</span>
                <button
                  type="button"
                  onClick={() => setNearbyOnly((v) => !v)}
                  className="text-primary hover:underline"
                >
                  {nearbyOnly ? `显示全部` : `${NEARBY_RADIUS_KM}km 内`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVisitor(null)
                    setNearbyOnly(false)
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="清除定位"
                >
                  <X className="size-3" />
                </button>
              </div>
            ) : null}
            {locateError ? (
              <div className="rounded border bg-background/92 px-2 py-1 text-[11px] text-muted-foreground shadow backdrop-blur">
                {locateError}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 名单 */}
      <div className="grid gap-4 px-3 py-4 sm:px-4 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold">
            假期中（{duringList.length}）
            <span className="ml-2 font-normal text-muted-foreground">按剩余天数升序</span>
          </h2>
          {duringList.length === 0 ? (
            <p className="rounded border border-dashed px-3 py-4 text-xs text-muted-foreground">
              {dateKey} 这一天没有大学处于假期中。试试拖动右侧时间滑块换一个日期。
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {duringList.map((group) => (
                <li key={group.key}>
                  <button
                    type="button"
                    onClick={() => pickGroup(group)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: COLLEGE_STATUS_COLORS.during }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{group.university_name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {group.province}
                        {group.city !== group.province ? ` · ${group.city}` : ''} ·{' '}
                        {group.window
                          ? `${HOLIDAY_WINDOW_LABELS[group.window.type]} ${group.window.start} → ${group.window.end}（${group.window.days} 天）`
                          : '未公布假期日期'}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-sm font-semibold tabular-nums">
                        {group.daysToEnd} 天
                      </span>
                      <span className="block text-[10px] text-muted-foreground">后开学</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">
            尚未放假（{upcomingList.length}）
            <span className="ml-2 font-normal text-muted-foreground">按距离放假天数升序</span>
          </h2>
          {upcomingList.length === 0 ? (
            <p className="rounded border border-dashed px-3 py-4 text-xs text-muted-foreground">
              没有待放假的大学。
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {upcomingList.slice(0, 20).map((group) => (
                <li key={group.key}>
                  <button
                    type="button"
                    onClick={() => pickGroup(group)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: COLLEGE_STATUS_COLORS.before }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{group.university_name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {group.window
                          ? `${HOLIDAY_WINDOW_LABELS[group.window.type]} ${group.window.start} 起（共 ${group.window.days} 天）`
                          : '未公布假期日期'}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-sm font-semibold tabular-nums">
                        {group.daysToStart} 天
                      </span>
                      <span className="block text-[10px] text-muted-foreground">后放假</span>
                    </span>
                  </button>
                </li>
              ))}
              {upcomingList.length > 20 ? (
                <li className="px-3 py-2 text-[11px] text-muted-foreground">
                  仅显示前 20 条，共 {upcomingList.length} 条
                </li>
              ) : null}
            </ul>
          )}
        </section>
      </div>

      <div className="px-3 pb-4 text-[11px] leading-relaxed text-muted-foreground sm:px-4">
        {dataMode === 'mock' ? (
          <>
            <strong className="text-foreground">当前为演示校历：</strong>
            以下日期全部是示例排布，<strong>不是任何学校的真实校历</strong>，
            规律上让东北/华北寒假更长、华南更短。请以各校教务处公布为准。
          </>
        ) : (
          <>校历由匿名访客共同维护，请以各校教务处公布为准。</>
        )}
        <span className="ml-1">
          节假日 2025 年依据国务院办公厅安排，2026 年为参考排布，最终以当年通知为准。
        </span>
      </div>
    </div>
  )
}
