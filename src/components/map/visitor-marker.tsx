'use client'

import L from 'leaflet'
import { Marker } from 'react-leaflet'

const visitorIcon = L.divIcon({
  className: '',
  html: `
    <div style="position:relative;width:22px;height:22px">
      <div class="visitor-pulse" style="position:absolute;inset:0;background:rgba(59,130,246,.45);border:2px solid #2563eb"></div>
      <div style="position:absolute;left:6px;top:6px;width:10px;height:10px;border-radius:9999px;background:#2563eb;border:2px solid #fff;box-shadow:0 0 0 1px #2563eb"></div>
    </div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

/**
 * 访客位置。
 *
 * 隐私约束（与需求一致）：只用浏览器拿到的经纬度在地图上标一个点，
 * **不反查文字地址、不发往任何第三方、不写入数据库或 localStorage**。
 * 坐标仅存在于当前页面内存里，刷新即忘。
 */
export function VisitorMarker({ position }: { position: [number, number] | null }) {
  if (!position) return null
  return <Marker position={position} icon={visitorIcon} interactive={false} zIndexOffset={900} />
}
