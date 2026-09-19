'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, ScaleControl, TileLayer, ZoomControl } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

import { Button } from '@/components/ui/button'
import { useTileProvider } from '@/hooks/use-tile-provider'
import { CHINA_CENTER, CHINA_ZOOM, MAP_MAX_BOUNDS } from '@/lib/geo'
import {
  DEFAULT_TILE_PROVIDER_ID,
  resolveTileProvider,
  tileLayerOptions,
} from '@/lib/tileProviders'
import type { CollegeGroup } from '@/lib/holidays'
import type { School } from '@/lib/types'

import { CollegeMarkers } from './college-markers'
import { HeatLayer } from './heat-layer'
import {
  MapAutoResize,
  MapClickToDeselect,
  MapFocus,
  PreloadCenterTiles,
  type MapFocusRequest,
} from './map-effects'
import { MapLoadingOverlay } from './map-loading-overlay'
import { SchoolMarkers } from './school-markers'
import { TerminatorLayer } from './terminator-layer'
import { VisitorMarker } from './visitor-marker'

export interface VisibleLayers {
  schools: boolean
  heat: boolean
  terminator: boolean
  colleges: boolean
}

interface LeafletMapProps {
  schools?: School[]
  colleges?: CollegeGroup[]
  /** [lat, lng, 权重] */
  heatPoints?: Array<[number, number, number]>
  visibleLayers: VisibleLayers
  /** 晨昏线使用的时刻（已量化到 5 秒） */
  geometryDate: Date | null
  showTwilight?: boolean
  visitor?: [number, number] | null
  activeSchool?: School | null
  onSelectSchool?: (id: string) => void
  activeCollegeKey?: string | null
  onSelectCollege?: (key: string) => void
  focus?: MapFocusRequest | null
  tileProviderId?: string
  /** 是否允许点击空白处取消选中（表单选点页不需要） */
  deselectOnMapClick?: boolean
  /** 覆盖默认视野 */
  center?: [number, number]
  zoom?: number
  className?: string
}

/**
 * 地图主体。
 *
 * 这个组件**只能通过 next/dynamic({ ssr: false }) 引入**：
 * Leaflet 在模块加载期就会访问 window，服务端渲染必然崩。
 * 引入点见 components/school-explorer.tsx 等客户端组件。
 */
export default function LeafletMap({
  schools = [],
  colleges = [],
  heatPoints = [],
  visibleLayers,
  geometryDate,
  showTwilight = true,
  visitor = null,
  activeSchool = null,
  onSelectSchool,
  activeCollegeKey = null,
  onSelectCollege,
  focus = null,
  tileProviderId,
  deselectOnMapClick = true,
  center = CHINA_CENTER,
  zoom = CHINA_ZOOM,
  className = 'h-full w-full',
}: LeafletMapProps) {
  // 底图配置：tileProviderId 通常是 'auto'，由 useTileProvider 在客户端测速后解析成最快的镜像。
  // 放在这里而不是页面组件里，是为了让首页地图、大学页地图、详情页小地图三处都自动受益。
  const requestedTileId = tileProviderId ?? DEFAULT_TILE_PROVIDER_ID
  const { providerId: resolvedTileId, detecting: detectingTile } =
    useTileProvider(requestedTileId)
  const tile = useMemo(() => resolveTileProvider(resolvedTileId), [resolvedTileId])

  /**
   * 瓦片失败降级。
   * 判据刻意设为「连续 4 张失败 **且** 一张都没成功过」：
   * 单张 404（地图边界瓦片）不该把整块底图判死，但一张都出不来就是真的不可用。
   */
  const [tileState, setTileState] = useState<'loading' | 'ok' | 'failed'>('loading')
  const [retryKey, setRetryKey] = useState(0)
  const errorCount = useRef(0)
  const anyLoaded = useRef(false)

  useEffect(() => {
    setTileState('loading')
    errorCount.current = 0
    anyLoaded.current = false
  }, [tile.resolvedUrl, retryKey])

  // 浏览器控制台提示：一旦误用了官方源，这里会明确警告
  useEffect(() => {
    if (tile.id === 'osm') {
      console.warn(
        '[zxssxsc] 当前底图为官方 tile.openstreetmap.org，国内会大面积加载失败。请在「图层」里改用 hot / osmfr / de / 天地图。',
      )
    }
    if (tile.missingKey) {
      console.warn('[zxssxsc] 天地图 Key 缺失，已自动回退到 OSM fr 镜像。')
    }
  }, [tile.id, tile.missingKey])

  const handleRetry = useCallback(() => setRetryKey((k) => k + 1), [])

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={center}
        zoom={zoom}
        minZoom={3}
        maxZoom={19}
        maxBounds={MAP_MAX_BOUNDS}
        maxBoundsViscosity={0.85}
        zoomControl={false}
        attributionControl
        className={className}
        zoomAnimation
        worldCopyJump={false}
      >
        <TileLayer
          // key 变化时强制重建图层，用于「重试」
          key={`${tile.resolvedUrl}#${retryKey}`}
          {...tileLayerOptions(tile)}
          eventHandlers={{
            tileload: () => {
              anyLoaded.current = true
              // 函数式更新返回同一个值 → React 跳过重渲染，
              // 否则每一张瓦片加载完都会触发一次 render
              setTileState((s) => (s === 'ok' ? s : 'ok'))
            },
            tileerror: () => {
              errorCount.current += 1
              if (!anyLoaded.current && errorCount.current >= 4) setTileState('failed')
            },
          }}
        />

        {/* 预热中心 z+1 的瓦片，让「滚轮放大」这一步命中缓存 */}
        <PreloadCenterTiles
          urlTemplate={tile.resolvedUrl}
          subdomains={tile.subdomains}
          maxZoom={tile.maxNativeZoom}
        />

        <ZoomControl position="bottomright" />
        <ScaleControl position="bottomleft" imperial={false} />

        <MapAutoResize />

        {visibleLayers.terminator && geometryDate ? (
          <TerminatorLayer date={geometryDate} visible showTwilight={showTwilight} />
        ) : null}

        {visibleLayers.heat ? <HeatLayer points={heatPoints} visible /> : null}

        {visibleLayers.schools && onSelectSchool ? (
          <SchoolMarkers
            schools={schools}
            activeSchool={activeSchool}
            onSelect={onSelectSchool}
            onDeselect={() => onSelectSchool('')}
          />
        ) : null}

        {visibleLayers.colleges && onSelectCollege ? (
          <CollegeMarkers
            groups={colleges}
            activeKey={activeCollegeKey}
            onSelect={onSelectCollege}
          />
        ) : null}

        {visitor ? <VisitorMarker position={visitor} /> : null}

        <MapFocus focus={focus} />
        {deselectOnMapClick && onSelectSchool ? (
          <MapClickToDeselect onDeselect={() => onSelectSchool('')} />
        ) : null}
      </MapContainer>

      {/*
        加载阶段文案按「当前最卡住用户的那一步」切换：
        测速 → 瓦片 → 晨昏线。依次递进，避免同时抛三句话让人不知道在等什么。
        geometryDate 为 null 是首次客户端渲染、时钟还没挂载完的极短窗口，
        这时晨昏线确实还没算出来，说「正在计算晨昏线」是诚实的。
      */}
      {(() => {
        const loadingLabel = detectingTile
          ? '正在测速选择最快的底图镜像…'
          : tileState === 'loading'
            ? '正在加载地图数据…'
            : !geometryDate
              ? '正在计算晨昏线…'
              : null
        return (
          <MapLoadingOverlay
            visible={tileState !== 'failed' && loadingLabel !== null}
            label={loadingLabel ?? ''}
          />
        )
      })()}

      {tileState === 'failed' ? (
        <div className="absolute inset-0 z-[600] flex flex-col items-center justify-center gap-3 bg-slate-50/95 p-4 text-center backdrop-blur-sm dark:bg-slate-900/95">
          {/* 兜底静态图。用原生 img 而不是 next/image：SVG 占位图不需要优化管线 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/map-fallback.svg"
            alt="底图不可用示意图"
            className="max-h-[42%] w-auto max-w-[min(520px,92%)] rounded-md border"
          />
          <p className="text-sm font-semibold">地图加载失败，请刷新重试</p>
          <p className="max-w-md text-xs text-muted-foreground">
            所有 OSM 镜像都没有响应，可能是当前网络限制了这些域名，或镜像临时故障。
            你也可以在右上角「图层」里手动切换底图。
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleRetry}>
              重试
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              刷新页面
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            底图数据 &copy; OpenStreetMap contributors
          </p>
        </div>
      ) : null}
    </div>
  )
}
