'use client'

import { useEffect, useMemo } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

import { CHINA_CENTER, CHINA_ZOOM, MAP_MAX_BOUNDS } from '@/lib/geo'
import { resolveTileProvider, tileLayerOptions } from '@/lib/tileProviders'

/**
 * 选点图钉。
 * 用 divIcon 而不是 Leaflet 默认图标：默认图标依赖 CSS 相对路径下的 PNG，
 * 在打包器里经常 404（这是 Leaflet + webpack 的经典坑），divIcon 零资源依赖。
 */
const pinIcon = L.divIcon({
  className: '',
  html: `<div style="width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#2563eb;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45)"></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 24],
})

function ClickToPick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

/**
 * 外部驱动的定位（地址搜索结果、按省跳转等）。
 * 用 key 控制，避免用户自己拖动地图时被反复拽回去。
 */
function FlyTo({ target }: { target: { lat: number; lng: number; key: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    // 用 flyTo 而不是 setView：自动定位时从全国视野平滑飞到校区，
    // 用户能看清「飞到了哪里」，而不是画面瞬间跳过去。
    map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 13), { duration: 1.1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.key])
  return null
}

function AutoResize() {
  const map = useMap()
  useEffect(() => {
    const t = window.setTimeout(() => map.invalidateSize(), 80)
    const onResize = () => map.invalidateSize()
    window.addEventListener('resize', onResize)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', onResize)
    }
  }, [map])
  return null
}

export interface LocationPickerProps {
  value: [number, number] | null
  onChange: (lat: number, lng: number) => void
  focus?: { lat: number; lng: number; key: number } | null
  tileProviderId?: string
  height?: number
}

/**
 * 地图选点。这是获取经纬度的**主路径**：点击或拖动图钉即可，
 * 不依赖任何地理编码服务，因此在国内网络下始终可用。
 */
export default function LocationPicker({
  value,
  onChange,
  focus = null,
  tileProviderId,
  height = 280,
}: LocationPickerProps) {
  const tile = useMemo(() => resolveTileProvider(tileProviderId), [tileProviderId])
  const center = value ?? CHINA_CENTER
  const zoom = value ? 14 : CHINA_ZOOM

  return (
    <div className="overflow-hidden rounded-lg border" style={{ height }}>
      <MapContainer
        center={center}
        zoom={zoom}
        minZoom={3}
        maxZoom={19}
        maxBounds={MAP_MAX_BOUNDS}
        maxBoundsViscosity={0.85}
        zoomControl={false}
        className="h-full w-full"
      >
        <TileLayer {...tileLayerOptions(tile)} />
        <ZoomControl position="bottomright" />
        <AutoResize />
        <ClickToPick onPick={onChange} />
        <FlyTo target={focus} />
        {value ? (
          <Marker
            position={value}
            icon={pinIcon}
            draggable
            eventHandlers={{
              dragend(e) {
                const ll = (e.target as L.Marker).getLatLng()
                onChange(ll.lat, ll.lng)
              },
            }}
          />
        ) : null}
      </MapContainer>
    </div>
  )
}
