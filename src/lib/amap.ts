/**
 * 高德 Web 服务 API 客户端 + 解析 + 省市区对齐。
 *
 * 这一层刻意做成**纯函数、不 import 任何项目模块**：
 * 省市区索引由调用方以 AreaIndex 注入（见 matchArea），
 * 于是 scripts/verify-amap.mjs 可以在 Node 里直接跑真实数据的断言，
 * 不需要 alias 解析、也不需要网络。
 *
 * ⚠️ 坐标系：高德所有接口返回的都是 **GCJ-02（火星坐标）**，
 * 而我们的底图是 OpenStreetMap（WGS-84）。直接用会有 100–600 米的
 * 系统性偏移 —— 在 z≥14 时肉眼可见，落在一所大学的另一侧都有可能。
 * 所以入库/填表前一律 gcj02ToWgs84() 转换。
 *
 * ⚠️ 高德的「空值」不是空字符串，而是**空数组 []**。
 * 这是它接口层的老毛病（city 在省直辖县级市、直辖市等场景常见）。
 * 所有取值都必须过 amapStr() 归一化，否则会得到 [] 而不是 ''。
 */

/* ------------------------------------------------------------------ */
/* 坐标转换：GCJ-02 <-> WGS-84                                          */
/* ------------------------------------------------------------------ */

const PI = Math.PI
const A = 6378245.0 // 克拉索夫斯基椭球长半轴
const EE = 0.00669342162296594323 // 偏心率平方

function outOfChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(lng: number, lat: number): number {
  let ret =
    -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng))
  ret += ((20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(lat * PI) + 40.0 * Math.sin((lat / 3.0) * PI)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((lat / 12.0) * PI) + 320 * Math.sin((lat * PI) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(lng: number, lat: number): number {
  let ret = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng))
  ret += ((20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(lng * PI) + 40.0 * Math.sin((lng / 3.0) * PI)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((lng / 12.0) * PI) + 300.0 * Math.sin((lng / 30.0) * PI)) * 2.0) / 3.0
  return ret
}

/** WGS-84 → GCJ-02（高德/腾讯用的偏移坐标） */
export function wgs84ToGcj02(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat]
  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI)
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI)
  return [lng + dLng, lat + dLat]
}

/**
 * GCJ-02 → WGS-84。
 *
 * 用「偏移量相减」的一步反解：误差约 1e-5 度（≈1 米），
 * 对「把一所大学标到地图上」这个用途绰绰有余；
 * 若要亚米级（测绘制图）需换成迭代反解。
 */
export function gcj02ToWgs84(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat]
  const [gLng, gLat] = wgs84ToGcj02(lng, lat)
  return [lng * 2 - gLng, lat * 2 - gLat]
}

/* ------------------------------------------------------------------ */
/* 取值归一化                                                          */
/* ------------------------------------------------------------------ */

/**
 * 高德把「空」返回成 [] 而不是 ""，有时还返回数字。
 * 统一成去空白的字符串。
 */
export function amapStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.length === 0 ? '' : amapStr(v[0])
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return String(v)
  return ''
}

/** 高德的 location 是 "经度,纬度" 字符串 */
export function parseAmapLocation(v: unknown): { lng: number; lat: number } | null {
  const s = amapStr(v)
  if (!s) return null
  const [lngRaw, latRaw] = s.split(',')
  const lng = Number(lngRaw)
  const lat = Number(latRaw)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  return { lng, lat }
}

/* ------------------------------------------------------------------ */
/* 响应解析                                                            */
/* ------------------------------------------------------------------ */

/** 高德接口的原始候选（已归一化，坐标已转 WGS-84） */
export interface AmapCandidate {
  /** 命中地点名 */
  name: string
  province: string
  city: string
  district: string
  /** 已转成 WGS-84，可直接给 Leaflet */
  lng: number
  lat: number
  /** 原始 GCJ-02，排错用 */
  gcjLng: number
  gcjLat: number
  /** 结构化地址描述 */
  address: string
  /** 来源接口，排错用 */
  source: 'place' | 'geocode'
  /** POI 类型（高德 typecode/type），排错用 */
  type: string
}

export interface AmapStatus {
  ok: boolean
  info: string
  infocode: string
}

/** 读高德的 status/info/infocode。成功时 status 是字符串 "1"。 */
export function readStatus(json: unknown): AmapStatus {
  const o = (json ?? {}) as Record<string, unknown>
  return {
    ok: amapStr(o.status) === '1',
    info: amapStr(o.info),
    infocode: amapStr(o.infocode),
  }
}

/** 解析 POI 2.0（v5/place/text）的响应 */
export function parseAmapPois(json: unknown): AmapCandidate[] {
  const o = (json ?? {}) as { pois?: unknown }
  const pois = Array.isArray(o.pois) ? o.pois : []
  const out: AmapCandidate[] = []
  for (const raw of pois) {
    const p = (raw ?? {}) as Record<string, unknown>
    const loc = parseAmapLocation(p.location)
    if (!loc) continue
    const [lng, lat] = gcj02ToWgs84(loc.lng, loc.lat)
    out.push({
      name: amapStr(p.name),
      province: amapStr(p.pname),
      city: amapStr(p.cityname),
      district: amapStr(p.adname),
      lng,
      lat,
      gcjLng: loc.lng,
      gcjLat: loc.lat,
      address: amapStr(p.address),
      source: 'place',
      type: amapStr(p.type) || amapStr(p.typecode),
    })
  }
  return out
}

/** 解析地理编码（v3/geocode/geo）的响应 */
export function parseAmapGeocodes(json: unknown): AmapCandidate[] {
  const o = (json ?? {}) as { geocodes?: unknown }
  const list = Array.isArray(o.geocodes) ? o.geocodes : []
  const out: AmapCandidate[] = []
  for (const raw of list) {
    const g = (raw ?? {}) as Record<string, unknown>
    const loc = parseAmapLocation(g.location)
    if (!loc) continue
    const [lng, lat] = gcj02ToWgs84(loc.lng, loc.lat)
    // 地理编码接口的 city 在省直辖县级市/直辖市场景常常是 []，
    // 这时用它返回的 adcode 也补不出城市名，交给 matchArea 的兜底逻辑处理。
    out.push({
      name: amapStr(g.formatted_address),
      province: amapStr(g.province),
      city: amapStr(g.city),
      district: amapStr(g.district),
      lng,
      lat,
      gcjLng: loc.lng,
      gcjLat: loc.lat,
      address: amapStr(g.formatted_address),
      source: 'geocode',
      type: amapStr(g.level),
    })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 省市区对齐                                                          */
/* ------------------------------------------------------------------ */

/** 由调用方注入本地省市区数据，避免本模块依赖 alias / JSON 导入 */
export interface AreaIndex {
  provinces: string[]
  citiesOf: (province: string) => string[]
  /**
   * 可选，用于**省直辖县级市**兜底。
   *
   * china-area-data 把济源、仙桃、潜江、天门、儋州、石河子这类
   * 「省/自治区直辖县级市」挂在占位市「省直辖县级行政区划」下面，当成**区县**。
   * 高德则会返回 province=河南省、city=济源市。
   * 没有这层兜底，用户就得手动去下拉里翻到那个占位名，体验很差。
   */
  districtsOf?: (province: string, city: string) => string[]
}

export interface AreaMatch {
  province: string
  city: string
  provinceMatched: boolean
  cityMatched: boolean
  /**
   * 当命中的是「省直辖县级市」时，这里放回真实市名（如「济源市」），
   * city 则是本地数据里的占位市名。前端可据此提示用户实际选了什么。
   */
  subCity?: string
}

/** 去掉行政区划后缀，用于「四川省」vs「四川」这类差异的兜底比对 */
function stripSuffix(name: string): string {
  return name
    .replace(
      /(壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|自治州|地区|林区|盟|省|市|县|区)$/,
      '',
    )
    .trim()
}

function findBest(raw: string, candidates: string[]): string | null {
  const target = raw.trim()
  if (!target) return null

  // 1) 完全一致
  const exact = candidates.find((c) => c === target)
  if (exact) return exact

  // 2) 去掉行政后缀后一致（「四川」→「四川省」）
  const strippedTarget = stripSuffix(target)
  if (strippedTarget) {
    const byStrip = candidates.find((c) => stripSuffix(c) === strippedTarget)
    if (byStrip) return byStrip
    // 3) 包含关系（高德偶尔多/少一个层级词）
    const byIncludes = candidates.find(
      (c) => c.includes(strippedTarget) || strippedTarget.includes(stripSuffix(c)),
    )
    if (byIncludes) return byIncludes
  }
  return null
}

/**
 * 把高德返回的省/市名对齐到本地省市区数据里真正存在的 value
 * （级联下拉框只认这些值，对不上就会 select 失败）。
 *
 * 对不上时按「未匹配」返回，由前端提示用户手动选择 —— 不猜。
 */
export function matchArea(rawProvince: string, rawCity: string, index: AreaIndex): AreaMatch {
  const province = findBest(rawProvince, index.provinces)
  if (!province) {
    return { province: '', city: '', provinceMatched: false, cityMatched: false }
  }

  const cities = index.citiesOf(province)

  // 1) 正常路径：市名能在本省城市列表里找到
  const direct = findBest(rawCity, cities)
  if (direct) {
    return { province, city: direct, provinceMatched: true, cityMatched: true }
  }

  // 2) 省直辖县级市兜底：高德给的「市」其实是本地某个占位市下的「区县」
  //    （如 河南省 + 济源市 → 河南省 + 省直辖县级行政区划）
  const target = rawCity.trim()
  if (target && index.districtsOf) {
    for (const c of cities) {
      const districts = index.districtsOf(province, c)
      if (districts.includes(target)) {
        return {
          province,
          city: c,
          provinceMatched: true,
          cityMatched: true,
          subCity: target,
        }
      }
    }
  }

  // 3) 直辖市 / 只有一个市的省：高德可能把 city 返回成 []
  if (cities.length === 1) {
    return { province, city: cities[0], provinceMatched: true, cityMatched: true }
  }

  // 4) 实在对不上就明确报告未匹配，由前端提示用户手选 —— 不猜
  return { province, city: '', provinceMatched: true, cityMatched: false }
}

/* ------------------------------------------------------------------ */
/* 错误信息中文化                                                      */
/* ------------------------------------------------------------------ */

const AMAP_ERROR_HINTS: Record<string, string> = {
  INVALID_USER_KEY: '高德 Key 无效或未启用「Web 服务」类型',
  INVALID_USER_SCODE: '高德 Key 的签名校验失败',
  USER_KEY_PLATFORM_MISMATCH:
    '这个 Key 的类型不是「Web 服务」。请在控制台新建一个「Web服务」类型的 Key（JS API 的 Key 不能用于服务端调用）',
  SERVICE_NOT_AVAILABLE: '高德服务暂不可用，请稍后重试',
  DAILY_QUERY_OVER_LIMIT: '高德 Key 当日调用量已超限',
  OVER_QUOTA: '高德 Key 调用量已超限',
  INSUFFICIENT_PRIVILEGES: '该高德 Key 无权调用此接口（可能需要认证或个人开发者权限不足）',
  INVALID_PARAMS: '请求参数不合法',
  ENGINE_RESPONSE_DATA_ERROR: '高德返回数据异常',
  CUQPS_HAS_EXCEEDED_THE_LIMIT: '高德接口并发超限，请降低频率',
  USERKEY_PLAT_NOMATCH: '高德 Key 与调用平台不匹配，需使用「Web服务」类型的 Key',
}

/** 把高德的 info/infocode 转成给用户看的中文提示 */
export function amapErrorMessage(info: string, infocode: string): string {
  const hint = AMAP_ERROR_HINTS[info]
  if (hint) return `${hint}（${info}${infocode ? '/' + infocode : ''}）`
  if (info && info !== 'OK') return `高德接口返回错误：${info}${infocode ? '（' + infocode + '）' : ''}`
  return '高德接口返回了无法识别的内容'
}

/** 缺少 Key 时的统一提示（前端会原样展示） */
export const AMAP_KEY_MISSING_MESSAGE =
  '未配置 AMAP_WEB_KEY，无法自动定位。请在 .env.local 与 Vercel 环境变量中添加该变量（需为高德「Web服务」类型的 Key），或手动选择省市并在地图上选点。'

/* ------------------------------------------------------------------ */
/* 汇总：候选 + 对齐结果                                               */
/* ------------------------------------------------------------------ */

export interface UniversityGeoResult {
  /** 已对齐到本地数据的省/市（未匹配则为空串） */
  province: string
  city: string
  provinceMatched: boolean
  cityMatched: boolean
  /** 命中的是省直辖县级市时，这里放真实市名（如「济源市」） */
  subCity?: string
  /** 高德原始返回的省/市/区，用于在未匹配时告诉用户「高德说是这里」 */
  amapProvince: string
  amapCity: string
  amapDistrict: string
  /** WGS-84，可直接给 Leaflet / 入库 */
  lat: number
  lng: number
  /** 高德原始 GCJ-02，排错用 */
  gcjLat: number
  gcjLng: number
  /** 结构化地址，用于给用户确认 */
  address: string
  matchedName: string
  source: 'place' | 'geocode'
}

/** 从候选里挑最合适的，并与本地省市区对齐 */
export function buildResult(
  candidates: AmapCandidate[],
  index: AreaIndex,
  preferredName?: string,
): UniversityGeoResult | null {
  if (candidates.length === 0) return null

  // 优先选「能对齐到本地省市区」的候选；都对齐不上时退回第一个。
  // 这一步很重要：搜索「西华大学」可能同时命中郫都区主校区与某个独立学院，
  // 能对齐到本地行政区划的那个更可信。
  let best = candidates[0]
  let bestMatch = matchArea(best.province, best.city, index)
  if (!bestMatch.provinceMatched || !bestMatch.cityMatched) {
    for (const c of candidates.slice(1)) {
      const m = matchArea(c.province, c.city, index)
      if (m.provinceMatched && m.cityMatched) {
        best = c
        bestMatch = m
        break
      }
      if (!bestMatch.provinceMatched && m.provinceMatched) {
        best = c
        bestMatch = m
      }
    }
  }

  // 名称完全一致的候选优先（避免匹配到「西华大学XX学院」这类附属点）
  if (preferredName) {
    const exact = candidates.find((c) => c.name === preferredName)
    if (exact) {
      const m = matchArea(exact.province, exact.city, index)
      if (m.provinceMatched) {
        best = exact
        bestMatch = m
      }
    }
  }

  return {
    province: bestMatch.province,
    city: bestMatch.city,
    provinceMatched: bestMatch.provinceMatched,
    cityMatched: bestMatch.cityMatched,
    subCity: bestMatch.subCity,
    amapProvince: best.province,
    amapCity: best.city,
    amapDistrict: best.district,
    lat: best.lat,
    lng: best.lng,
    gcjLat: best.gcjLat,
    gcjLng: best.gcjLng,
    address: best.address || best.name,
    matchedName: best.name,
    source: best.source,
  }
}
