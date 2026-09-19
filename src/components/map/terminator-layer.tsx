'use client'

import { useMemo } from 'react'
import { CircleMarker, Pane, Polygon, Polyline } from 'react-leaflet'
import {
  getSolarPosition,
  nightPolygon,
  terminatorPath,
  twilightSegments,
} from '@/lib/solar'

interface TerminatorLayerProps {
  /** 要绘制的时刻 */
  date: Date
  visible: boolean
  /** 是否绘制晨昏蒙影线（−6° / −12°） */
  showTwilight?: boolean
}

/**
 * 动态晨昏线图层。
 *
 * 三层结构（自下而上）：
 *   1. 夜半球 Polygon —— 半透明深色填充
 *   2. 晨昏蒙影 Polyline —— 民用 −6°、航海 −12° 虚线
 *   3. 晨昏线 Polyline —— 亮黄实线 + 太阳直射点
 *
 * 放在自定义 pane(zIndex=350) 里：高于瓦片(200)、低于覆盖物(400)，
 * 这样既压在地图上，又不会盖住学校标记的点击。
 * 所有 path 都设 interactive:false，避免挡住下层交互。
 */
export function TerminatorLayer({ date, visible, showTwilight = true }: TerminatorLayerProps) {
  const solar = useMemo(() => getSolarPosition(date), [date])
  const night = useMemo(() => nightPolygon(solar, 2), [solar])
  const terminator = useMemo(() => terminatorPath(solar, 1), [solar])
  const civil = useMemo(
    () => (showTwilight ? twilightSegments(solar, -6, 2) : []),
    [solar, showTwilight],
  )
  const nautical = useMemo(
    () => (showTwilight ? twilightSegments(solar, -12, 2) : []),
    [solar, showTwilight],
  )

  if (!visible) return null

  return (
    <Pane name="zxssxsc-terminator" style={{ zIndex: 350 }}>
      {/* 1. 夜半球 */}
      <Polygon
        positions={night}
        pathOptions={{
          stroke: false,
          fillColor: '#0b1220',
          fillOpacity: 0.45,
          interactive: false,
          className: 'terminator-night-pane',
        }}
      />

      {/* 2. 晨昏蒙影 */}
      {civil.map((seg, i) => (
        <Polyline
          key={`civil-${i}`}
          positions={seg}
          pathOptions={{
            color: '#fde68a',
            weight: 1.4,
            opacity: 0.6,
            dashArray: '4 6',
            interactive: false,
          }}
        />
      ))}
      {nautical.map((seg, i) => (
        <Polyline
          key={`naut-${i}`}
          positions={seg}
          pathOptions={{
            color: '#bfdbfe',
            weight: 1.2,
            opacity: 0.42,
            dashArray: '2 8',
            interactive: false,
          }}
        />
      ))}

      {/* 3. 晨昏线本体 */}
      <Polyline
        positions={terminator}
        pathOptions={{ color: '#fbbf24', weight: 2.5, opacity: 0.95, interactive: false }}
      />

      {/* 太阳直射点：外圈光晕 + 内核 */}
      <CircleMarker
        center={[solar.subsolarLat, solar.subsolarLng]}
        radius={14}
        pathOptions={{
          stroke: false,
          fillColor: '#fbbf24',
          fillOpacity: 0.25,
          interactive: false,
        }}
      />
      <CircleMarker
        center={[solar.subsolarLat, solar.subsolarLng]}
        radius={6}
        pathOptions={{
          color: '#b45309',
          weight: 2,
          fillColor: '#fef08a',
          fillOpacity: 1,
          interactive: false,
        }}
      />
    </Pane>
  )
}
