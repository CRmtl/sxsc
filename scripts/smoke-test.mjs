/**
 * 集成冒烟测试。
 *
 * 用法：
 *   1. 另开一个终端跑 `npm run dev`
 *   2. `node scripts/smoke-test.mjs`（或 `npm run smoke`）
 *   可选：`SMOKE_BASE=http://127.0.0.1:3000 node scripts/smoke-test.mjs`
 *
 * 它验证的不是“页面能打开”，而是**行为**：
 *   - 四个页面都能渲染，且渲染出的 HTML 里没有 SSR 崩溃痕迹
 *   - 三层匿名防护逐条真的生效（蜜罐 / 时间陷阱 / 敏感词 / IP 限流）
 *   - 新增 → 修改（版本 +1 + 快照）→ 回滚 的完整链路
 *   - 底图配置确实没有落在被封禁的官方源上
 *
 * 关键技巧：每个用例用不同的 `x-forwarded-for`，从而让 IP 限流彼此隔离，
 * 否则前面的用例会把配额吃光，导致后面的用例假失败。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  AUTO_TILE_PROVIDER_ID,
  DEFAULT_TILE_PROVIDER_ID,
  SPEED_TEST_CANDIDATES,
  TILE_PROVIDERS,
  resolveTileProvider,
  tileLayerOptions,
} from '../src/lib/tileProviders.ts'

/** 项目根目录，用于读取 tailwind.config.ts 等构建配置文件 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3100'

let pass = 0
let fail = 0
const failures = []

function check(cond, label, extra = '') {
  if (cond) {
    pass++
    console.log(`  ok    ${label}${extra ? '  ' + extra : ''}`)
  } else {
    fail++
    failures.push(label)
    console.log(`  FAIL  ${label}${extra ? '  ' + extra : ''}`)
  }
}

let ipCounter = 0
/**
 * 每次运行使用**随机 IP 段**。
 *
 * 这一点很关键：限流是 1 小时滑动窗口，而计数器活在 dev server 进程里。
 * 如果每次运行都生成同一串 IP，第二次运行时限流用例的 IP 已经被上一次跑脏了，
 * 第一个请求就直接 429，测试会假失败（我踩过这个坑）。
 */
const RUN_TAG = Math.floor(Math.random() * 250) + 1
const RUN_OFFSET = Math.floor(Math.random() * 200)
function nextIp() {
  ipCounter++
  const n = ipCounter + RUN_OFFSET
  return `10.${RUN_TAG}.${Math.floor(n / 250)}.${(n % 250) + 1}`
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' })
  const text = await res.text()
  return { status: res.status, text, res }
}

async function postJson(path, body, ip = nextIp()) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, json, res }
}

function validSchool(overrides = {}) {
  return {
    name: '冒烟测试中学',
    stage: 'senior',
    province: '河北省',
    city: '衡水市',
    district: '桃城区',
    address: '测试路 1 号',
    lat: 37.73,
    lng: 115.67,
    daily_hours: 11.5,
    weekly_days: 6,
    monthly_days: 26,
    boarding: true,
    schedule_json: {
      arrive_time: '07:10',
      leave_time: '21:30',
      boarding_schedule: { arrive_time: '06:50', leave_time: '22:00' },
      day_schedule: { arrive_time: '07:10', leave_time: '18:00' },
    },
    remark: '这是一个冒烟测试生成的记录，可安全删除。',
    website: '',
    form_loaded_at: Date.now() - 10_000,
    ...overrides,
  }
}

/* ================================================================== */

/*
 * 🛑 安全检查：冒烟测试会**真的写数据**，不允许在真实库上跑。
 *
 * 这是补一个真实事故的教训：这套测试会新增学校、改版本、回滚、提交校历。
 * 有一次 dev server 因为 .env.local 被改动而**热切换**到了 Supabase 模式
 * （Next dev 会监听 .env.local，不需要重启就会生效），
 * 结果测试数据被写进了生产库，而 anon 角色无权 DELETE，只能靠 SQL 手工清。
 *
 * 所以这里在写下第一个字节之前先验明模式，不是演示模式就直接退出。
 */
{
  let mode = null
  try {
    const res = await fetch(`${BASE}/api/meta`)
    if (res.ok) mode = (await res.json())?.data?.dataMode ?? null
  } catch {
    /* 服务没起来，后面的预热会报出更清楚的错 */
  }

  if (mode && mode !== 'mock' && process.env.SMOKE_ALLOW_WRITES !== '1') {
    console.error(`\n🛑 已中止：当前 dataMode = ${mode}，不是演示模式（mock）。\n`)
    console.error('   scripts/smoke-test.mjs 会真的新增/修改数据：')
    console.error('   新增学校、修改并回滚版本、提交大学校历……')
    console.error('   在连着真实数据库时运行，会把测试垃圾写进生产数据，')
    console.error('   而 anon 角色没有 DELETE 权限，只能再用 SQL 手工清理。\n')
    console.error('   怎么办：')
    console.error('   · 让服务跑演示模式：.env.local 里不要有 SUPABASE_URL / SUPABASE_ANON_KEY')
    console.error('     ⚠️ Next dev 会热监听 .env.local，改这个文件会立刻切换模式，不必重启。')
    console.error('   · 或指向一个可随便写的测试库，并显式确认后运行：')
    console.error('       SMOKE_ALLOW_WRITES=1 npm run smoke\n')
    process.exit(2)
  }
}

/**
 * 预热。
 *
 * Next dev 是**按需编译**的：首次访问某个路由时才编译它，而编译中的请求会失败。
 * 这会让「刚加完路由就跑测试」出现一次莫名其妙的失败（我踩过：
 * 新增校历详情页与回滚接口后第一次跑，rollback 相关断言全红，再跑就全绿）。
 * 先空跑一遍所有 GET 路由，把编译产物准备出来，测试才不会假失败。
 */
console.log('\n=== 预热：让 Next dev 先编译完各路由 ===')
{
  const paths = ['/', '/college-holiday', '/submit', '/submit?type=college', '/api/meta']

  // 动态路由要真实 id 才能预热
  const collegeList = await fetch(`${BASE}/api/college-holidays`)
    .then((r) => r.json())
    .catch(() => null)
  const cid = collegeList?.data?.holidays?.[0]?.id
  if (cid) paths.push(`/college-holiday/${cid}`, `/api/college-holidays/${cid}`)

  const schoolList = await fetch(`${BASE}/api/schools`)
    .then((r) => r.json())
    .catch(() => null)
  const sid = schoolList?.data?.schools?.[1]?.id
  if (sid) paths.push(`/school/${sid}`, `/api/schools/${sid}`)

  paths.push('/api/schools', '/api/college-holidays')

  let warmFailures = 0
  for (const p of paths) {
    try {
      const r = await fetch(`${BASE}${p}`)
      if (!r.ok) warmFailures++
      // 必须读掉 body，否则连接不会释放
      await r.text()
    } catch {
      warmFailures++
    }
  }
  console.log(
    warmFailures === 0
      ? `  ok    ${paths.length} 个路由已预热`
      : `  注意  ${warmFailures}/${paths.length} 个路由预热时失败（可能是首次编译，下面的用例会真实检验）`,
  )
}

console.log(`\n=== 0. 底图配置（多镜像 + 自动测速，且必须避开官方源） ===`)
{
  check(
    DEFAULT_TILE_PROVIDER_ID === AUTO_TILE_PROVIDER_ID,
    '默认底图策略是 auto（客户端测速选源）',
    `id=${DEFAULT_TILE_PROVIDER_ID}`,
  )
  check(
    SPEED_TEST_CANDIDATES.length >= 3,
    '参与测速的镜像不少于 3 个',
    SPEED_TEST_CANDIDATES.join(' / '),
  )
  check(
    SPEED_TEST_CANDIDATES.every(
      (id) => !TILE_PROVIDERS[id].url.includes('tile.openstreetmap.org'),
    ),
    '参与测速的镜像都不是官方源',
  )

  const resolved = resolveTileProvider()
  check(
    resolved.resolvedUrl.includes('tile.openstreetmap.fr/hot'),
    'auto 的首屏占位回退到 fr HOT 镜像',
    resolved.resolvedUrl,
  )
  check(
    !resolved.resolvedUrl.includes('tile.openstreetmap.org'),
    '默认瓦片 URL 不是官方源',
  )
  check(
    TILE_PROVIDERS.osm.selectable === false,
    '官方源被标记为不可选（仅调试）',
  )
  check(
    resolved.attribution.includes('OpenStreetMap'),
    '署名包含 OpenStreetMap',
    resolved.attribution.replace(/<[^>]+>/g, ''),
  )
  check(
    resolveTileProvider('de').resolvedUrl.includes('tile.openstreetmap.de'),
    '备选底图 openstreetmap.de 可用',
  )
  check(
    resolveTileProvider('osmfr').resolvedUrl.includes('tile.openstreetmap.fr/osmfr'),
    '备选底图 openstreetmap.fr/osmfr 可用',
  )
  const tianMissing = resolveTileProvider('tian')
  check(
    tianMissing.missingKey && tianMissing.resolvedUrl.includes('openstreetmap.fr'),
    '天地图缺 Key 时自动回退到 fr 镜像（而不是崩掉）',
  )

  // 按需加载 / 缓存相关的调优参数必须真的传给了 Leaflet
  const opts = tileLayerOptions(resolveTileProvider('hot'))
  check(opts.updateWhenIdle === true, 'updateWhenIdle=true')
  check(opts.updateWhenZooming === false, 'updateWhenZooming=false')
  check(opts.keepBuffer === 2, 'keepBuffer=2')
  check(opts.crossOrigin === true, 'crossOrigin=true（跨域请求才不会丢缓存）')
  check(
    typeof opts.maxNativeZoom === 'number' && opts.maxNativeZoom <= opts.maxZoom,
    'maxNativeZoom ≤ maxZoom',
    `native=${opts.maxNativeZoom} max=${opts.maxZoom}`,
  )
  // 注意断言的是**配置本身** TILE_PROVIDERS.tian，而不是 resolveTileProvider('tian')。
  // 后者在缺 Key 时会回退成 hot（maxNativeZoom=19），断言会假失败。
  const tian = TILE_PROVIDERS.tian
  check(
    tian.maxNativeZoom < tian.maxZoom,
    '天地图配置 maxNativeZoom(18) < maxZoom(19)，避免 z19 全部 404',
    `native=${tian.maxNativeZoom} max=${tian.maxZoom}`,
  )
}

console.log(`\n=== 0b. 构建配置自检（tailwind / postcss） ===`)
{
  /*
   * 这条守卫来自一次真实事故：
   * tailwind.config.ts 里原来写的是 plugins: [require('tailwindcss-animate')]，
   * 在某次 npm install 重算依赖树后，Tailwind 退回用 Node 原生 require() 加载该 .ts，
   * 而 Node 24 会把 .ts 当 ESM 执行 —— 模块内没有 require，直接
   * "ReferenceError: require is not defined"，整条 PostCSS → Tailwind 链崩掉，
   * 页面无法编译、dev server 直接退出。
   *
   * 直接在 Node 里 import 配置并检查插件是否解析成函数，
   * 是能立刻定位这类问题的最小检查，而且不依赖浏览器或 .next 产物。
   */
  let tailwindConfig = null
  let importError = null
  try {
    tailwindConfig = (await import('../tailwind.config.ts')).default
  } catch (err) {
    importError = err
  }

  check(!importError, 'tailwind.config.ts 能被独立加载', importError ? importError.message : '')
  if (tailwindConfig) {
    const plugins = tailwindConfig.plugins ?? []
    check(Array.isArray(plugins) && plugins.length >= 1, 'plugins 是非空数组', `n=${plugins.length}`)
    check(
      plugins.every((p) => typeof p === 'function' || typeof p?.handler === 'function'),
      'animate 插件已解析为真正的插件（说明用的不是 require）',
      plugins.map((p) => typeof p).join(','),
    )
    const kf = tailwindConfig.theme?.extend?.keyframes ?? {}
    check('accordion-down' in kf && 'accordion-up' in kf, 'accordion 关键帧已定义')
    check(
      'accordion-down' in (tailwindConfig.theme?.extend?.animation ?? {}),
      'accordion 动画工具类已定义',
    )
  }

  /*
   * 配置里再出现裸 require( 就直接判失败（Node 24 下会崩）。
   * 注意必须**先剥掉注释**再匹配 —— 上面那段解释性注释里就写着
   * require('tailwindcss-animate') 这几个字，不剥注释会把说明文字当成代码。
   */
  const stripComments = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const cfgSrc = stripComments(readFileSync(resolve(root, 'tailwind.config.ts'), 'utf8'))
  check(!/\brequire\s*\(/.test(cfgSrc), 'tailwind.config.ts 的代码中没有裸 require(（会被当 ESM 执行）')
  const postcssSrc = stripComments(readFileSync(resolve(root, 'postcss.config.mjs'), 'utf8'))
  check(!/\brequire\s*\(/.test(postcssSrc), 'postcss.config.mjs 的代码中没有裸 require(')
}

console.log(`\n=== 1. 页面渲染 ===`)
{
  const home = await get('/')
  check(home.status === 200, '首页 200', `status=${home.status}`)
  check(!/window is not defined|ReferenceError/.test(home.text), '首页无 SSR 崩溃痕迹')
  check(home.text.includes('衡水第一中学'), '首页 HTML 含学校数据')
  check(home.text.includes('OpenStreetMap contributors'), '首页含 OSM 署名')
  check(home.text.includes('短（&lt; 8h）') || home.text.includes('短（< 8h）'), '首页含图例（短档）')
  check(home.text.includes('演示数据'), 'mock 模式下显示「演示数据」徽标')

  /* ---------------- 常见问题区块 ---------------- */
  {
    const FAQ_QUESTIONS = [
      '这个网站是干什么的',
      '怎么搜索我所在的学校',
      '为什么要获取我的地理位置',
      '我是学生，发现学校数据不对',
      '为什么我提交的数据没有立刻显示',
      '地图上的颜色代表什么',
      '地图加载不出来怎么办',
      '大学生放假数据从哪来',
    ]
    check(home.text.includes('id="faq"'), '首页有 FAQ 锚点 id="faq"')
    check(home.text.includes('你需要知道的一切'), 'FAQ 标题已中文化')
    // 用 aria-expanded 计数，而不是 data-state。
    // Radix 会把 data-state 写在每个条目的 Item/Header/Trigger/Content
    // 四个元素上（8 项 = 32 个），拿它计数会得出 32 这种误导性结果；
    // aria-expanded 只出现在 Trigger 上，正好一项一个。
    const triggerCount = (home.text.match(/aria-expanded="false"/g) || []).length
    check(
      triggerCount === FAQ_QUESTIONS.length,
      `FAQ 有 ${FAQ_QUESTIONS.length} 个折叠项，且默认全部收起`,
      `n=${triggerCount}`,
    )
    const missing = FAQ_QUESTIONS.filter((q) => !home.text.includes(q))
    check(missing.length === 0, '8 个问题全部渲染', missing.length ? `缺：${missing.join('、')}` : '')
    check(!/Flowis|free trial|Contact Us|All You Need to Know/i.test(home.text), 'FAQ 未残留设计稿示例文案')
    check(!home.text.includes('fonts.googleapis.com'), '未引入国内不可达的 Google Fonts')
    check(
      home.text.includes('group-data-[state=open]:rotate-45'),
      '「+」的 rotate-45 绑定在展开状态上（不换图标）',
    )
    check(home.text.includes('animate-accordion-down'), '折叠动画用的是项目已有 keyframes')
    // 设计稿里的三个分类标签页按要求整块移除
    check(
      !home.text.includes('Payments') &&
        !home.text.includes('Support') &&
        !home.text.includes('All You Need to Know'),
      'Product / Support / Payments 标签页已移除',
    )
  }

  const college = await get('/college-holiday')
  check(college.status === 200, '大学放假页 200', `status=${college.status}`)
  check(!/window is not defined|ReferenceError/.test(college.text), '大学页无 SSR 崩溃痕迹')
  check(college.text.includes('哈尔滨工业大学'), '大学页含大学数据')
  check(college.text.includes('上传/修改校历'), '大学页有「上传/修改校历」入口')
  check(college.text.includes('winter_start') || college.text.includes('寒假'), '大学页含寒暑假字段')
  check(
    college.text.includes('id="faq"') && college.text.includes('你需要知道的一切'),
    '大学页也挂了 FAQ 区块（同一组件，非复制粘贴）',
  )

  // 随机标语：SSR 阶段必须渲染空内容（避免 hydration 不匹配），
  // 但容器本身要在，所以断言 aria-live 标记而不是文案
  check(
    home.text.includes('aria-live="polite"'),
    '顶栏存在随机标语容器（aria-live，SSR 为空串）',
  )
  check(
    !home.text.includes('适当的休息是必要的噢') && !home.text.includes('祝你好运'),
    'SSR 输出里不含标语正文（证明是客户端才随机，无 hydration 风险）',
  )

  const submit = await get('/submit')
  check(submit.status === 200, '上传页 200', `status=${submit.status}`)
  check(submit.text.includes('website'), '上传页含蜜罐字段')

  const collegeForm = await get('/submit?type=college')
  check(collegeForm.status === 200, '大学假期表单 200')
  check(collegeForm.text.includes('学年'), '大学假期表单含学年字段')

  const detail = await get('/school/mock-school-001')
  check(detail.status === 200, '学校详情页 200', `status=${detail.status}`)
  check(detail.text.includes('中国人民大学附属中学'), '详情页含学校名')

  const missing = await get('/school/__not_exist__')
  check(missing.status === 404, '不存在的学校返回 404', `status=${missing.status}`)
}

console.log(`\n=== 1b. HTML 中的 id 唯一性（刚批量补过 id，必须防重复） ===`)
{
  for (const path of ['/', '/college-holiday', '/submit', '/school/mock-school-001']) {
    const page = await get(path)
    const ids = [...page.text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
    const seen = new Map()
    for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1)
    const dupes = [...seen.entries()].filter(([, n]) => n > 1)
    check(
      dupes.length === 0,
      `${path} 没有重复 id`,
      dupes.length ? `重复：${dupes.map(([id, n]) => `${id}×${n}`).join(', ')}` : `共 ${ids.length} 个 id`,
    )
  }
}

console.log(`\n=== 1c. Logo / 站点名 / 大学自动定位接口 ===`)
{
  const home = await get('/')

  // Logo 里的四个字母按 2×2 网格排列（s x / s c）
  const letters = ['>s<', '>x<', '>c<']
  check(letters.every((l) => home.text.includes(l)), 'Logo 内含 s / x / c 字母')
  check(home.text.includes('grid-cols-2'), 'Logo 用两列网格排版')
  check(!home.text.includes('>zx<'), 'Logo 里不再有旧的 "zx"')

  // 站点名已改为中文
  check(home.text.includes('上学时长'), '站点名显示为「上学时长」')
  check(
    home.text.includes('<title>中学生上学时长与大学放假查询地图</title>'),
    '首页 title 不重复品牌词',
  )

  // 自动定位接口：有 Key 时走真实高德，无 Key 时必须返回可操作提示而不是 500
  const geo = await get('/api/geocode/university?name=%E8%A5%BF%E5%8D%8E%E5%A4%A7%E5%AD%A6')
  check(geo.status !== 500, '自动定位接口不会 500', `status=${geo.status}`)
  if (geo.status === 503) {
    const j = JSON.parse(geo.text)
    check(j?.code === 'amap_key_missing', '未配置 AMAP_WEB_KEY 时返回明确错误码', String(j?.code))
    check(
      /AMAP_WEB_KEY/.test(j?.error ?? ''),
      '错误信息告诉用户该配哪个环境变量',
      (j?.error ?? '').slice(0, 40) + '…',
    )
  } else {
    check(geo.status === 200, '已配置 AMAP_WEB_KEY，接口返回 200', `status=${geo.status}`)
    const j = JSON.parse(geo.text)
    check(typeof j?.data?.message === 'string', '返回了给用户看的中文提示')
    if (j?.data?.result) {
      const r = j.data.result
      check(
        Number.isFinite(r.lat) && Number.isFinite(r.lng),
        '返回了可用经纬度',
        `${r.lat?.toFixed?.(4)}, ${r.lng?.toFixed?.(4)}`,
      )
      check(
        r.lat > 3 && r.lat < 54 && r.lng > 73 && r.lng < 136,
        '坐标落在中国境内（说明 GCJ→WGS 转换后仍然合理）',
      )
    }
  }
}

console.log(`\n=== 1d. 高德 Key 的读取方式与环境体检 ===`)
{
  /*
   * 用户报告过「我明明配了 AMAP_WEB_KEY，页面却说未配置」。
   * 最常见的两种误配是：多写了 NEXT_PUBLIC_ 前缀、或写进了别的文件。
   * 这里做两条静态断言，把「正确读法」钉死，防止有人为了让它「看起来能跑」
   * 而改成 NEXT_PUBLIC_ —— 那会把 Key 暴露到浏览器，被人盗刷配额。
   */
  const geoRouteSrc = readFileSync(
    resolve(root, 'src/app/api/geocode/university/route.ts'),
    'utf8',
  )
  check(
    geoRouteSrc.includes('process.env.AMAP_WEB_KEY'),
    '路由内读取的是 process.env.AMAP_WEB_KEY',
  )
  check(
    !/NEXT_PUBLIC_AMAP/i.test(geoRouteSrc),
    '没有把 Key 写成 NEXT_PUBLIC_ 前缀（那会泄漏到浏览器）',
  )

  // 全项目都不该出现 NEXT_PUBLIC_AMAP（.env.example 里也只有说明文字）
  const allSrc = []
  const collect = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = resolve(dir, name)
      if (statSync(full).isDirectory()) collect(full)
      else if (/\.(ts|tsx)$/.test(name)) allSrc.push(readFileSync(full, 'utf8'))
    }
  }
  collect(resolve(root, 'src'))
  check(
    !allSrc.some((s) => /NEXT_PUBLIC_AMAP/i.test(s)),
    'src 全目录没有 NEXT_PUBLIC_AMAP',
  )

  const health = await get('/api/health/env')
  check(health.status === 200, 'GET /api/health/env 可用', `status=${health.status}`)
  const hj = JSON.parse(health.text)
  check(hj?.data?.amap?.expected === 'AMAP_WEB_KEY', '体检接口报告的期望变量名正确')
  check(
    Array.isArray(hj?.data?.amap?.hints) && hj.data.amap.hints.length > 0,
    '体检接口给出了下一步建议',
  )
  check(
    typeof hj?.data?.amap?.configured === 'boolean',
    '体检接口报告了 Key 是否可见',
    `configured=${hj?.data?.amap?.configured}`,
  )
  // 只报名字，绝不报值
  check(
    !/"(key|value|secret)"\s*:/i.test(health.text),
    '体检接口不返回任何变量值',
  )

  // 缺 Key 时的错误信息里要带上体检结论，用户不用再猜
  if (hj?.data?.amap?.configured === false) {
    const geo = await get('/api/geocode/university?name=%E6%B5%8B%E8%AF%95%E5%A4%A7%E5%AD%A6')
    const gj = JSON.parse(geo.text)
    check(
      /未配置 AMAP_WEB_KEY/.test(gj?.error ?? ''),
      '缺 Key 时提示里包含变量名',
    )
    check(
      /服务端|形似|重新部署|重启/.test(gj?.error ?? ''),
      '缺 Key 时提示里附带体检结论（而不是只说「未配置」）',
      (gj?.error ?? '').slice(-60),
    )
  } else {
    console.log('  note  已配置 AMAP_WEB_KEY，跳过「缺 Key 提示」相关断言')
  }
}

console.log(`\n=== 2. 第二层：敏感词过滤 ===`)
{
  const spam = await postJson('/api/schools', validSchool({ remark: '加微信 13800000000 免费领取资料' }))
  check(spam.status === 422, '命中广告词被拒（422）', `status=${spam.status}`)
  check(spam.json?.code === 'sensitive_word', '返回 code=sensitive_word', String(spam.json?.code))
  check(/敏感|不允许/.test(spam.json?.error ?? ''), '错误信息是可读中文', spam.json?.error ?? '')

  // 规避写法：插入符号 + 全角，必须仍被识别
  const evasive = await postJson('/api/schools', validSchool({ remark: '加＊微＊信　私聊' }))
  check(evasive.status === 422, '符号/全角规避写法仍被识别', `status=${evasive.status}`)

  const urlSpam = await postJson('/api/schools', validSchool({ remark: '详见 http://spam.example.com' }))
  check(urlSpam.status === 422, '含 URL 的广告被拒', `status=${urlSpam.status}`)

  // 反向用例：正常中文内容不能被误杀
  const normal = await postJson('/api/schools', validSchool({ remark: '学校提供国家助学贷款政策咨询。' }))
  check(normal.status === 201, '正常内容不被误杀（助学贷款）', `status=${normal.status}`)
}

console.log(`\n=== 3. 第三层 A：蜜罐 ===`)
{
  const r = await postJson('/api/schools', validSchool({ website: 'http://bot.example' }))
  check(r.status === 400, '蜜罐有值被拒（400）', `status=${r.status}`)
  check(r.json?.code === 'honeypot', '返回 code=honeypot', String(r.json?.code))
}

console.log(`\n=== 4. 第三层 B：时间陷阱 ===`)
{
  const r = await postJson('/api/schools', validSchool({ form_loaded_at: Date.now() }))
  check(r.status === 400, '提交过快被拒（400）', `status=${r.status}`)
  check(r.json?.code === 'too_fast', '返回 code=too_fast', String(r.json?.code))

  const r2 = await postJson('/api/schools', validSchool({ form_loaded_at: undefined }))
  check(r2.status === 400, '缺少时间戳被拒', `status=${r2.status}`)
}

console.log(`\n=== 5. 结构 / 行政区划校验 ===`)
{
  const badArea = await postJson(
    '/api/schools',
    validSchool({ province: '火星省', city: '环形山市', district: '陨石坑区' }),
  )
  check(badArea.status === 400, '伪造行政区划被拒', `status=${badArea.status}`)
  check(badArea.json?.code === 'invalid_area', '返回 code=invalid_area', String(badArea.json?.code))

  const badLat = await postJson('/api/schools', validSchool({ lat: 0, lng: 0 }))
  check(badLat.status === 400, '境外坐标（0,0）被拒', `status=${badLat.status}`)

  const badHours = await postJson('/api/schools', validSchool({ daily_hours: 30 }))
  check(badHours.status === 400, '每日时长 30h 被拒', `status=${badHours.status}`)

  const badTime = await postJson(
    '/api/schools',
    validSchool({ schedule_json: { arrive_time: '25:99', leave_time: null, boarding_schedule: null, day_schedule: null } }),
  )
  check(badTime.status === 400, '非法时间格式被拒', `status=${badTime.status}`)

  const shortName = await postJson('/api/schools', validSchool({ name: 'A' }))
  check(shortName.status === 400, '过短的学校名被拒', `status=${shortName.status}`)
}

console.log(`\n=== 6. 第三层 C：IP 限流（3 次/小时） ===`)
{
  const ip = nextIp()
  const codes = []
  for (let i = 0; i < 4; i++) {
    const r = await postJson('/api/schools', validSchool({ name: `限流测试中学 ${i}` }), ip)
    codes.push(r.status)
  }
  check(
    codes[0] === 201 && codes[1] === 201 && codes[2] === 201 && codes[3] === 429,
    '同一 IP 前 3 次通过、第 4 次 429',
    `codes=${codes.join(',')}`,
  )
}

console.log(`\n=== 7. 新增 → 修改（版本 + 快照） → 回滚 ===`)
{
  const created = await postJson('/api/schools', validSchool({ name: '版本链路测试中学' }))
  check(created.status === 201, '新增成功（201）', `status=${created.status}`)
  const school = created.json?.data?.school
  check(school?.version === 1, '新记录 version=1', `version=${school?.version}`)
  check(typeof school?.id === 'string' && school.id.length > 0, '返回了 id')

  if (school?.id) {
    const updated = await postJson(
      '/api/schools',
      validSchool({ id: school.id, name: '版本链路测试中学', daily_hours: 13.0 }),
    )
    check(updated.status === 200, '修改成功（200）', `status=${updated.status}`)
    const s2 = updated.json?.data?.school
    check(s2?.version === 2, 'version 递增到 2', `version=${s2?.version}`)
    check(s2?.daily_hours === 13, '修改已生效', `daily_hours=${s2?.daily_hours}`)
    check(updated.json?.data?.previousVersion === 1, '返回前一版版本号', String(updated.json?.data?.previousVersion))

    const detail = await get(`/api/schools/${school.id}`)
    const detailJson = JSON.parse(detail.text)
    check(detailJson?.data?.revisions?.length === 1, '保存了 1 条历史快照', `n=${detailJson?.data?.revisions?.length}`)
    const snap = detailJson?.data?.revisions?.[0]?.snapshot
    check(snap?.daily_hours === 11.5, '快照保留的是修改前的值', `快照 daily_hours=${snap?.daily_hours}`)

    const rolled = await postJson(`/api/schools/${school.id}/rollback`, { version: 1 })
    check(rolled.status === 200, '回滚成功（200）', `status=${rolled.status}`)
    const s3 = rolled.json?.data?.school
    check(s3?.daily_hours === 11.5, '回滚后恢复为 v1 的值', `daily_hours=${s3?.daily_hours}`)
    check(s3?.version === 3, '回滚后 version 继续递增到 3（不覆盖历史）', `version=${s3?.version}`)

    const after = await get(`/api/schools/${school.id}`)
    const afterJson = JSON.parse(after.text)
    check(
      afterJson?.data?.revisions?.length === 2,
      '回滚本身也留下了快照（共 2 条）',
      `n=${afterJson?.data?.revisions?.length}`,
    )
  }
}

console.log(`\n=== 8. 列表 / 元信息接口 ===`)
{
  const schools = await get('/api/schools')
  const json = JSON.parse(schools.text)
  check(schools.status === 200 && Array.isArray(json?.data?.schools), 'GET /api/schools 返回数组')
  check(json?.data?.count >= 60, '返回的学校数不少于 mock 的 60 所', `count=${json?.data?.count}`)

  const meta = await get('/api/meta')
  const mj = JSON.parse(meta.text)
  check(mj?.data?.dataMode === 'mock', '未配置 Supabase 时 dataMode=mock', String(mj?.data?.dataMode))
  check(mj?.data?.antiAbuse?.rateLimitPerHour === 3, '反滥用配置为 3 次/小时')
  check(Array.isArray(mj?.data?.tile?.providers) && mj.data.tile.providers.length >= 2, '返回可切换底图列表')

  const colleges = await get('/api/college-holidays')
  const cj = JSON.parse(colleges.text)
  check(cj?.data?.holidays?.length > 0, '大学校历接口有数据', `n=${cj?.data?.holidays?.length}`)
  check(cj?.data?.festivals?.length > 0, '节假日接口有数据', `n=${cj?.data?.festivals?.length}`)

  // 新数据模型是「一校一学年一行」宽表
  const sample = cj?.data?.holidays?.[0]
  check(
    sample && 'winter_start' in sample && 'summer_start' in sample && 'version' in sample,
    '校历字段已是宽表结构（winter_*/summer_*/version）',
    sample ? Object.keys(sample).filter((k) => k.includes('winter') || k.includes('summer')).join(',') : '无样本',
  )
  check(
    sample && !('holiday_type' in sample) && !('start_date' in sample),
    '旧字段（holiday_type/start_date）已彻底移除',
  )
  check(
    cj?.data?.holidays?.length >= 60,
    'mock 校历至少 60 行（30 所大学 × 2 学年）',
    `n=${cj?.data?.holidays?.length}`,
  )
  // 真正的模型不变量：一校一学年只能有一行。
  // 不写成 === 60，是因为冒烟测试自己会往 mock 存储里加数据，那样就不可重复运行了。
  const pairKeys = (cj?.data?.holidays ?? []).map(
    (h) => `${h.university_name}||${h.academic_year}`,
  )
  check(
    new Set(pairKeys).size === pairKeys.length,
    '不存在重复的 (大学, 学年) 组合',
    `${pairKeys.length} 行 / ${new Set(pairKeys).size} 个唯一组合`,
  )

  // 校历详情页（版本历史 + 回滚按钮的入口）
  const firstId = cj?.data?.holidays?.[0]?.id
  if (firstId) {
    const detail = await get(`/college-holiday/${firstId}`)
    check(detail.status === 200, '校历详情页 200', `status=${detail.status}`)
    check(!/window is not defined|ReferenceError/.test(detail.text), '校历详情页无 SSR 崩溃')
    check(detail.text.includes('版本历史'), '校历详情页含版本历史区块')
    check(detail.text.includes('回滚'), '校历详情页含回滚入口')
    check(detail.text.includes('寒假'), '校历详情页含寒假字段')
  }
  const missingDetail = await get('/college-holiday/__not_exist__')
  check(missingDetail.status === 404, '不存在的校历详情返回 404', `status=${missingDetail.status}`)
}

console.log(`\n=== 8b. 大学校历提交（新字段 + 幂等 + 校验） ===`)
{
  // 校名必须每次运行唯一：提交逻辑是按 (校名, 学年) 幂等的，
  // 若沿用固定名字，第二次运行就会走「修改」分支，新增用例会假失败。
  const TEST_UNI = `冒烟测试大学-${RUN_TAG}`
  const base = {
    university_name: TEST_UNI,
    province: '四川省',
    city: '成都市',
    lat: 30.95,
    lng: 103.97,
    academic_year: '2025-2026',
    winter_start: '2026-01-19',
    winter_end: '2026-02-27',
    summer_start: '2026-07-13',
    summer_end: '2026-08-30',
    source_url: 'https://example.edu.cn/calendar',
    note: '冒烟测试生成，可安全删除。',
    website: '',
    form_loaded_at: Date.now() - 10_000,
  }

  const created = await postJson('/api/college-holidays', base)
  check(created.status === 201, '新增校历成功（201）', `status=${created.status}`)
  check(created.json?.data?.holiday?.version === 1, '新记录 version=1')

  // 同一 (校名, 学年) 再提交一次：必须是「修改」而不是插入第二行
  const again = await postJson('/api/college-holidays', {
    ...base,
    winter_end: '2026-03-01',
  })
  check(again.status === 200, '重复导入同一学校同一学年 → 视为修改（200）', `status=${again.status}`)
  check(again.json?.data?.created === false, '返回值标明 created=false')
  check(again.json?.data?.holiday?.version === 2, 'version 递增到 2', `v=${again.json?.data?.holiday?.version}`)

  const list = JSON.parse((await get('/api/college-holidays')).text)
  const dupes = list.data.holidays.filter(
    (h) => h.university_name === TEST_UNI && h.academic_year === '2025-2026',
  )
  check(dupes.length === 1, '同一 (校名, 学年) 只存在一行', `n=${dupes.length}`)
  check(dupes[0]?.winter_end === '2026-03-01', '修改后的值已生效')

  /* ---------------- 校历版本历史与回滚 ---------------- */
  const holidayId = created.json?.data?.holiday?.id
  check(typeof holidayId === 'string' && holidayId.length > 0, '返回了校历 id')

  if (holidayId) {
    const one = JSON.parse((await get(`/api/college-holidays/${holidayId}`)).text)
    check(one?.data?.holiday?.id === holidayId, 'GET 单条校历可用')
    check(
      one?.data?.revisions?.length === 1,
      '修改后保存了 1 条历史快照',
      `n=${one?.data?.revisions?.length}`,
    )
    check(
      one?.data?.revisions?.[0]?.snapshot?.winter_end === '2026-02-27',
      '快照保留的是修改前的值',
      `快照 winter_end=${one?.data?.revisions?.[0]?.snapshot?.winter_end}`,
    )

    const rolled = await postJson(`/api/college-holidays/${holidayId}/rollback`, { version: 1 })
    check(rolled.status === 200, '校历回滚成功（200）', `status=${rolled.status}`)
    check(
      rolled.json?.data?.holiday?.winter_end === '2026-02-27',
      '回滚后恢复为 v1 的值',
      `winter_end=${rolled.json?.data?.holiday?.winter_end}`,
    )
    check(
      rolled.json?.data?.holiday?.version === 3,
      '回滚后 version 继续递增到 3（不覆盖历史）',
      `version=${rolled.json?.data?.holiday?.version}`,
    )

    const after = JSON.parse((await get(`/api/college-holidays/${holidayId}`)).text)
    check(
      after?.data?.revisions?.length === 2,
      '回滚本身也留下了快照（共 2 条）',
      `n=${after?.data?.revisions?.length}`,
    )

    const badVersion = await postJson(`/api/college-holidays/${holidayId}/rollback`, {
      version: 0,
    })
    check(badVersion.status === 400, '非法 version 被拒', `status=${badVersion.status}`)

    const missing = await get('/api/college-holidays/__not_exist__')
    check(missing.status === 404, '不存在的校历返回 404', `status=${missing.status}`)
  }

  // 校验拒绝路径
  const badYear = await postJson('/api/college-holidays', { ...base, academic_year: '2025' })
  check(badYear.status === 400, '学年格式错误被拒', `status=${badYear.status}`)

  const halfPair = await postJson('/api/college-holidays', {
    ...base,
    winter_start: '2026-01-19',
    winter_end: null,
  })
  check(halfPair.status === 400, '只填寒假开始被拒', `status=${halfPair.status}`)

  const noWindow = await postJson('/api/college-holidays', {
    ...base,
    winter_start: null,
    winter_end: null,
    summer_start: null,
    summer_end: null,
  })
  check(noWindow.status === 400, '两个假期都空被拒', `status=${noWindow.status}`)

  const reversed = await postJson('/api/college-holidays', {
    ...base,
    winter_start: '2026-03-01',
    winter_end: '2026-02-01',
  })
  check(reversed.status === 400, '寒假结束早于开始被拒', `status=${reversed.status}`)

  const badSource = await postJson('/api/college-holidays', {
    ...base,
    source_url: '教务处网站',
  })
  check(badSource.status === 400, '校历来源不是 URL 被拒', `status=${badSource.status}`)

  const spam = await postJson('/api/college-holidays', { ...base, note: '加微信领取资料' })
  check(spam.status === 422, '校历备注命中敏感词被拒（422）', `status=${spam.status}`)

  const honeypot = await postJson('/api/college-holidays', { ...base, website: 'http://bot' })
  check(honeypot.status === 400, '校历表单蜜罐生效', `status=${honeypot.status}`)
}

console.log(`\n=== 9. 搜索与筛选的纯函数行为 ===`)
{
  const { filterSchools, EMPTY_FILTER } = await import('../src/components/search-bar.tsx').catch(
    () => ({ filterSchools: null, EMPTY_FILTER: null }),
  )
  if (typeof filterSchools === 'function') {
    const { MOCK_SCHOOLS } = await import('../src/lib/mock-data.ts')
    const hebei = filterSchools(MOCK_SCHOOLS, {
      ...EMPTY_FILTER,
      province: '河北省',
    })
    check(hebei.length > 0 && hebei.every((s) => s.province === '河北省'), '按省筛选正确', `n=${hebei.length}`)
    const kw = filterSchools(MOCK_SCHOOLS, { ...EMPTY_FILTER, keyword: '衡水' })
    check(kw.some((s) => s.name.includes('衡水')), '按关键词模糊搜索命中', `n=${kw.length}`)
    const combo = filterSchools(MOCK_SCHOOLS, {
      ...EMPTY_FILTER,
      province: '河北省',
      city: '衡水市',
      district: '桃城区',
    })
    check(combo.length === 1, '省市区三级联动精确命中 1 所', `n=${combo.length}`)
  } else {
    console.log('  skip  search-bar 是 .tsx（含 JSX），Node 无法直接 import，已跳过')
  }
}

/* ================================================================== */

console.log(
  `\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} 项，失败 ${fail} 项`,
)
if (fail > 0) {
  console.log('失败项：')
  for (const f of failures) console.log('  - ' + f)
}
process.exit(fail === 0 ? 0 : 1)
