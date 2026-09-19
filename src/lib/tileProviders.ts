/**
 * 底图瓦片源配置 + 自动测速选源。
 *
 * 硬性要求：默认与备选都必须是**国内可访问的 OSM 镜像**，
 * 禁止把官方 `tile.openstreetmap.org` 作为默认值（国内会大面积加载失败）。
 * 官方源保留为 `osm`，但标记 selectable=false，仅用于对比排查。
 *
 * 关于「为瓦片请求设置 Cache-Control」：这件事**我们做不到，也不需要做**。
 * 实测三个镜像的上游响应头已经带了正确的长缓存：
 *   hot   -> cache-control: max-age=93356
 *   osmfr -> cache-control: max-age=45474
 *   de    -> cache-control: max-age=269708
 * 而且都返回 access-control-allow-origin: *，
 * 配合 Leaflet 的 crossOrigin:true，浏览器缓存能正常命中。
 * 我们唯一能做且该做的是：不要用 cache-busting 参数破坏它。
 *
 * 署名：OSM 数据采用 ODbL 许可，必须保留 “© OpenStreetMap contributors”。
 */

export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'

export const OSM_HOT_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors, Tiles style by <a href="https://www.hotosm.org/" target="_blank" rel="noreferrer">HOT</a>'

export interface TileProvider {
  id: string
  /** UI 显示名 */
  label: string
  /** Leaflet urlTemplate */
  url: string
  subdomains?: string
  /** 用户可缩放到的最大级别 */
  maxZoom: number
  /**
   * 该镜像真正提供瓦片的最大级别。
   * 只有 maxNativeZoom < maxZoom 时才有意义：超出部分由 Leaflet 放大低级别瓦片，
   * 从而**避免请求一定会 404 的瓦片**（天地图就是这种情况）。
   */
  maxNativeZoom: number
  attribution: string
  /** 是否可作为默认底图 */
  selectable: boolean
  /** 需要 API Key */
  requiresKey?: 'tianditu'
  /** 是否参与自动测速 */
  speedTest: boolean
  /** UI 说明 */
  note: string
}

/**
 * 只收录**实测可用**的镜像。
 *
 * 以下候选均已实测并被排除，不要再加回来：
 *   tile.openstreetmap.bzh   → fetch failed（死链）
 *   osm.nixqz.com            → fetch failed（死链）
 *   maps.wikimedia.org       → fetch failed
 *   a.basemaps.cartocdn.com  → fetch failed
 *   tile.openstreetmap.jp    → 9386ms（慢一个数量级，反而拖慢首屏）
 *   tile.osm.ch              → 200 但无 access-control-allow-origin，会破坏 crossOrigin 缓存
 *   tiles.openfreemap.org    → 该路径不是栅格瓦片（0 字节）
 */
export const TILE_PROVIDERS: Record<string, TileProvider> = {
  hot: {
    id: 'hot',
    label: 'OSM 人道主义风格（fr 镜像·高对比）',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 19,
    maxNativeZoom: 19,
    attribution: OSM_HOT_ATTRIBUTION,
    selectable: true,
    speedTest: true,
    note: '基于 OSM 数据、专为人道救援优化的高对比风格，正常浏览下清晰度最高。',
  },
  osmfr: {
    id: 'osmfr',
    label: 'OSM 标准风格（fr 镜像·最省流量）',
    url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 19,
    maxNativeZoom: 19,
    attribution: OSM_ATTRIBUTION,
    selectable: true,
    speedTest: true,
    note: '标准 OSM 配色，实测响应最快；道路与地名密度低于 HOT 风格。',
  },
  de: {
    id: 'de',
    label: 'OSM 德国镜像（缓存时间最长）',
    url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    maxZoom: 19,
    maxNativeZoom: 19,
    attribution: OSM_ATTRIBUTION,
    selectable: true,
    speedTest: true,
    note: '德国 OSM 社区镜像，无子域名。上游缓存时间最长（max-age≈270000s）。',
  },
  tian: {
    id: 'tian',
    label: '天地图（国内最稳·需 Key）',
    url: 'https://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk={key}',
    subdomains: '01234567',
    maxZoom: 19,
    // 天地图 vec_w 只到 18 级；允许用户缩放到 19，超出部分放大 18 级瓦片，
    // 否则 z19 的请求全部 404，看起来就是「地图加载失败」。
    maxNativeZoom: 18,
    attribution:
      '&copy; <a href="https://www.tianditu.gov.cn/" target="_blank" rel="noreferrer">天地图</a> · GS(2023)336号',
    selectable: true,
    requiresKey: 'tianditu',
    speedTest: false,
    note: '需在 console.tianditu.gov.cn 免费申请 Key。CGCS2000 坐标系，与 OSM 叠加无偏移。',
  },
  osm: {
    id: 'osm',
    label: 'OSM 官方源（国内会失败·仅调试）',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    maxNativeZoom: 19,
    attribution: OSM_ATTRIBUTION,
    selectable: false,
    speedTest: false,
    note: '官方瓦片服务器在国内基本不可达，且禁止高频抓取。仅用于排查对比，不要用于生产。',
  },
}

/** 「自动」伪源：先按 hot 渲染，测速完成后替换为最快的镜像 */
export const AUTO_TILE_PROVIDER_ID = 'auto'

/** 参与自动测速的镜像（仅实测可用的 OSM 源） */
export const SPEED_TEST_CANDIDATES: string[] = Object.values(TILE_PROVIDERS)
  .filter((p) => p.speedTest)
  .map((p) => p.id)

/**
 * 环境变量指定的底图 id，非法值回退到 auto。
 * 默认 auto：让浏览器在真实网络位置测速后自己选，而不是替用户猜。
 */
export const DEFAULT_TILE_PROVIDER_ID: string = (() => {
  const fromEnv = process.env.NEXT_PUBLIC_TILE_PROVIDER?.trim()
  if (!fromEnv) return AUTO_TILE_PROVIDER_ID
  if (fromEnv === AUTO_TILE_PROVIDER_ID) return AUTO_TILE_PROVIDER_ID
  if (TILE_PROVIDERS[fromEnv]?.selectable) return fromEnv
  return AUTO_TILE_PROVIDER_ID
})()

export interface ResolvedTileProvider extends TileProvider {
  /** 已把 {key} 替换过的最终 url */
  resolvedUrl: string
  /** 缺少必要 Key 时为 true，调用方应回退到 hot */
  missingKey: boolean
}

/**
 * 解析出当前应使用的瓦片源（含 {key} 替换、缺 Key 回退、auto 回退到 hot）。
 * 注意 auto 在这里只是**首屏占位**，真正的选源由 useTileProvider 在客户端测速后决定。
 */
export function resolveTileProvider(id: string = DEFAULT_TILE_PROVIDER_ID): ResolvedTileProvider {
  const wanted = id === AUTO_TILE_PROVIDER_ID ? 'hot' : id
  const provider = TILE_PROVIDERS[wanted] ?? TILE_PROVIDERS.hot
  let resolvedUrl = provider.url

  if (provider.requiresKey === 'tianditu') {
    const key = process.env.NEXT_PUBLIC_TIANDITU_KEY?.trim() ?? ''
    if (!key) {
      return { ...TILE_PROVIDERS.hot, resolvedUrl: TILE_PROVIDERS.hot.url, missingKey: true }
    }
    resolvedUrl = resolvedUrl.replace('{key}', encodeURIComponent(key))
  }

  return { ...provider, resolvedUrl, missingKey: false }
}

/** 可在 UI 中切换的底图列表（含「自动」项） */
export function selectableTileProviders(): TileProvider[] {
  return Object.values(TILE_PROVIDERS).filter((p) => p.selectable)
}

/**
 * 两个地图组件（主地图 / 表单选点）共用的 TileLayer 选项，
 * 抽成工厂函数而不是复制两遍，避免参数调优时两边漂移。
 */
export function tileLayerOptions(t: ResolvedTileProvider) {
  return {
    url: t.resolvedUrl,
    ...(t.subdomains ? { subdomains: t.subdomains } : {}),
    maxZoom: t.maxZoom,
    maxNativeZoom: t.maxNativeZoom,
    attribution: t.attribution,
    // 让瓦片以 CORS 方式请求：配合上游的 ACAO:*，浏览器 HTTP 缓存可正常命中，
    // 否则跨域图片会走 opaque 响应，缓存与 canvas 导出都受限。
    crossOrigin: true,
    // 平移/缩放期间攒一批再更新，减少移动网络下的无效瓦片请求。
    // 代价：拖动过程中新区域的瓦片要等松手才出现（桌面端更明显）。
    // 若觉得拖动时「发白」，把 updateWhenIdle 改成 false 即可。
    updateWhenIdle: true,
    updateWhenZooming: false,
    // 多保留 2 圈屏幕外的瓦片，小幅平移时无需重新请求
    keepBuffer: 2,
    // 这些镜像都不提供 @2x 瓦片，开启只会请求到 404
    detectRetina: false,
  }
}

/* ================================================================== */
/* 自动测速                                                            */
/* ================================================================== */

/** 覆盖中国大部的一块瓦片（z=4 时大致是华北/华中），只测这一张，轻量 */
export const SPEED_TEST_TILE = { z: 4, x: 12, y: 6 } as const

export interface MirrorSpeed {
  id: string
  /** 毫秒 */
  ms: number
}

function probeUrl(provider: TileProvider, sub: string | null): string {
  let url = provider.url
  if (sub !== null) url = url.replace('{s}', sub)
  return url
    .replace('{z}', String(SPEED_TEST_TILE.z))
    .replace('{x}', String(SPEED_TEST_TILE.x))
    .replace('{y}', String(SPEED_TEST_TILE.y))
}

/** 挑一个子域名即可，测速不需要把 a/b/c 都试一遍 */
function firstSubdomain(provider: TileProvider): string | null {
  return provider.subdomains ? provider.subdomains[0] : null
}

/**
 * 用 Image 测一张瓦片的往返耗时。
 *
 * 为什么用 Image 而不是 fetch：Image 加载完的瓦片会**进入浏览器 HTTP 缓存**，
 * 于是「赢家」的那张瓦片在真正初始化地图时是直接命中缓存的 ——
 * 测速顺带完成了首屏预热，比 fetch 只测量不缓存更划算。
 */
export function measureTileProvider(id: string, timeoutMs = 6000): Promise<MirrorSpeed | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  const provider = TILE_PROVIDERS[id]
  if (!provider?.selectable) return Promise.resolve(null)

  const url = probeUrl(provider, firstSubdomain(provider))

  return new Promise((resolve) => {
    const started = performance.now()
    let settled = false
    const img = new Image()
    // 不设 crossOrigin：这里只测速，不需要读取像素，避免额外的 CORS 预检失败影响计时
    img.decoding = 'async'
    img.referrerPolicy = 'no-referrer'

    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      img.onload = null
      img.onerror = null
      resolve(ok ? { id, ms: Math.round(performance.now() - started) } : null)
    }

    const timer = window.setTimeout(() => done(false), timeoutMs)
    img.onload = () => done(true)
    img.onerror = () => done(false)
    img.src = url
  })
}

/**
 * 并发测速所有候选镜像，按耗时升序返回可用的那些。
 * 并发而不是串行：串行测速的等待时间会叠加到首屏上，得不偿失。
 */
export async function measureTileProviders(
  ids: string[] = SPEED_TEST_CANDIDATES,
  timeoutMs = 6000,
): Promise<MirrorSpeed[]> {
  const results = await Promise.all(ids.map((id) => measureTileProvider(id, timeoutMs)))
  return results.filter((r): r is MirrorSpeed => r !== null).sort((a, b) => a.ms - b.ms)
}
