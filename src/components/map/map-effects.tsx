'use client'

import { useEffect } from 'react'
import { useMap } from 'react-leaflet'

export interface MapFocusRequest {
  lat: number
  lng: number
  zoom?: number
  /** 只有 key 变化才触发飞行，避免每次重渲染都把地图拽回去 */
  key: number
}

/** 飞到指定点 */
export function MapFocus({ focus }: { focus: MapFocusRequest | null }) {
  const map = useMap()

  useEffect(() => {
    if (!focus) return
    const targetZoom = focus.zoom ?? Math.max(map.getZoom(), 12)
    map.flyTo([focus.lat, focus.lng], targetZoom, { duration: 0.85 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key])

  return null
}

/**
 * 容器尺寸变化后必须 invalidateSize，否则会出现「地图只渲染左上角一块」
 * 的经典问题。这里在挂载后补一次，并监听窗口 resize 与容器自身尺寸变化。
 */
export function MapAutoResize() {
  const map = useMap()

  useEffect(() => {
    const invalidate = () => map.invalidateSize()
    const t1 = window.setTimeout(invalidate, 60)
    const t2 = window.setTimeout(invalidate, 400)

    window.addEventListener('resize', invalidate)

    let observer: ResizeObserver | null = null
    const container = map.getContainer()
    if (typeof ResizeObserver !== 'undefined' && container) {
      observer = new ResizeObserver(() => invalidate())
      observer.observe(container)
    }

    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.removeEventListener('resize', invalidate)
      observer?.disconnect()
    }
  }, [map])

  return null
}

/** 点击空白地图时取消选中 */
export function MapClickToDeselect({ onDeselect }: { onDeselect: () => void }) {
  const map = useMap()

  useEffect(() => {
    const handler = () => onDeselect()
    map.on('click', handler)
    return () => {
      map.off('click', handler)
    }
  }, [map, onDeselect])

  return null
}

/**
 * 首屏中心区域瓦片预热。
 *
 * Leaflet 自己会把**当前视口**的瓦片请求出去，所以「预加载当前屏幕」是多余的。
 * 真正有用的是预热**放大一级**的中心瓦片：用户最常见的下一步就是滚轮放大，
 * 提前把这几张放进 HTTP 缓存，放大时就是秒出。
 *
 * ponytail: 只预热中心 z+1 的 4 张。收益递减很快，再往上加只会烧用户流量；
 * 如果实测发现「连续放大两级」才是主流操作，把 ZOOM_AHEAD 改成 [1, 2] 即可。
 */
const ZOOM_AHEAD = [1]
const PRELOAD_OFFSETS: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
]

export function PreloadCenterTiles({
  urlTemplate,
  subdomains,
  maxZoom,
}: {
  urlTemplate: string
  subdomains?: string
  maxZoom: number
}) {
  const map = useMap()

  useEffect(() => {
    const hasSub = urlTemplate.includes('{s}')
    if (hasSub && !subdomains) return

    const preload = () => {
      const base = map.getZoom()
      for (const ahead of ZOOM_AHEAD) {
        const z = Math.min(base + ahead, maxZoom)
        if (z <= base) continue
        const p = map.project(map.getCenter(), z).divideBy(256).floor()
        for (const [dx, dy] of PRELOAD_OFFSETS) {
          const x = p.x + dx
          const y = p.y + dy
          let url = urlTemplate
          if (hasSub && subdomains) {
            // 与 Leaflet 一样按坐标轮转子域名，避免都压到同一个子域
            url = url.replace('{s}', subdomains[Math.abs(x + y) % subdomains.length])
          }
          url = url
            .replace('{z}', String(z))
            .replace('{x}', String(x))
            .replace('{y}', String(y))
          const img = new Image()
          img.decoding = 'async'
          img.referrerPolicy = 'no-referrer'
          img.src = url
        }
      }
    }

    // 让首屏瓦片先发请求，别跟首屏抢带宽
    const timer = window.setTimeout(preload, 600)
    return () => window.clearTimeout(timer)
  }, [map, urlTemplate, subdomains, maxZoom])

  return null
}
