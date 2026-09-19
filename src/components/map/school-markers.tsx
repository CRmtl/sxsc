'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { Marker, Popup, useMap } from 'react-leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'

import type { School } from '@/lib/types'
import { durationColor } from '@/lib/geo'
import { SchoolPopupContent, schoolIcon, schoolMarkerIconFor } from './school-marker-icon'

interface SchoolMarkersProps {
  schools: School[]
  /** 被选中的学校：会被移出聚合图层，单独用 React 渲染并自动打开弹窗 */
  activeSchool: School | null
  onSelect: (id: string) => void
  onDeselect: () => void
}

/**
 * 学校标记 + 区域聚合。
 *
 * 聚合必须用命令式的 leaflet.markercluster（react-leaflet 没有对应封装），
 * 而命令式 API 只能绑定 HTML 字符串弹窗 —— 那会把匿名用户输入直接塞进
 * innerHTML，是明确的 XSS 通道。所以这里的做法是：
 *   - 聚合图层里的标记**不绑定任何弹窗**，点击只回调 onSelect(id)；
 *   - 被选中的那一所由 react-leaflet 的 <Marker> + <Popup> 用 React 节点渲染，
 *     并自动 openPopup()。
 * 既拿到了聚合性能，又没有 HTML 字符串注入面。
 */
export function SchoolMarkers({
  schools,
  activeSchool,
  onSelect,
  onDeselect,
}: SchoolMarkersProps) {
  const map = useMap()
  const groupRef = useRef<L.MarkerClusterGroup | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // 建立 / 销毁聚合图层
  useEffect(() => {
    const group = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 55,
      disableClusteringAtZoom: 15,
      removeOutsideVisibleBounds: true,
      iconCreateFunction: (cluster) =>
        L.divIcon({
          html: `<div>${cluster.getChildCount()}</div>`,
          className: 'marker-cluster-zxssxsc',
          iconSize: L.point(44, 44),
        }),
    })
    map.addLayer(group)
    groupRef.current = group
    return () => {
      map.removeLayer(group)
      groupRef.current = null
    }
  }, [map])

  // 同步标记
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    group.clearLayers()

    const markers: L.Marker[] = []
    for (const school of schools) {
      if (activeSchool && school.id === activeSchool.id) continue
      const marker = L.marker([school.lat, school.lng], {
        icon: schoolIcon(durationColor(school.daily_hours)),
        // 提升大量重叠点时的点击命中率
        riseOnHover: true,
        title: school.name,
      })
      marker.on('click', () => onSelectRef.current(school.id))
      markers.push(marker)
    }
    group.addLayers(markers)

    return () => {
      group.clearLayers()
    }
  }, [schools, activeSchool])

  // 选中的学校：React 渲染，天然转义，且自动展开弹窗
  const markerRef = useRef<L.Marker | null>(null)

  useEffect(() => {
    if (!activeSchool) return
    const marker = markerRef.current
    if (!marker) return
    // 等一帧，确保 Marker 已经挂到地图上
    const id = window.setTimeout(() => marker.openPopup(), 60)
    return () => window.clearTimeout(id)
  }, [activeSchool])

  return (
    <>
      {activeSchool ? (
        <Marker
          position={[activeSchool.lat, activeSchool.lng]}
          icon={schoolMarkerIconFor(activeSchool, true)}
          ref={markerRef}
          zIndexOffset={1000}
          eventHandlers={{
            popupclose: () => onDeselect(),
          }}
        >
          <Popup autoPan closeButton>
            <SchoolPopupContent school={activeSchool} />
          </Popup>
        </Marker>
      ) : null}
    </>
  )
}
