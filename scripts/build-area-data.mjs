/**
 * 由 npm 包 `china-area-data` 生成前端的省-市-区县三级嵌套 JSON。
 *
 * 运行： npm run gen:area
 * 产物： src/data/china-area.json
 *
 * 为什么生成而不是运行时读包：
 *   1. 包内 data.json 是「代码 -> 子级字典」的扁平结构，体积 116KB 且每次都要转换；
 *   2. 生成物可被 tree-shake / 静态化，浏览器只加载一次；
 *   3. 生成过程中可以顺手做一致性校验（见文件末尾）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const src = resolve(root, 'node_modules/china-area-data/data.json')
if (!existsSync(src)) {
  console.error('找不到 node_modules/china-area-data/data.json，请先执行 npm install')
  process.exit(1)
}

/** @type {Record<string, Record<string, string>>} */
const flat = JSON.parse(readFileSync(src, 'utf8'))

const NATIONAL = '86'
const provinceMap = flat[NATIONAL]
if (!provinceMap) {
  console.error('data.json 结构异常：缺少国家级节点 "86"')
  process.exit(1)
}

/**
 * 直辖市在源数据里的市级节点名是占位符「市辖区」/「县」，
 * 直接暴露给用户会变成「北京市 / 市辖区 / 海淀区」这种荒谬路径。
 * 这里把直辖市塌缩成单一级：北京市 / 北京市 / 海淀区。
 * 重庆是特例：源数据拆成「市辖区」+「县」两个市级节点，需要合并。
 */
const MUNICIPALITIES = new Set(['110000', '120000', '310000', '500000'])

const provinces = []
let cityCount = 0
let districtCount = 0
let orphanCities = 0

for (const [pCode, pName] of Object.entries(provinceMap)) {
  const cityMap = flat[pCode] ?? {}
  let cities = []

  if (MUNICIPALITIES.has(pCode)) {
    const merged = []
    for (const cCode of Object.keys(cityMap)) {
      for (const [dCode, dName] of Object.entries(flat[cCode] ?? {})) {
        merged.push({ code: dCode, name: dName })
      }
    }
    cities = [{ code: `${pCode}00`, name: pName, districts: merged }]
  } else {
    for (const [cCode, cName] of Object.entries(cityMap)) {
      const districtMap = flat[cCode] ?? {}
      const districts = Object.entries(districtMap).map(([dCode, dName]) => ({
        code: dCode,
        name: dName,
      }))
      // 直筒子市（如东莞、中山、儋州）的下一级直接是街道/镇，
      // 仍按“区县”处理即可，级联体验一致。
      if (districts.length === 0) orphanCities++
      cities.push({ code: cCode, name: cName, districts })
    }
  }

  for (const c of cities) {
    cityCount++
    districtCount += c.districts.length
  }

  provinces.push({ code: pCode, name: pName, cities })
}

const out = {
  /** 生成来源，便于日后核对 */
  $source: 'china-area-data@5.0.1 (MIT)',
  $generated_by: 'scripts/build-area-data.mjs',
  provinces,
}

const outDir = resolve(root, 'src/data')
mkdirSync(outDir, { recursive: true })
const outFile = resolve(outDir, 'china-area.json')
writeFileSync(outFile, JSON.stringify(out), 'utf8')

console.log('✅ 已生成 src/data/china-area.json')
console.log(`   省级 ${provinces.length} / 市级 ${cityCount} / 区县级 ${districtCount}`)
console.log(`   无区县子级的市（直筒子市等）：${orphanCities}`)
console.log(`   文件大小：${(readFileSync(outFile).length / 1024).toFixed(1)} KB`)

/* ------------------------------------------------------------------ */
/* 一致性校验：mock 数据里的每个 省/市/区县 都必须能在级联里选到          */
/* ------------------------------------------------------------------ */

const { MOCK_SCHOOLS } = await import('../src/lib/mock-data.ts')

/** 建索引，同时兼容“市辖区”这类占位名 */
const provinceNames = new Set(provinces.map((p) => p.name))
const cityIndex = new Set()
const districtIndex = new Set()
for (const p of provinces) {
  for (const c of p.cities) {
    cityIndex.add(`${p.name}/${c.name}`)
    for (const d of c.districts) {
      districtIndex.add(`${p.name}/${c.name}/${d.name}`)
    }
  }
}

let bad = 0
const problems = []
for (const s of MOCK_SCHOOLS) {
  if (!provinceNames.has(s.province)) {
    problems.push(`省份不存在：${s.province}（${s.name}）`)
    bad++
    continue
  }
  if (!cityIndex.has(`${s.province}/${s.city}`)) {
    problems.push(`市不存在：${s.province}/${s.city}（${s.name}）`)
    bad++
    continue
  }
  if (!districtIndex.has(`${s.province}/${s.city}/${s.district}`)) {
    problems.push(`区县不存在：${s.province}/${s.city}/${s.district}（${s.name}）`)
    bad++
  }
}

if (bad === 0) {
  console.log(`✅ 校验通过：${MOCK_SCHOOLS.length} 所 mock 学校的省/市/区县均可在级联中选择`)
} else {
  console.log(`❌ 校验失败：${bad} 条 mock 学校无法被级联筛选命中`)
  for (const p of problems) console.log('   - ' + p)
  process.exitCode = 1
}
