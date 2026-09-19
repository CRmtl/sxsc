/**
 * 晨昏线/太阳几何数值自检。
 * 运行： node scripts/verify-solar.mjs
 *
 * 判据不是“看起来对”，而是把算出来的纬度代回太阳高度角公式验证：
 *   晨昏线上的点 => 高度角 ≈ 0°
 *   蒙影线上的点 => 高度角 ≈ 目标值
 *   夜半球内所有点 => 高度角 ≤ 0°
 */
import {
  getSolarPosition,
  terminatorLatitude,
  nightPolygon,
  twilightSegments,
  solarAltitudeAt,
  dayLengthHours,
  polarState,
  normalizeLng,
} from '../src/lib/solar.ts'

let failures = 0
const ok = (cond, msg, extra = '') => {
  if (!cond) {
    failures++
    console.log(`  FAIL  ${msg} ${extra}`)
  } else {
    console.log(`  ok    ${msg} ${extra}`)
  }
}

const dates = [
  ['2024-03-20T12:00:00Z', 0, '春分'],
  ['2024-06-21T12:00:00Z', 23.44, '夏至'],
  ['2024-09-22T12:00:00Z', 0, '秋分'],
  ['2024-12-21T12:00:00Z', -23.44, '冬至'],
]

console.log('=== 1. 太阳赤纬 / 直射点 ===')
for (const [iso, expectedDec, label] of dates) {
  const d = new Date(iso)
  const s = getSolarPosition(d)
  ok(
    Math.abs(s.declination - expectedDec) < 0.4,
    `${label} 赤纬`,
    `δ=${s.declination.toFixed(3)}° 期望≈${expectedDec}°`,
  )
  ok(
    Math.abs(s.subsolarLng) < 5,
    `${label} 12:00Z 直射点经度应在 0° 附近`,
    `lng=${s.subsolarLng.toFixed(3)}°`,
  )
  const altAtSubsolar = solarAltitudeAt(s.subsolarLat, s.subsolarLng, d)
  ok(
    Math.abs(altAtSubsolar - 90) < 0.6,
    `${label} 直射点太阳高度角应为 90°`,
    `alt=${altAtSubsolar.toFixed(3)}°`,
  )
  const antiLng = normalizeLng(s.subsolarLng + 180)
  const altAtAnti = solarAltitudeAt(-s.subsolarLat, antiLng, d)
  ok(Math.abs(altAtAnti + 90) < 0.6, `${label} 对跖点应为 −90°`, `alt=${altAtAnti.toFixed(3)}°`)
}

console.log('\n=== 2. 晨昏线：把纬度代回高度角公式必须为 0 ===')
for (const [iso, , label] of dates) {
  const d = new Date(iso)
  const s = getSolarPosition(d)
  let maxErr = 0
  let nan = 0
  let outOfRange = 0
  for (let lng = -180; lng <= 180; lng += 1) {
    const lat = terminatorLatitude(lng, s)
    if (!Number.isFinite(lat)) nan++
    if (lat < -90 || lat > 90) outOfRange++
    const alt = solarAltitudeAt(lat, lng, d)
    maxErr = Math.max(maxErr, Math.abs(alt))
  }
  ok(nan === 0, `${label} 无 NaN`)
  ok(outOfRange === 0, `${label} 纬度均在 [−90,90]`)
  ok(maxErr < 0.05, `${label} 晨昏线高度角残差`, `max|alt|=${maxErr.toFixed(4)}°`)
}

console.log('\n=== 3. 晨昏线随季节变化（不只看自转） ===')
const summer = getSolarPosition(new Date('2024-06-21T00:00:00Z'))
const winter = getSolarPosition(new Date('2024-12-21T00:00:00Z'))
const eq = getSolarPosition(new Date('2024-03-20T00:00:00Z'))
// 取直射点所在经度上的晨昏线纬度（= 极昼边界），夏至应偏南、冬至应偏北
const sLat = terminatorLatitude(summer.subsolarLng, summer)
const wLat = terminatorLatitude(winter.subsolarLng, winter)
ok(sLat < -60, '夏至 直射经度上晨昏线应在南半球高纬', `lat=${sLat.toFixed(2)}°`)
ok(wLat > 60, '冬至 直射经度上晨昏线应在北半球高纬', `lat=${wLat.toFixed(2)}°`)
// 二分日应近似沿经线（晨昏线纬度接近 ±90）
const eLatDay = terminatorLatitude(eq.subsolarLng, eq)
const eLatNight = terminatorLatitude(normalizeLng(eq.subsolarLng + 180), eq)
ok(
  Math.abs(Math.abs(eLatDay) - 90) < 0.5 && Math.abs(Math.abs(eLatNight) - 90) < 0.5,
  '春分晨昏线近似沿经线（±90°）',
  `day=${eLatDay.toFixed(2)}° night=${eLatNight.toFixed(2)}°`,
)
// 夏至/冬至的晨昏线纬度曲线必须不同（证明季节项生效）
let diff = 0
for (let lng = -180; lng <= 180; lng += 5) {
  diff += Math.abs(terminatorLatitude(lng, summer) - terminatorLatitude(lng, winter))
}
ok(diff > 1000, '夏至与冬至晨昏线形态显著不同', `累计差=${diff.toFixed(0)}°`)

console.log('\n=== 4. 晨昏蒙影线（民用 −6° / 航海 −12°） ===')
for (const [iso, , label] of dates) {
  const d = new Date(iso)
  const s = getSolarPosition(d)
  for (const alt of [-6, -12]) {
    const segs = twilightSegments(s, alt)
    let maxErr = 0
    let pts = 0
    let badLat = 0
    for (const seg of segs) {
      for (const [lat, lng] of seg) {
        if (lat < -90 || lat > 90) badLat++
        maxErr = Math.max(maxErr, Math.abs(solarAltitudeAt(lat, lng, d) - alt))
        pts++
      }
    }
    ok(
      segs.length > 0 && pts > 50 && badLat === 0 && maxErr < 0.05,
      `${label} ${alt}° 蒙影线`,
      `段数=${segs.length} 点=${pts} max残差=${maxErr.toFixed(4)}°`,
    )
  }
}

console.log('\n=== 5. 夜半球多边形：所有顶点必须确实处于夜侧 ===')
for (const [iso, , label] of dates) {
  const d = new Date(iso)
  const s = getSolarPosition(d)
  const poly = nightPolygon(s, 2)
  let dayPts = 0
  let nan = 0
  for (const [lat, lng] of poly) {
    if (!Number.isFinite(lat)) nan++
    if (solarAltitudeAt(lat, lng, d) > 0.05) dayPts++
  }
  ok(nan === 0, `${label} 夜半球无 NaN`)
  ok(dayPts === 0, `${label} 夜半球顶点全部在夜侧`, `越界点=${dayPts}`)
  // 收边纬度必须是极夜一侧
  const last = poly[poly.length - 1]
  ok(
    (s.declination >= 0 && last[0] < 0) || (s.declination < 0 && last[0] > 0),
    `${label} 收边在极夜极点一侧`,
    `收边纬度=${last[0].toFixed(2)}°`,
  )
}

console.log('\n=== 6. 昼长 / 极昼极夜 ===')
const june = new Date('2024-06-21T12:00:00Z')
const dec = new Date('2024-12-21T12:00:00Z')
ok(Math.abs(dayLengthHours(0, june) - 12) < 0.05, '夏至赤道昼长≈12h', `${dayLengthHours(0, june).toFixed(3)}h`)
ok(dayLengthHours(40, june) > 14.5 && dayLengthHours(40, june) < 15.2, '夏至 40°N 昼长≈14.9h', `${dayLengthHours(40, june).toFixed(2)}h`)
ok(dayLengthHours(40, dec) < 9.5, '冬至 40°N 昼长≈9.3h', `${dayLengthHours(40, dec).toFixed(2)}h`)
ok(polarState(78, june) === 'polar-day', '夏至 78°N 极昼')
ok(polarState(78, dec) === 'polar-night', '冬至 78°N 极夜')
ok(polarState(78, new Date('2024-03-20T12:00:00Z')) === 'none', '春分 78°N 无极昼极夜')

console.log('\n=== 7. 曲线斜率：最大跳变应等于解析值 cot(δ) ===')
{
  // φ(H) = atan(−cosH / tanδ) ⇒ |dφ/dH|max = cot(δ)，出现在 H = ±90°
  // （即晨昏线与经线相切处）。这是解析结论，用它当断言比拍一个阈值强得多。
  const s = getSolarPosition(new Date('2024-06-21T03:17:00Z'))
  let maxJump = 0
  let prev = terminatorLatitude(-180, s)
  for (let lng = -179; lng <= 180; lng += 1) {
    const lat = terminatorLatitude(lng, s)
    maxJump = Math.max(maxJump, Math.abs(lat - prev))
    prev = lat
  }
  const expected = 1 / Math.tan(s.declination * (Math.PI / 180))
  ok(
    Math.abs(maxJump - expected) < 0.05,
    '最大斜率等于 cot(δ)',
    `实测=${maxJump.toFixed(4)}°/° 解析=${expected.toFixed(4)}°/°`,
  )
}

console.log('\n=== 8. 随时间推进：直射点西移 ===')
{
  const t0 = getSolarPosition(new Date('2024-06-21T00:00:00Z'))
  const t1 = getSolarPosition(new Date('2024-06-21T01:00:00Z'))
  const dLng = normalizeLng(t1.subsolarLng - t0.subsolarLng)
  ok(dLng < -14 && dLng > -16, '每小时直射点西移约 15°', `Δ=${dLng.toFixed(3)}°`)
  const dDec = t1.declination - t0.declination
  ok(Math.abs(dDec) < 0.01, '赤纬 1 小时内近似不变', `Δδ=${dDec.toFixed(5)}°`)
}

console.log(
  failures === 0
    ? '\n✅ 全部通过：太阳几何实现与天文公式自洽'
    : `\n❌ ${failures} 项失败`,
)
process.exit(failures === 0 ? 0 : 1)
