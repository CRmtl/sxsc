'use client'

import { useEffect } from 'react'
import L from 'leaflet'
import { useMap } from 'react-leaflet'
import 'leaflet.heat'

interface HeatLayerProps {
  /** [lat, lng, 权重]，权重用「每日上学时长」表示强度 */
  points: Array<[number, number, number]>
  visible: boolean
}

/**
 * 热力图。权重取每日上学时长，所以颜色越红代表该区域在校时间越长。
 * 色带与图例的三档色保持一致（绿 → 黄 → 红）。
 */
export function HeatLayer({ points, visible }: HeatLayerProps) {
  const map = useMap()

  useEffect(() => {
    if (!visible || points.length === 0) return

    const layer = L.heatLayer(points, {
      radius: 32,
      blur: 26,
      maxZoom: 10,
      minOpacity: 0.28,
      gradient: {
        0.15: '#16a34a',
        0.45: '#f59e0b',
        0.75: '#ea580c',
        1.0: '#dc2626',
      },
    })
    layer.addTo(map)

    return () => {
      map.removeLayer(layer)
    }
  }, [map, visible, points])

  return null
}
