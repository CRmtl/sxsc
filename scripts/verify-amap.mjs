/**
 * 高德定位逻辑自检。
 * 用法： node scripts/verify-amap.mjs
 *
 * 用**真实的** src/data/china-area.json 做省市区对齐断言，
 * 并用贴近高德真实返回的 fixture 覆盖已知的坑：
 *   · 空值返回 []（不是 ""）
 *   · 直辖市 province/city 同名
 *   · 省直辖县级市 city 可能为空
 *   · GCJ-02 → WGS-84 的往返一致性
 *
 * 不联网、不需要 AMAP_WEB_KEY —— 只测纯逻辑。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  amapStr,
  amapErrorMessage,
  buildResult,
  gcj02ToWgs84,
  matchArea,
  parseAmapGeocodes,
  parseAmapLocation,
  parseAmapPois,
  readStatus,
  wgs84ToGcj02,
} from '../src/lib/amap.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let pass = 0
let fail = 0
const failures = []
const check = (cond, label, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ok    ${label}${extra ? '  ' + extra : ''}`)
  } else {
    fail++
    failures.push(label)
    console.log(`  FAIL  ${label}${extra ? '  ' + extra : ''}`)
  }
}

/* ---------------- 真实省市区索引 ---------------- */
const area = JSON.parse(readFileSync(resolve(root, 'src/data/china-area.json'), 'utf8'))
const provinces = area.provinces.map((p) => p.name)
const citiesOf = (province) =>
  (area.provinces.find((p) => p.name === province)?.cities ?? []).map((c) => c.name)
const districtsOf = (province, city) =>
  (area.provinces
    .find((p) => p.name === province)
    ?.cities.find((c) => c.name === city)?.districts ?? []).map((d) => d.name)
/** 路由里实际使用的索引（带区县，用于省直辖县级市兜底） */
const index = { provinces, citiesOf, districtsOf }

console.log(`\n=== 0. 真实省市区数据 ===`)
check(provinces.length === 34, '省级 34 个', `n=${provinces.length}`)
check(citiesOf('四川省').includes('成都市'), '四川省包含成都市')

/* ---------------- 归一化 ---------------- */
console.log(`\n=== 1. 高德的「空值返回 []」坑 ===`)
check(amapStr([]) === '', '空数组 → 空串', JSON.stringify(amapStr([])))
check(amapStr(['成都市', 'x']) === '成都市', '数组取首项')
check(amapStr('  成都市  ') === '成都市', '去空白')
check(amapStr(110000) === '110000', '数字转字符串')
check(amapStr(undefined) === '' && amapStr(null) === '', 'null/undefined → 空串')

console.log(`\n=== 2. location 解析（"经度,纬度"） ===`)
check(parseAmapLocation('103.97,30.948')?.lng === 103.97, '解析经度')
check(parseAmapLocation('103.97,30.948')?.lat === 30.948, '解析纬度')
check(parseAmapLocation('') === null, '空串 → null')
check(parseAmapLocation('abc,def') === null, '非法值 → null')
check(parseAmapLocation([]) === null, '[] → null')

/* ---------------- 坐标转换 ---------------- */
console.log(`\n=== 3. GCJ-02 → WGS-84（不做这一步会偏 100~600 米） ===`)
{
  const wgsLng = 104.06
  const wgsLat = 30.63 // 成都一带
  const [gLng, gLat] = wgs84ToGcj02(wgsLng, wgsLat)
  const offset = Math.hypot(gLng - wgsLng, gLat - wgsLat) * 111000 // 粗算米
  check(offset > 100 && offset < 900, 'GCJ 与 WGS 的偏移量级正确', `约 ${offset.toFixed(0)} 米`)

  const [bLng, bLat] = gcj02ToWgs84(gLng, gLat)
  check(
    Math.abs(bLng - wgsLng) < 2e-5 && Math.abs(bLat - wgsLat) < 2e-5,
    '往返转换回到原点（误差 < 2e-5 度 ≈ 2 米）',
    `Δ=${((bLng - wgsLng).toFixed(7))},${(bLat - wgsLat).toFixed(7)}`,
  )
  const [oLng, oLat] = gcj02ToWgs84(139.7, 35.7) // 东京，境外
  check(oLng === 139.7 && oLat === 35.7, '境外坐标不做偏移')

  // 已转换的坐标必须与原始 GCJ 明显不同，否则说明转换没生效
  check(Math.abs(gLng - wgsLng) > 1e-3, '转换确实改变了经度')
}

/* ---------------- 响应解析 ---------------- */
console.log(`\n=== 4. POI 2.0 响应解析 ===`)
{
  // 贴近高德真实返回的结构
  const json = {
    status: '1',
    info: 'OK',
    infocode: '10000',
    count: '1',
    pois: [
      {
        id: 'B001C7xxxx',
        name: '西华大学',
        location: '103.970000,30.948000',
        type: '科教文化服务;学校;高等院校',
        typecode: '141201',
        pname: '四川省',
        cityname: '成都市',
        adname: '郫都区',
        address: '红光镇学院路',
        pcode: '510000',
        citycode: '028',
        adcode: '510124',
      },
    ],
  }
  const status = readStatus(json)
  check(status.ok && status.info === 'OK', 'status:"1" 判定为成功')
  const cands = parseAmapPois(json)
  check(cands.length === 1, '解析出 1 个候选')
  check(cands[0].province === '四川省' && cands[0].city === '成都市', '省/市解析正确', `${cands[0].province}/${cands[0].city}`)
  check(cands[0].district === '郫都区', '区县解析正确')
  check(cands[0].source === 'place', 'source 标记为 place')
  check(Math.abs(cands[0].lat - 30.948) < 0.01, '纬度已转换为 WGS-84（接近原值）', `${cands[0].lat.toFixed(5)}`)
  // 原始 GCJ 必须原样保留，且与转换后的 WGS 不同 —— 方向无关，
  // 因为偏移方向随经纬度变化（我一开始写成 gcjLat > lat，是错的）。
  check(
    Math.abs(cands[0].gcjLat - 30.948) < 1e-9 && Math.abs(cands[0].gcjLat - cands[0].lat) > 1e-4,
    '保留原始 GCJ 坐标用于排错，且与转换后的 WGS 确实不同',
    `gcj=${cands[0].gcjLat} wgs=${cands[0].lat.toFixed(5)}`,
  )

  check(readStatus({ status: '0', info: 'INVALID_USER_KEY' }).ok === false, 'status:"0" 判定为失败')
  check(parseAmapPois({ status: '1', pois: [] }).length === 0, '空 pois → 空数组')
  check(parseAmapPois({}).length === 0, '缺字段不抛异常')
  check(parseAmapPois({ pois: [{ name: 'x' }] }).length === 0, '缺 location 的 POI 被跳过')
}

console.log(`\n=== 5. 地理编码响应解析（city 可能是 []） ===`)
{
  const json = {
    status: '1',
    info: 'OK',
    count: '1',
    geocodes: [
      {
        formatted_address: '四川省成都市郫都区',
        province: '四川省',
        // 高德在部分场景下把 city 返回成空数组
        city: [],
        district: '郫都区',
        location: '103.970000,30.948000',
        level: '兴趣点',
      },
    ],
  }
  const cands = parseAmapGeocodes(json)
  check(cands.length === 1, '解析出 1 个候选')
  check(cands[0].city === '', 'city 为 [] 时归一化成空串（不炸、不变成 "[]"）', JSON.stringify(cands[0].city))
  check(cands[0].province === '四川省', 'province 正常')
  check(cands[0].source === 'geocode', 'source 标记为 geocode')
  check(parseAmapGeocodes({ geocodes: [{ province: 'x' }] }).length === 0, '缺 location 被跳过')
}

/* ---------------- 省市区对齐 ---------------- */
console.log(`\n=== 6. 省市区对齐到本地数据 ===`)
{
  const cases = [
    ['四川省', '成都市', '四川省', '成都市', '完全一致'],
    ['北京市', '北京市', '北京市', '北京市', '直辖市省市同名'],
    ['上海市', '上海市', '上海市', '上海市', '直辖市'],
    ['四川', '成都', '四川省', '成都市', '高德少写了后缀'],
    ['', '', '', '', '两者都空'],
    ['火星省', '环形山市', '', '', '完全不存在的行政区'],
  ]
  for (const [rp, rc, ep, ec, label] of cases) {
    const m = matchArea(rp, rc, index)
    check(m.province === ep && m.city === ec, `对齐：${label}`, `→ ${m.province || '(空)'}/${m.city || '(空)'}`)
  }

  // 省直辖县级市：高德常把 city 返回成 []，此时城市对不上，但省份必须对上
  const jiyuan = matchArea('河南省', '', index)
  check(jiyuan.province === '河南省', '省直辖县级市（city 为空）仍能对上省份', jiyuan.province)
  check(jiyuan.cityMatched === false, '城市未匹配时明确标记为未匹配（交给用户手选）')

  // 本地数据把济源市放在占位市「省直辖县级行政区划」下当区县。
  // 有了 districtsOf 兜底，高德返回「河南省 + 济源市」时应能自动对上。
  const hasJiyuanAsCity = citiesOf('河南省').includes('济源市')
  const jiyuanAsDistrict = districtsOf('河南省', '省直辖县级行政区划').includes('济源市')
  console.log(
    `  note  济源市：在城市列表=${hasJiyuanAsCity}，在「省直辖县级行政区划」的区县里=${jiyuanAsDistrict}`,
  )
  if (jiyuanAsDistrict) {
    const m = matchArea('河南省', '济源市', index)
    check(
      m.provinceMatched && m.cityMatched && m.city === '省直辖县级行政区划' && m.subCity === '济源市',
      '省直辖县级市被兜底匹配到占位市（不再要求用户手选）',
      `city=${m.city} subCity=${m.subCity}`,
    )
  }
  // 不带 districtsOf 的旧索引仍应优雅降级为「未匹配」，而不是抛异常
  const legacy = matchArea('河南省', '济源市', { provinces, citiesOf })
  check(
    legacy.provinceMatched === true && legacy.cityMatched === false,
    '未注入 districtsOf 时优雅降级（不抛异常、不误匹配）',
  )
}

/* ---------------- 候选挑选 ---------------- */
console.log(`\n=== 7. 从多个候选里挑最合适的 ===`)
{
  const make = (name, province, city) => ({
    name,
    province,
    city,
    district: '',
    lng: 104,
    lat: 30.6,
    gcjLng: 104.006,
    gcjLat: 30.602,
    address: '',
    source: 'place',
    type: '',
  })

  // 第一个候选对不上行政区划，第二个能对上 → 应选第二个
  const r1 = buildResult(
    [make('西华大学某某学院', '火星省', '环形山市'), make('西华大学', '四川省', '成都市')],
    index,
    '西华大学',
  )
  check(r1?.province === '四川省' && r1.city === '成都市', '优先选能对齐行政区的候选', `${r1?.province}/${r1?.city}`)

  // 名称精确匹配优先
  const r2 = buildResult(
    [make('西华大学应用技术学院', '四川省', '成都市'), make('西华大学', '四川省', '成都市')],
    index,
    '西华大学',
  )
  check(r2?.matchedName === '西华大学', '名称完全一致的候选优先', r2?.matchedName)

  check(buildResult([], index, 'x') === null, '无候选时返回 null')

  // 全部对不上时也要返回坐标（让用户手动改省市，而不是什么都没有）
  const r3 = buildResult([make('某大学', '火星省', '环形山市')], index, '某大学')
  check(r3 !== null && r3.provinceMatched === false && r3.lat === 30.6, '都对不上时仍返回经纬度')
}

/* ---------------- 错误信息 ---------------- */
console.log(`\n=== 8. 高德错误码中文化 ===`)
{
  const m1 = amapErrorMessage('USER_KEY_PLATFORM_MISMATCH', '10009')
  check(m1.includes('Web 服务'), '平台不匹配给出可操作的提示', m1.slice(0, 40) + '…')
  const m2 = amapErrorMessage('DAILY_QUERY_OVER_LIMIT', '10003')
  check(m2.includes('超限'), '配额超限有专门提示')
  const m3 = amapErrorMessage('SOMETHING_NEW', '99999')
  check(m3.includes('SOMETHING_NEW'), '未知错误码原样带出，便于排错')
}

console.log(
  fail === 0 ? `\n✅ 通过 ${pass} 项，高德定位纯逻辑自洽` : `\n❌ 通过 ${pass} 项，失败 ${fail} 项`,
)
if (fail > 0) {
  console.log('失败项：')
  for (const f of failures) console.log('  - ' + f)
}
process.exit(fail === 0 ? 0 : 1)
