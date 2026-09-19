/**
 * 太阳几何：赤纬 δ、时角 H、太阳直射点、晨昏线、晨昏蒙影。
 *
 * 算法：Astronomical Almanac / NOAA 简化低精度公式（只取中心差一阶项）。
 * 1900–2100 年间赤纬误差 < 0.02°，对应地面 < 2.5km，远优于任何地图缩放级别的像素精度。
 *
 * 关键点：晨昏线的“倾斜程度”由太阳赤纬 δ 决定，δ 随日期在 ±23.44° 之间变化，
 * 因此晨昏线随季节变化（夏至最斜、春分秋分近似沿经线），而不是简单随地球自转旋转。
 * 自转只让整条曲线沿经度方向平移（表现为直射点经度变化）。
 */

export const RAD = Math.PI / 180
export const DEG = 180 / Math.PI

/** Web Mercator(EPSG:3857) 能表达的纬度上限，用于夜半球多边形的收边 */
export const MERCATOR_MAX_LAT = 85.05112877980659

/** 归一到 [-180, 180) */
export function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180
}

/** 归一到 [0, 360) */
function normalize360(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** 儒略日（含小数天），Unix 纪元 1970-01-01T00:00Z = JD 2440587.5 */
export function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5
}

export interface SolarPosition {
  /** 自 J2000.0 起算的天数 */
  n: number
  /** 太阳赤纬 δ（度）—— 决定晨昏线倾角与极昼极夜范围 */
  declination: number
  /** 太阳平黄经（度） */
  meanLongitude: number
  /** 太阳平近点角（度） */
  meanAnomaly: number
  /** 太阳黄道经度（度，含中心差修正） */
  eclipticLongitude: number
  /** 黄赤交角 ε（度） */
  obliquity: number
  /** 太阳赤经 α（度） */
  rightAscension: number
  /** 格林尼治平恒星时 GMST（度） */
  gmst: number
  /** 太阳直射点纬度 = δ */
  subsolarLat: number
  /** 太阳直射点经度（度，东经为正） */
  subsolarLng: number
  /** 时差 EoT（分钟）：视太阳时 − 平太阳时 */
  equationOfTime: number
}

/**
 * 计算给定时刻的太阳位置。
 * @param date 任意 Date；内部按 UTC 处理（Date.getTime() 本身就是 UTC 毫秒）
 */
export function getSolarPosition(date: Date): SolarPosition {
  const n = julianDay(date) - 2451545.0

  // 太阳平黄经 L 与平近点角 g
  const meanLongitude = normalize360(280.46 + 0.9856474 * n)
  const meanAnomaly = normalize360(357.528 + 0.9856003 * n)

  // 黄道经度 λ = L + 1.915° sin g + 0.020° sin 2g（中心差）
  const eclipticLongitude = normalize360(
    meanLongitude + 1.915 * Math.sin(meanAnomaly * RAD) + 0.02 * Math.sin(2 * meanAnomaly * RAD),
  )

  // 黄赤交角 ε（缓慢减小）
  const obliquity = 23.439 - 0.0000004 * n

  // 赤纬 δ
  const declination =
    Math.asin(Math.sin(obliquity * RAD) * Math.sin(eclipticLongitude * RAD)) * DEG

  // 赤经 α
  const rightAscension = normalize360(
    Math.atan2(
      Math.cos(obliquity * RAD) * Math.sin(eclipticLongitude * RAD),
      Math.cos(eclipticLongitude * RAD),
    ) * DEG,
  )

  // 格林尼治平恒星时 GMST（度）
  const gmst = normalize360(280.46061837 + 360.98564736629 * n)

  // 太阳直射点：时角 H = 0 处 ⇒ 经度 = α − GMST
  const subsolarLng = normalizeLng(rightAscension - gmst)

  // 时差（分钟）：平黄经与赤经之差换算成时间
  let eot = meanLongitude - rightAscension
  eot = normalizeLng(eot)
  const equationOfTime = 4 * eot

  return {
    n,
    declination,
    meanLongitude,
    meanAnomaly,
    eclipticLongitude,
    obliquity,
    rightAscension,
    gmst,
    subsolarLat: declination,
    subsolarLng,
    equationOfTime,
  }
}

/**
 * 晨昏线上某经度对应的纬度。
 *
 * sin(alt) = sinφ sinδ + cosφ cosδ cosH，令 alt = 0 解出：
 *   tanφ = −cosH / tanδ  ⇒  φ = atan(−cosH / tanδ)
 *
 * 该闭式解天然落在 (−90°, 90°)，且 δ→0（春分/秋分）时退化为 ±90° 的
 * “沿经线”形态，正好是二分日晨昏线与经线重合的正确几何。
 */
export function terminatorLatitude(lng: number, s: SolarPosition): number {
  const H = (lng - s.subsolarLng) * RAD
  const tanDec = Math.tan(s.declination * RAD)
  // δ 恰好为 0 时 tanδ = 0，用极小量替代，避免 0/0 产生 NaN
  const safeTan = Math.abs(tanDec) < 1e-12 ? (tanDec >= 0 ? 1e-12 : -1e-12) : tanDec
  return Math.atan(-Math.cos(H) / safeTan) * DEG
}

/** 夜半球所在极点：δ ≥ 0（北半球夏）时南极处于极夜 */
export function darkPoleLat(s: SolarPosition): number {
  return s.declination >= 0 ? -MERCATOR_MAX_LAT : MERCATOR_MAX_LAT
}

/**
 * 夜半球多边形（[lat, lng] 数组，可直接交给 Leaflet）。
 *
 * 构造：沿经度 −180→180 采样晨昏线纬度，再借道“极夜极点”所在纬度收边。
 * 收边纬度取 Web Mercator 极限 ±85.0511°，因为 Mercator 本就无法表达 ±90°，
 * 而极冠区域必定是夜，视觉上完全等价，同时避免依赖 Leaflet 的纬度裁剪。
 */
export function nightPolygon(s: SolarPosition, stepDeg = 2): [number, number][] {
  const pole = darkPoleLat(s)
  const pts: [number, number][] = []
  for (let lng = -180; lng < 180; lng += stepDeg) {
    pts.push([terminatorLatitude(lng, s), lng])
  }
  pts.push([terminatorLatitude(180, s), 180])
  pts.push([pole, 180])
  pts.push([pole, -180])
  return pts
}

/** 晨昏线本身（只画曲线，不闭合） */
export function terminatorPath(s: SolarPosition, stepDeg = 1): [number, number][] {
  const pts: [number, number][] = []
  for (let lng = -180; lng <= 180; lng += stepDeg) {
    pts.push([terminatorLatitude(Math.min(lng, 180), s), Math.min(lng, 180)])
  }
  return pts
}

/**
 * 太阳高度角等值线（晨昏蒙影）。
 *
 * 高度角 a 的等值线，是“距直射点角距 ρ = 90° − a”的小圆
 * （a=90 ⇒ ρ=0；a=0 ⇒ ρ=90；a=−6 ⇒ ρ=96）：
 *   cosρ = sinφ sinδ + cosφ cosδ cosH = sin(a)
 * 形如 A sinφ + B cosφ = C（C = sin a），
 * 解得 φ = θ − ψ 与 φ = π − θ − ψ（θ = asin(C/R)，ψ = atan2(B,A)）。
 * 两个解里要挑“位于晨昏线背光一侧”的那个 —— 否则会在极区画出错误的支线。
 *
 * @param altitudeDeg 太阳高度角，0 为地平线，−6 民用蒙影，−12 航海蒙影，−18 天文蒙影
 * @returns 折线段数组（遇到无解经度会断开）
 */
export function twilightSegments(
  s: SolarPosition,
  altitudeDeg: number,
  stepDeg = 2,
): [number, number][][] {
  const poleSign = s.declination >= 0 ? -1 : 1
  // cos ρ = sin(a)，ρ = 90° − a
  const C = Math.sin(altitudeDeg * RAD)
  const A = Math.sin(s.declination * RAD)
  const cosDec = Math.cos(s.declination * RAD)

  const segments: [number, number][][] = []
  let cur: [number, number][] = []

  const flush = () => {
    if (cur.length > 1) segments.push(cur)
    cur = []
  }

  for (let lng = -180; lng <= 180; lng += stepDeg) {
    const L = Math.min(lng, 180)
    const H = (L - s.subsolarLng) * RAD
    const B = cosDec * Math.cos(H)
    const R = Math.hypot(A, B)

    let lat = NaN
    if (R > 1e-12 && Math.abs(C) <= R) {
      const theta = Math.asin(C / R)
      const psi = Math.atan2(B, A)
      const candidates = [(theta - psi) * DEG, (Math.PI - theta - psi) * DEG]
      const phiT = terminatorLatitude(L, s)
      const valid = candidates
        .filter((p) => p >= -90 && p <= 90)
        // 背光侧：δ≥0 时纬度须比晨昏线更低（更靠南极）
        .filter((p) => Math.sign(p - phiT) === poleSign)
      if (valid.length) {
        valid.sort((a, b) => Math.abs(a - phiT) - Math.abs(b - phiT))
        lat = valid[0]
      }
    }

    if (Number.isFinite(lat)) cur.push([lat, L])
    else flush()
  }
  flush()
  return segments
}

/** 指定地点的真实太阳高度角（度） */
export function solarAltitudeAt(lat: number, lng: number, date: Date): number {
  const s = getSolarPosition(date)
  const H = (lng - s.subsolarLng) * RAD
  const phi = lat * RAD
  const dec = s.declination * RAD
  const sinAlt =
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) * DEG
}

/** 指定纬度的昼长（小时），自动处理极昼/极夜 */
export function dayLengthHours(lat: number, date: Date): number {
  const s = getSolarPosition(date)
  const cosH0 = -Math.tan(lat * RAD) * Math.tan(s.declination * RAD)
  if (cosH0 <= -1) return 24
  if (cosH0 >= 1) return 0
  return (2 * Math.acos(cosH0) * DEG) / 15
}

/** 极昼/极夜状态 */
export function polarState(
  lat: number,
  date: Date,
): 'none' | 'polar-day' | 'polar-night' {
  const h = dayLengthHours(lat, date)
  if (h >= 24) return 'polar-day'
  if (h <= 0) return 'polar-night'
  return 'none'
}

/** 该经度上的真太阳时正午对应的 UTC 小时（用于校核与展示） */
export function solarNoonUtcHours(lng: number, s: SolarPosition): number {
  const noon = 12 - lng / 15 - s.equationOfTime / 60
  return ((noon % 24) + 24) % 24
}

/** 太阳直射点 */
export function subsolarPoint(s: SolarPosition): { lat: number; lng: number } {
  return { lat: s.subsolarLat, lng: s.subsolarLng }
}
