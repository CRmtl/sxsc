'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'

import { LayerSwitcher } from '@/components/layer-switcher'
import { MapLegend } from '@/components/map-legend'
import { EMPTY_FILTER, SearchBar, filterSchools, type SchoolFilter } from '@/components/search-bar'
import { SolarReadout, type SolarReference } from '@/components/solar-readout'
import { TimeSlider } from '@/components/time-slider'
import { Button } from '@/components/ui/button'
import type { MapFocusRequest } from '@/components/map/map-effects'
import type { VisibleLayers } from '@/components/map/leaflet-map'
import { useTimeTravel } from '@/hooks/use-time-travel'
import { filterNearbySchools, formatKm } from '@/lib/geo'
import { groupByUniversity, holidayOn, toDateKey } from '@/lib/holidays'
import { DEFAULT_TILE_PROVIDER_ID } from '@/lib/tileProviders'
import type { CollegeHoliday, Holiday, School } from '@/lib/types'

/**
 * Leaflet 在模块加载期就会访问 window，必须 ssr:false。
 * 注意：next/dynamic 的 ssr:false 只能出现在客户端组件里，
 * 所以这个文件本身是 'use client'。
 */
const LeafletMap = dynamic(() => import('@/components/map/leaflet-map'), {
  ssr: false,
  loading: () => <MapSkeleton />,
})

function MapSkeleton() {
  return (
    <div className="grid h-full w-full place-items-center bg-muted">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在加载地图…
      </div>
    </div>
  )
}

interface SchoolExplorerProps {
  schools: School[]
  collegeHolidays: CollegeHoliday[]
  festivals: Holiday[]
  dataMode: 'mock' | 'supabase'
}

const DEFAULT_LAYERS: VisibleLayers = {
  schools: true,
  heat: false,
  terminator: true,
  colleges: false,
}

/** 附近学校的默认半径（公里） */
const NEARBY_RADIUS_KM = 100

export function SchoolExplorer({
  schools,
  collegeHolidays,
  festivals,
  dataMode,
}: SchoolExplorerProps) {
  const time = useTimeTravel()

  const [filter, setFilter] = useState<SchoolFilter>(EMPTY_FILTER)
  const [layers, setLayers] = useState<VisibleLayers>(DEFAULT_LAYERS)
  const [showTwilight, setShowTwilight] = useState(true)
  const [tileProviderId, setTileProviderId] = useState(DEFAULT_TILE_PROVIDER_ID)
  const [activeSchoolId, setActiveSchoolId] = useState<string | null>(null)
  const [focus, setFocus] = useState<MapFocusRequest | null>(null)
  const [visitor, setVisitor] = useState<[number, number] | null>(null)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)
  const [nearbyOnly, setNearbyOnly] = useState(false)

  /* ---------------- 筛选 ---------------- */

  const byAreaAndKeyword = useMemo(() => filterSchools(schools, filter), [schools, filter])

  const nearby = useMemo(() => {
    if (!visitor) return []
    return filterNearbySchools(byAreaAndKeyword, visitor[0], visitor[1], NEARBY_RADIUS_KM)
  }, [byAreaAndKeyword, visitor])

  const visibleSchools = useMemo(
    () => (nearbyOnly && visitor ? nearby.map((n) => n.school) : byAreaAndKeyword),
    [nearbyOnly, visitor, nearby, byAreaAndKeyword],
  )

  const activeSchool = useMemo(
    () => visibleSchools.find((s) => s.id === activeSchoolId) ?? null,
    [visibleSchools, activeSchoolId],
  )

  /* ---------------- 图层数据 ---------------- */

  // 热力图权重用「每日上学时长」归一化到 0.15~1
  const heatPoints = useMemo<Array<[number, number, number]>>(
    () =>
      visibleSchools.map((s) => [
        s.lat,
        s.lng,
        Math.min(1, Math.max(0.15, (s.daily_hours - 5) / 9)),
      ]),
    [visibleSchools],
  )

  // 大学状态跟随“视图时刻”，这样晨昏线和放假状态说的是同一天
  const viewDateKey = time.effectiveDate ? toDateKey(time.effectiveDate) : ''
  const collegeGroups = useMemo(
    () => (viewDateKey ? groupByUniversity(collegeHolidays, viewDateKey) : []),
    [collegeHolidays, viewDateKey],
  )

  const solarReference = useMemo<SolarReference>(
    () =>
      visitor
        ? { lat: visitor[0], lng: visitor[1], label: '我的位置（仅本地）' }
        : { lat: 39.9042, lng: 116.4074, label: '北京（默认）' },
    [visitor],
  )

  // 当天节日：与大学放假页同一份数据源
  const todayFestival = useMemo(() => {
    if (!time.now) return null
    return holidayOn(festivals, toDateKey(time.now))
  }, [festivals, time.now])

  /* ---------------- 交互 ---------------- */

  const flyToSchool = useCallback((school: School, zoom = 13) => {
    setActiveSchoolId(school.id)
    setFocus({ lat: school.lat, lng: school.lng, zoom, key: Date.now() })
  }, [])

  const handleSelectFromMap = useCallback(
    (id: string) => {
      // 空字符串代表取消选中（点空白处 / 关闭弹窗）
      if (!id) {
        setActiveSchoolId(null)
        return
      }
      setActiveSchoolId(id)
    },
    [],
  )

  const handleLocate = useCallback(() => {
    setLocateError(null)

    if (!('geolocation' in navigator)) {
      setLocateError('当前浏览器不支持定位，已显示全国视图。')
      return
    }
    // 非安全上下文（http）下浏览器会直接拒绝
    if (!window.isSecureContext) {
      setLocateError('定位需要 HTTPS 或 localhost 环境。已显示全国视图。')
      return
    }

    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        // 只保留经纬度于内存中：不反查地址、不上传、不落盘
        setVisitor([lat, lng])
        setNearbyOnly(true)
        setLocating(false)
        setFocus({ lat, lng, zoom: 9, key: Date.now() })
      },
      (err) => {
        setLocating(false)
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? '你拒绝了定位授权，已显示全国视图。'
            : '定位失败，已显示全国视图。',
        )
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    )
  }, [])

  const clearVisitor = useCallback(() => {
    setVisitor(null)
    setNearbyOnly(false)
    setFocus({ lat: 34.5, lng: 105, zoom: 4, key: Date.now() })
  }, [])

  const geometryDate = time.geometryDate

  return (
    <div className="flex flex-col">
      {/* 搜索栏 */}
      <div className="px-3 pt-3 sm:px-4">
        {todayFestival ? (
          <div className="mb-2">
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
              今天是 {todayFestival.name}
            </span>
          </div>
        ) : null}
        <SearchBar
          schools={schools}
          filter={filter}
          onFilterChange={setFilter}
          onPick={(s) => flyToSchool(s, 13)}
        />
      </div>

      {/* 地图主体：约 70% 屏高 */}
      <div className="relative mt-3 h-[70vh] min-h-[440px] w-full overflow-hidden border-y">
        <LeafletMap
          schools={visibleSchools}
          colleges={layers.colleges ? collegeGroups : []}
          heatPoints={heatPoints}
          visibleLayers={layers}
          geometryDate={geometryDate}
          showTwilight={showTwilight}
          visitor={visitor}
          activeSchool={activeSchool}
          onSelectSchool={handleSelectFromMap}
          activeCollegeKey={null}
          onSelectCollege={() => {}}
          focus={focus}
          tileProviderId={tileProviderId}
        />

        {/* 左上：太阳几何读数 */}
        <div className="pointer-events-none absolute left-2 top-2 z-[500]">
          <div className="pointer-events-auto">
            <SolarReadout date={geometryDate} reference={solarReference} />
          </div>
        </div>

        {/* 右上（滑块左侧）：图层与定位 */}
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
        />

        {/* 右侧：竖向时间滑块 */}
        <TimeSlider
          time={time}
          className="absolute bottom-2 right-2 top-2 z-[500] sm:bottom-3 sm:right-3 sm:top-3"
        />

        {/* 右下：悬浮 + 按钮（避开滑块） */}
        <Button
          asChild
          size="fab"
          className="absolute bottom-4 right-[68px] z-[500] sm:right-[92px]"
          title="上传或修改学校数据"
        >
          <Link href="/submit" aria-label="上传或修改学校数据">
            <Plus />
          </Link>
        </Button>

        {/* 定位/筛选状态条 */}
        <div className="absolute bottom-2 left-2 z-[500] flex max-w-[calc(100%-160px)] flex-col gap-1">
          {visitor ? (
            <div className="flex items-center gap-2 rounded-full border bg-background/92 px-3 py-1 text-[11px] shadow backdrop-blur">
              <span className="inline-block size-2 rounded-full bg-blue-600" />
              <span>
                已定位，附近 {NEARBY_RADIUS_KM}km 内 {nearby.length} 所
                {nearbyOnly ? '（仅显示这些）' : ''}
              </span>
              <button
                type="button"
                onClick={() => setNearbyOnly((v) => !v)}
                className="text-primary hover:underline"
              >
                {nearbyOnly ? '显示全部' : '只看附近'}
              </button>
              <button
                type="button"
                onClick={clearVisitor}
                className="text-muted-foreground hover:text-foreground"
                aria-label="清除定位"
              >
                <X className="size-3" />
              </button>
            </div>
          ) : null}

          {nearbyOnly && visitor && nearby.length > 0 ? (
            <div className="max-h-[130px] w-[260px] overflow-y-auto rounded-lg border bg-background/92 p-1 text-[11px] shadow backdrop-blur thin-scrollbar">
              {nearby.slice(0, 12).map(({ school, distanceKm }) => (
                <button
                  key={school.id}
                  type="button"
                  onClick={() => flyToSchool(school, 14)}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-accent"
                >
                  <span className="min-w-0 flex-1 truncate">{school.name}</span>
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {formatKm(distanceKm)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {locateError ? (
            <div className="rounded border bg-background/92 px-2 py-1 text-[11px] text-muted-foreground shadow backdrop-blur">
              {locateError}
            </div>
          ) : null}
        </div>
      </div>

      {/* 底部图例 */}
      <MapLegend
        schools={visibleSchools}
        colleges={layers.colleges ? collegeGroups : []}
        showSchools={layers.schools}
        showColleges={layers.colleges}
        showHeat={layers.heat}
      />

      {/* 数据来源说明 */}
      <div className="px-3 py-2 text-[11px] leading-relaxed text-muted-foreground sm:px-4">
        {dataMode === 'mock' ? (
          <>
            <strong className="text-foreground">当前为演示数据：</strong>
            学校名单真实，但「每日在校时长 / 上学天数 / 作息」均为示例值，
            大学校历同样是示例，不代表任何学校。接入 Supabase 后自动切换为真实数据。
          </>
        ) : (
          <>数据由匿名访客共同维护，可能存在误差；发现错误请点右下角「+」修正。</>
        )}
        <span className="ml-1">
          底图 © OpenStreetMap contributors（ODbL 许可，需署名与相同方式共享）。
        </span>
      </div>
    </div>
  )
}
