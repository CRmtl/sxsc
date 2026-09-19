/**
 * GET /api/geocode?q=...&provider=nominatim|photon
 *
 * 地址搜索是**可选增强**，不是主路径：主路径始终是「地图拖拽选点」。
 * 因此这里的设计目标不是强大，而是**绝不能拖垮主流程**：
 *   - 服务端代理（绕过浏览器 CORS 与国内直连不稳的问题；
 *     部署在 Vercel 上时出口在境外，访问 Nominatim 反而更稳）
 *   - 5 分钟结果缓存 + 每 IP 1 秒 1 次的节流，遵守 Nominatim 使用政策
 *   - 8 秒超时；任何失败都返回可读提示，前端自动回退到手动选点
 */

import { fail, handleUnexpected, ipOf, ok } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

interface GeoResult {
  label: string
  lat: number
  lng: number
  provider: string
}

const CACHE_TTL_MS = 5 * 60 * 1000
const MIN_INTERVAL_MS = 1000

interface CacheEntry {
  at: number
  results: GeoResult[]
}

const globalForGeo = globalThis as unknown as {
  __zxssxscGeoCache?: Map<string, CacheEntry>
  __zxssxscGeoThrottle?: Map<string, number>
}
const cache = (globalForGeo.__zxssxscGeoCache ??= new Map())
const throttle = (globalForGeo.__zxssxscGeoThrottle ??= new Map())

/** 遵守 Nominatim 政策：必须带可识别的 User-Agent */
const USER_AGENT = 'zxssxsc/0.1 (school-hours map; contact: site-owner)'

async function searchNominatim(q: string): Promise<GeoResult[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', q)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '6')
  url.searchParams.set('accept-language', 'zh-CN')
  url.searchParams.set('countrycodes', 'cn')

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Nominatim 返回 ${res.status}`)
  const json = (await res.json()) as Array<{
    display_name?: string
    lat?: string
    lon?: string
  }>
  return json
    .map((item) => ({
      label: item.display_name ?? '',
      lat: Number(item.lat),
      lng: Number(item.lon),
      provider: 'nominatim',
    }))
    .filter((r) => r.label && Number.isFinite(r.lat) && Number.isFinite(r.lng))
}

async function searchPhoton(q: string): Promise<GeoResult[]> {
  const url = new URL('https://photon.komoot.io/api/')
  url.searchParams.set('q', q)
  url.searchParams.set('limit', '6')
  url.searchParams.set('lang', 'zh')

  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Photon 返回 ${res.status}`)
  const json = (await res.json()) as {
    features?: Array<{
      properties?: Record<string, unknown>
      geometry?: { coordinates?: [number, number] }
    }>
  }
  return (json.features ?? [])
    .map((f) => {
      const p = f.properties ?? {}
      const coords = f.geometry?.coordinates ?? [NaN, NaN]
      const parts = [p.name, p.city, p.state, p.country].filter(
        (x): x is string => typeof x === 'string' && x.length > 0,
      )
      return {
        label: parts.join(' · '),
        lat: coords[1],
        lng: coords[0],
        provider: 'photon',
      }
    })
    .filter((r) => r.label && Number.isFinite(r.lat) && Number.isFinite(r.lng))
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const q = (url.searchParams.get('q') ?? '').trim()
    const provider = url.searchParams.get('provider') === 'photon' ? 'photon' : 'nominatim'

    if (q.length < 2) {
      return fail('请输入至少 2 个字的地址关键词', 400, 'too_short', 'q')
    }
    if (q.length > 120) {
      return fail('地址关键词过长', 400, 'too_long', 'q')
    }

    const cacheKey = `${provider}:${q.toLowerCase()}`
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return ok({ results: cached.results, cached: true, provider })
    }

    // 每 IP 节流，避免把上游服务打爆（Nominatim 要求 ≤ 1 req/s）
    const ip = ipOf(request)
    const last = throttle.get(ip) ?? 0
    const waitMs = MIN_INTERVAL_MS - (Date.now() - last)
    if (waitMs > 0) {
      return fail(
        `地址搜索请求过快，请 ${Math.ceil(waitMs / 1000)} 秒后再试。也可以直接在地图上拖动选点。`,
        429,
        'throttled',
      )
    }
    throttle.set(ip, Date.now())

    let results: GeoResult[]
    try {
      results = provider === 'photon' ? await searchPhoton(q) : await searchNominatim(q)
    } catch (err) {
      console.warn('[geocode] upstream failed:', err)
      return fail(
        '地址搜索服务暂时不可用（该服务在境内访问可能不稳定）。请直接在地图上拖动选点来确定位置。',
        503,
        'upstream_unavailable',
      )
    }

    cache.set(cacheKey, { at: Date.now(), results })
    // 控制缓存规模
    if (cache.size > 500) {
      const cutoff = Date.now() - CACHE_TTL_MS
      for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k)
    }

    return ok({ results, cached: false, provider })
  } catch (err) {
    return handleUnexpected('GET /api/geocode', err)
  }
}
