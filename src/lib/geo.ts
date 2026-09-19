/**
 * 地理计算与「上学时长」分档。
 */

import type { School } from './types'

/** Haversine 大圆距离（公里） */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371.0088 // 地球平均半径 km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** 中国大致范围（含港澳台），用于校验选点是否落在国内 */
export const CHINA_BBOX = {
  minLat: 3.0,
  maxLat: 54.0,
  minLng: 73.0,
  maxLng: 136.0,
}

/** 全国视图中心与缩放 */
export const CHINA_CENTER: [number, number] = [34.5, 105.0]
export const CHINA_ZOOM = 4

/** Leaflet maxBounds：略大于国界，避免用户拖到地球另一端 */
export const MAP_MAX_BOUNDS: [[number, number], [number, number]] = [
  [1.0, 68.0],
  [56.0, 141.0],
]

export function isInsideChina(lat: number, lng: number): boolean {
  return (
    lat >= CHINA_BBOX.minLat &&
    lat <= CHINA_BBOX.maxLat &&
    lng >= CHINA_BBOX.minLng &&
    lng <= CHINA_BBOX.maxLng
  )
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  )
}

/** 格式化距离 */
export function formatKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`
  if (km < 100) return `${km.toFixed(1)} km`
  return `${Math.round(km)} km`
}

/**
 * 在给定半径内筛选学校（Haversine），按距离升序。
 * 用于访客定位后的“附近学校”。
 */
export function filterNearbySchools(
  schools: School[],
  lat: number,
  lng: number,
  radiusKm = 80,
): { school: School; distanceKm: number }[] {
  return schools
    .map((school) => ({
      school,
      distanceKm: haversineKm(lat, lng, school.lat, school.lng),
    }))
    .filter((x) => x.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
}

/* ------------------------------------------------------------------ */
/* 上学时长分档                                                        */
/* ------------------------------------------------------------------ */

export type DurationBucket = 'short' | 'mid' | 'long'

export interface DurationBucketMeta {
  id: DurationBucket
  label: string
  color: string
  /** 包含下限（小时） */
  min: number
  /** 不包含上限（小时），Infinity 表示无上限 */
  max: number
  description: string
}

/**
 * 三档划分口径（可在 UI 图例中看到）：
 *   短：< 8 小时    —— 走读、无早晚自习
 *   中：8 ~ 11 小时 —— 多数初高中
 *   长：≥ 11 小时   —— 含早晚自习 / 半住宿 / 高强度
 */
export const DURATION_BUCKETS: DurationBucketMeta[] = [
  {
    id: 'short',
    label: '短（< 8h）',
    color: '#16a34a',
    min: 0,
    max: 8,
    description: '走读、无早读或晚自习，在校时间较短',
  },
  {
    id: 'mid',
    label: '中（8–11h）',
    color: '#f59e0b',
    min: 8,
    max: 11,
    description: '有早读或晚自习之一，多数初高中',
  },
  {
    id: 'long',
    label: '长（≥ 11h）',
    color: '#dc2626',
    min: 11,
    max: Infinity,
    description: '早读+晚自习+住宿，在校时间极长',
  },
]

export const DURATION_BUCKET_MAP: Record<DurationBucket, DurationBucketMeta> =
  Object.fromEntries(DURATION_BUCKETS.map((b) => [b.id, b])) as Record<
    DurationBucket,
    DurationBucketMeta
  >

export function durationBucket(dailyHours: number): DurationBucket {
  if (dailyHours < 8) return 'short'
  if (dailyHours < 11) return 'mid'
  return 'long'
}

export function durationColor(dailyHours: number): string {
  return DURATION_BUCKET_MAP[durationBucket(dailyHours)].color
}

/** 三档之间的连续插值色（短绿 → 中黄 → 长红），用于热力图与渐变图例 */
export function durationGradientColor(dailyHours: number): string {
  const stops: [number, [number, number, number]][] = [
    [6, [22, 163, 74]],
    [9.5, [245, 158, 11]],
    [13, [220, 38, 38]],
  ]
  const h = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], dailyHours))
  let i = 0
  while (i < stops.length - 2 && h > stops[i + 1][0]) i++
  const [h0, c0] = stops[i]
  const [h1, c1] = stops[i + 1]
  const t = (h - h0) / (h1 - h0)
  const mix = c0.map((c, k) => Math.round(c + (c1[k] - c) * t))
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`
}

/** 学校是否在某个省/市/区县筛选条件下 */
export function matchArea(
  school: Pick<School, 'province' | 'city' | 'district'>,
  province?: string | null,
  city?: string | null,
  district?: string | null,
): boolean {
  if (province && school.province !== province) return false
  if (city && school.city !== city) return false
  if (district && school.district !== district) return false
  return true
}

/** 学校名称模糊匹配（大小写不敏感、忽略空白） */
export function fuzzyMatchName(name: string, keyword: string): boolean {
  if (!keyword.trim()) return true
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
  return norm(name).includes(norm(keyword))
}
