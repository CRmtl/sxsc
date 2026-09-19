# zxssxsc

**中学生上学时长 + 大学生放假查询**的地图可视化网站。

在地图上直观呈现「一所学校每天要把学生留在校内多久」，叠加随时间与季节变化的
**动态晨昏线**，并支持匿名上传/修改数据；另有一个独立页面查询全国大学的寒暑假。

- 底图使用**国内可直连的 OpenStreetMap 镜像**（不使用官方源）
- 无需登录即可提交数据，提交后**直接生效**并保留**可回滚的版本历史**
- 未配置数据库时自动进入**演示模式**，clone 下来即可跑通全部功能

---

## 目录

- [快速开始](#快速开始)
- [环境变量清单](#环境变量清单)
- [技术选型说明](#技术选型说明)
- [文件结构](#文件结构)
- [四个页面](#四个页面)
- [核心实现说明](#核心实现说明)
- [地图加载性能与瓦片镜像](#地图加载性能与瓦片镜像)
- [大学校历抓取与录入](#大学校历抓取与录入)
- [接入 Supabase](#接入-supabase)
- [Vercel 部署](#vercel-部署)
- [自检脚本](#自检脚本)
- [我做的假设与需要你确认的点](#我做的假设与需要你确认的点)
- [已知限制](#已知限制)

---

## 快速开始

```bash
# 1. 安装依赖（Node.js >= 18，推荐 20/22）
npm install

# 2. 生成省市区数据（仅首次需要，产物已随仓库提供）
npm run gen:area

# 3. 启动
npm run dev
# 打开 http://localhost:3000
```

此时**不需要任何环境变量**：未配置 Supabase 会自动使用内置演示数据（60 所中学、
30 所大学、121 条假期记录），提交会写入服务器进程内存，新增 / 修改 / 回滚全链路都能走通。

其他命令：

```bash
npm run build       # 生产构建
npm run start       # 启动生产服务
npm run typecheck   # TypeScript 类型检查
npm run smoke       # 集成冒烟测试（需先跑 npm run dev）
npm run verify:solar  # 晨昏线天文算法数值自检
npm run check:tiles   # 底图镜像连通性实测
npm run sync:words    # 同步敏感词表到 Edge Function
```

> **演示模式的数据在进程重启后会丢失**，这是刻意的设计，用来避免把演示数据误当成真实数据。

---

## 环境变量清单

完整清单见 `.env.example`。**全部可以留空**，应用会优雅降级。

### Supabase（可选，留空即演示模式）

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SUPABASE_URL` | 否 | 项目 URL。留空则进入演示模式 |
| `SUPABASE_ANON_KEY` | 否 | anon key。**只用在服务端**，RLS 依然生效 |
| `SUPABASE_SERVICE_ROLE_KEY` | 否 | 绕过 RLS。仅用于写版本快照 + 跨实例限流；未配置则自动降级 |
| `NEXT_PUBLIC_SUPABASE_URL` 等 | 否 | 兼容旧写法，会被识别 |

> 注意：Supabase 凭据**不需要** `NEXT_PUBLIC_` 前缀。浏览器不直接持有凭据，
> 所有读写都经服务端 `/api/*` 路由完成 —— 否则三层反滥用可以被绕过。

### 地图底图

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_TILE_PROVIDER` | **`auto`** | `auto` / `hot` / `osmfr` / `de` / `tian` / `osm` |
| `NEXT_PUBLIC_TIANDITU_KEY` | 空 | 仅 `tian` 时需要；缺失时自动回退到 `hot` |

**`auto`（默认，推荐）**：浏览器并发测速下面 3 个镜像，选响应最快的那个。详见
[地图加载性能与瓦片镜像](#地图加载性能与瓦片镜像)。

| id | 瓦片地址 | 实测耗时 |
| --- | --- | --- |
| `hot` | `https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png` | 1008–1181ms |
| `osmfr` | `https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png` | **437–711ms** |
| `de` | `https://tile.openstreetmap.de/{z}/{x}/{y}.png` | 1208ms |
| `tian` | 天地图（需 Key，国内最稳） | — |
| `osm` | 官方 `tile.openstreetmap.org`，**默认禁用**，仅对比排查 | **fetch failed** |

> 想固定某个镜像（例如你确认本地 `de` 更快）就把这个变量设成对应 id。
> 实测已排除的死链见下方章节，不要加回来。

### 防滥用

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SUBMIT_RATE_LIMIT_PER_HOUR` | `3` | 同一 IP 每小时最多提交次数 |
| `SUBMIT_MIN_FILL_MS` | `3000` | 表单加载到提交的最短间隔，防时间陷阱 |
| `DISABLE_ANTI_ABUSE` | `0` | 设为 `1` 可整体关闭，**仅本地调试用** |
| `NEXT_PUBLIC_SITE_NAME` | `zxssxsc` | 顶栏站点名 |

---

## 技术选型说明

| 需求 | 实际采用 | 版本 | 为什么 |
| --- | --- | --- | --- |
| 前端框架 | Next.js App Router | `15.5.25` | 服务端组件直接读数据库，省掉一层 API；Route Handler 天然适合做防护层 |
| 语言 | TypeScript | `5.9.3` | 数据模型较复杂（`schedule_json`），类型约束价值高 |
| 样式 | Tailwind CSS | `3.4.19` | **刻意停留在 v3**：v4 改为 CSS-first 配置，shadcn/ui 生态与 `tailwind.config.ts` 写法尚未完全稳定，v3 更省心 |
| 组件 | shadcn/ui 模式 | — | 把组件源码复制进仓库（`src/components/ui/`），而非装一个 UI 库 |
| 地图 | Leaflet + react-leaflet | `1.9.4` / `5.0.0` | react-leaflet 5 要求 React 19，与 Next 15 匹配 |
| 聚合 | leaflet.markercluster | `1.5.3` | react-leaflet 无官方封装，用命令式 API 接入 |
| 热力图 | leaflet.heat | `0.2.0` | 同上；另需自备类型声明（`src/types/leaflet-heat.d.ts`） |
| 天文 | suncalc + 自研 `solar.ts` | `2.0.2` | 见下文「为什么晨昏线要自己算」 |
| 数据库 | Supabase | `@supabase/supabase-js` `2.116.0` | Postgres + 自动 API + RLS，RLS 正好承担第一层防护 |
| 省市区 | china-area-data | `5.0.1` | 本地内置，构建期生成 JSON，**不依赖外部 API** |
| 表单校验 | 自研（服务端 + 客户端同源） | — | 校验规则与数据库 `CHECK` 逐条对应，避免三处不一致 |

**其他工程决定：**

- **级联下拉用原生 `<select>`**，而不是 Radix Select。省/市/区县分别有 34 / 374 / 3397 条，
  原生 select 在移动端调用系统滚轮，体验明显更好，也没有 portal 层级与滚动锁定的问题。
  Radix 仍然用于 Slider / Checkbox / Label。
- **不加 ESLint**。`next lint` 需要额外装 `eslint` + `eslint-config-next`，
  当前用 `tsc --noEmit` 严格类型检查兜底；要加的话一条命令即可。

---

## 文件结构

```
zxssxsc/
├─ data/
│  └─ sensitive-words.json          ← 可编辑的敏感词表（唯一数据源）
├─ scripts/
│  ├─ build-area-data.mjs           ← 生成省市区 JSON + 交叉校验 mock 数据
│  ├─ verify-solar.mjs              ← 晨昏线天文算法数值自检（41 项）
│  ├─ smoke-test.mjs                ← 集成冒烟测试（61 项）
│  ├─ check-tiles.mjs               ← 底图镜像连通性实测
│  └─ sync-sensitive-words.mjs      ← 同步词表到 Edge Function
├─ supabase/
│  ├─ schema.sql                    ← 建表 + 索引 + CHECK + 原子限流函数
│  ├─ rls.sql                       ← 第一层防护：RLS 策略（禁止 DELETE）
│  ├─ seed.sql                      ← 节假日种子数据
│  ├─ README.md                     ← Supabase 接入分步指南
│  └─ functions/submit-guard/       ← 可选：跨实例严格限流的 Edge Function
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx                 ← 顶栏 + Toaster
│  │  ├─ globals.css                ← shadcn 令牌 + Leaflet 样式微调
│  │  ├─ page.tsx                   ← 首页：中学上学时长地图
│  │  ├─ submit/page.tsx            ← 上传 / 修改
│  │  ├─ school/[id]/page.tsx       ← 学校详情 + 版本历史
│  │  ├─ college-holiday/page.tsx   ← 大学生放假查询
│  │  └─ api/
│  │     ├─ schools/route.ts            ← 列表 + 提交（三层防护入口）
│  │     ├─ schools/[id]/route.ts       ← 单校 + 版本历史
│  │     ├─ schools/[id]/rollback/      ← 回滚
│  │     ├─ college-holidays/route.ts   ← 大学假期
│  │     ├─ meta/route.ts               ← 数据模式 / 反滥用配置
│  │     └─ geocode/route.ts            ← Nominatim/Photon 服务端代理（可选增强）
│  ├─ components/
│  │  ├─ map/                       ← 所有 Leaflet 相关代码（必须 ssr:false）
│  │  │  ├─ leaflet-map.tsx         ← 地图主体
│  │  │  ├─ terminator-layer.tsx    ← 晨昏线 + 夜半球 + 蒙影线 + 太阳直射点
│  │  │  ├─ school-markers.tsx      ← 标记聚合
│  │  │  ├─ heat-layer.tsx          ← 热力图
│  │  │  ├─ college-markers.tsx     ← 大学标记（按放假状态着色）
│  │  │  ├─ visitor-marker.tsx      ← 访客定位脉冲
│  │  │  ├─ location-picker.tsx     ← 表单选点地图
│  │  │  └─ map-effects.tsx         ← 飞行定位 / invalidateSize / 点击取消选中
│  │  ├─ ui/                        ← shadcn 组件
│  │  ├─ site-header.tsx            ← 站点名 + 日期时间时区 + 导航
│  │  ├─ time-slider.tsx            ← 右侧竖向时间滑块（−12h ~ +12h）
│  │  ├─ solar-readout.tsx          ← 太阳几何读数（用 suncalc）
│  │  ├─ search-bar.tsx             ← 省市区级联 + 关键词搜索
│  │  ├─ layer-switcher.tsx         ← 图层开关 + 底图切换 + 定位
│  │  ├─ map-legend.tsx             ← 底部图例
│  │  ├─ school-explorer.tsx        ← 首页客户端交互容器
│  │  ├─ college-explorer.tsx       ← 大学页客户端交互容器
│  │  ├─ school-form.tsx            ← 中学表单
│  │  ├─ college-holiday-form.tsx   ← 大学假期表单
│  │  └─ revision-list.tsx          ← 版本历史 + 回滚
│  ├─ hooks/
│  │  ├─ use-clock.ts               ← SSR 安全的每秒时钟
│  │  └─ use-time-travel.ts         ← 时间旅行状态机
│  ├─ lib/
│  │  ├─ solar.ts                   ← 太阳几何 / 晨昏线 / 蒙影线
│  │  ├─ geo.ts                     ← Haversine / 分档 / 筛选
│  │  ├─ tiles.ts                   ← 底图配置（默认 fr 镜像）
│  │  ├─ china-area.ts              ← 省市区查询
│  │  ├─ anti-abuse.ts              ← 第二、三层防护
│  │  ├─ validation.ts              ← 校验（与 SQL CHECK 对应）
│  │  ├─ data-source.ts             ← mock ↔ Supabase 双模式
│  │  ├─ supabase.ts                ← 服务端客户端 + 分页读取
│  │  ├─ holidays.ts                ← 日期 / 假期工具
│  │  ├─ mock-data.ts               ← 演示数据
│  │  ├─ types.ts / utils.ts        ← 数据模型 / cn()
│  │  ├─ college-status.ts          ← 放假状态配色（**必须**不依赖 Leaflet）
│  │  └─ api-helpers.ts             ← API 响应封装
│  ├─ data/china-area.json          ← 生成产物（34 省 / 374 市 / 3397 区县）
│  └─ types/leaflet-heat.d.ts       ← leaflet.heat 类型声明
├─ .env.example
├─ components.json                  ← shadcn 配置
├─ next.config.mjs / postcss.config.mjs / tailwind.config.ts / tsconfig.json
└─ README.md
```

---

## 四个页面

### 1. `/` 中学上学时长地图

- 顶栏：站点名、当天日期、当前时间（每秒刷新）、本地时区（`UTC+08:00（中国标准时间）`）
- 搜索栏：左省-市-区县三级联动，右关键词模糊搜索，结果列表与地图联动
- 地图约 **70vh**，标记按每日时长分三档着色 + 区域聚合，可切热力图
- 右侧**竖向时间滑块**：`−12h ~ +12h`，步长 `0.25h`
- 左上：太阳几何读数（赤纬 δ、直射点、时差、参考点日出日落/昼长）
- 右下：悬浮 `+` 按钮 → `/submit`
- 底部：图例（三档颜色 + 当前数量分布）
- 图层可切换：中学分布 / 热力图 / 晨昏线 / 大学放假

### 2. `/submit` 上传 / 修改

- 顶部可切换到「大学假期」表单（也可直接访问 `/submit?type=college`）
- **修改**：先按省份 + 关键词搜索已有学校，选中后带出原数据再编辑
- 经纬度获取：**主路径是地图拖拽选点**（点击或拖动图钉，自动填 lat/lng）；
  另有「用我的位置填入」与**可选**的地址搜索（服务端代理 Nominatim/Photon）
- 三层防护在服务端强制执行

### 3. `/school/[id]` 学校详情

核心数字卡片（每日时长 / 每周天数 / 每周在校总时长 / 上下学时间）、作息明细、
带晨昏线的小地图、经纬度、以及**版本历史列表**（含一键回滚）。

### 4. `/college-holiday` 大学生放假查询

- 显示当天日期与当天的节日（如「春节」）
- 通过右侧滑块或日期选择器查看**任意日期**
- 地图按状态着色：**假期中（橙）/ 未放假（灰）/ 已开学（绿）**
- 点击大学查看**一校一学年一行**的校历：寒假与暑假各自的起止与天数、学年、校历来源链接、版本号、备注
- 搜索栏里有明确的 **「上传/修改校历」** 按钮（右下角也有悬浮 `+`）
- 下方两份名单：假期中（按**剩余天数**升序）、尚未放假（按**距放假天数**升序）

---

## 核心实现说明

### 晨昏线：为什么不用现成库

suncalc 很擅长算**某个地点**的太阳位置和日出日落，但它不提供**全球晨昏线**几何。
要画出晨昏线，需要自己来。`src/lib/solar.ts` 用 Astronomical Almanac 的简化算法：

```
儒略日 → 太阳平黄经 L、平近点角 g
黄道经度 λ = L + 1.915°·sin g + 0.020°·sin 2g
黄赤交角 ε = 23.439° − 0.0000004°·n
赤纬   δ = asin(sin ε · sin λ)              ← 决定晨昏线倾角与极昼极夜
赤经   α = atan2(cos ε · sin λ, cos λ)
GMST   = 280.46061837° + 360.98564736629°·n
直射点 = (δ, α − GMST)                       ← 时角 H = 0 处
```

晨昏线是太阳高度角 0° 的等值线。令 `sin(alt) = sinφ·sinδ + cosφ·cosδ·cosH = 0`
解出闭式：

```
φ(lng) = atan( −cos H / tan δ )      其中 H = lng − 直射点经度
```

这个闭式解天然落在 `(−90°, 90°)`，而且 `δ → 0`（二分日）时退化为 `±90°`，
正好对应「晨昏线与经线重合」的正确几何 —— 不需要任何特判。

**这就是需求里「晨昏线要随季节变化，不只是简单旋转」的落点**：
δ 在 ±23.44° 之间随日期变化，决定曲线倾斜程度；地球自转只让整条曲线沿经度平移。

夜半球填充：沿经度 −180°→180° 采样晨昏线纬度，再借道「极夜极点」所在纬度收边。
收边纬度取 **Web Mercator 极限 ±85.0511°**（而不是 ±90°），
因为 Mercator 本就无法表达 ±90°，而极冠区域必定是夜，视觉上完全等价。

还额外画了 **−6°（民用）/ −12°（航海）晨昏蒙影线**。蒙影线是「距直射点角距
`ρ = 90° − a` 的小圆」，形如 `A·sinφ + B·cosφ = C`，有两个解，
必须挑「位于晨昏线背光一侧」的那个，否则会在极区画出错误的支线。

### 三层匿名数据防护

| 层 | 位置 | 实现 |
| --- | --- | --- |
| 一：RLS | `supabase/rls.sql` | anon 允许 SELECT/INSERT/UPDATE，**无 DELETE 策略即拒绝** + `REVOKE DELETE`；`WITH CHECK` 复刻列级约束 |
| 二：敏感词 | `src/lib/anti-abuse.ts` | 命中即拒（422），返回可读中文提示；词表在 `data/sensitive-words.json` 可编辑 |
| 三 A：蜜罐 | 同上 + 两个表单 | 隐藏字段 `website`，有值即拒 |
| 三 B：时间陷阱 | 同上 | 表单挂载到提交 < 3 秒即拒（可配） |
| 三 C：IP 限流 | 同上 | 同 IP 每小时最多 3 次（可配），滑动窗口计数器 |
| 附加 | `/api/schools` | 行政区划真实性校验，伪造省份直接拒 |

**敏感词匹配做了双通道**，因为两类需求互相冲突：

- 纯中文词（`加微信`）走「**已剥离标点**」通道，因此 `加*微*信`、`加 微 信`、全角写法也能命中；
- 含 ASCII 标点的广告特征（`.com`、`http://`）走「**保留标点**」通道，
  否则剥标点会把 `.com` 变成裸 `com`，造成大面积误伤。

词表也刻意避开了容易误伤的裸词（例如用「无抵押贷款」而不是「贷款」，
这样「国家助学贷款」这类正常内容不会被拦）。

### 双模式数据层

`src/lib/data-source.ts` 定义 `Store` 接口，两份实现：

- `mockStore`：未配置 Supabase 时使用，提交写入**挂在 `globalThis` 上**的内存存储
  （挂 globalThis 是为了让 Next 开发模式的热替换不清空你刚提交的数据）
- `supabaseStore`：真实读写，含 1000 行分页（PostgREST 单次默认最多 1000 行，
  不翻页会**静默截断**，地图上会莫名少掉一批学校）

### 关于标记弹窗的 XSS 面

学校名 / 备注是**匿名用户输入**。聚合图层用命令式 `leaflet.markercluster`，
而命令式 API 只能绑定 HTML 字符串弹窗 —— 那就是一条明确的 XSS 通道。

因此这里的做法是：

- 聚合图层里的标记**不绑定任何弹窗**，点击只回调 `onSelect(id)`；
- 被选中的那一所由 react-leaflet 的 `<Marker>` + `<Popup>` 用 **React 节点**渲染，
  并自动 `openPopup()`。

既拿到聚合性能，又完全没有 HTML 字符串注入面。

### 一个容易踩的坑（已修）

`COLLEGE_STATUS_COLORS` 这个纯常量最初放在 `components/map/college-markers.tsx` 里，
而那个文件顶层有 `import L from 'leaflet'`（Leaflet 在**模块求值期**就会访问 `window`）。
结果 `map-legend.tsx` 值导入该常量时，把 Leaflet 连带拖进了 SSR 包，
首页与大学页直接 500：`ReferenceError: window is not defined`。

**结论：Leaflet 相关模块只能被 `'use client'` 组件动态引入
（`next/dynamic` + `ssr: false`）；其中可复用的纯常量要单独抽到 `src/lib/`。**

---

## 地图加载性能与瓦片镜像

保持 Leaflet + 开源 OSM 瓦片，不引入高德。围绕「加载慢」做了五件事。

### 1. 多镜像自动测速选源（默认行为）

启动时浏览器并发请求每个候选镜像的**同一张瓦片**（z=4 覆盖华北的那张），
取响应最快的作为底图。默认 `NEXT_PUBLIC_TILE_PROVIDER=auto`。

- 实现：`src/lib/tileProviders.ts` 的 `measureTileProviders()` + `src/hooks/use-tile-provider.ts`
- 测速用 `Image` 而不是 `fetch`：Image 加载完的瓦片会**进入浏览器 HTTP 缓存**，
  于是赢家那张瓦片在真正初始化地图时直接命中缓存 —— 测速顺带完成首屏预热。
- 结果写进 `sessionStorage`，本次会话内跨页面导航（含详情页小地图）不再重测。
- 只在客户端测速：服务端测出来的是 Vercel 机房的速度，与用户所在网络无关。
- 浏览器控制台会打印胜出者与全部对比：`[zxssxsc] 底图自动选源：osmfr（437ms）；对比 …`

**hook 放在 `leaflet-map` 内部而不是页面里**，所以首页地图、大学放假页地图、
学校详情页小地图三处自动都享受选源优化，页面组件一行都没改。

### 2. 浏览器缓存：上游已经做对了，我们别破坏它

这一条值得说清楚，因为它看着像要写代码，其实**不需要写**：

| 镜像 | `cache-control` | `access-control-allow-origin` |
| --- | --- | --- |
| `hot` | `max-age=93356` | `*` |
| `osmfr` | `max-age=45474` | `*` |
| `de` | `max-age=269708` | `*` |

上游已经给了几分钟到几小时的长缓存，而且带 CORS 头。我们唯一要做的是
**不要用 cache-busting 参数去破坏它**，并且把 `crossOrigin: true` 打开
（`tileLayerOptions()` 里已设）—— 跨域图片若走 opaque 响应，缓存与后续处理都会受限。

### 3. Leaflet 参数调优

集中在 `tileLayerOptions()` 一个工厂函数里，主地图与表单选点地图共用，避免两边漂移：

```ts
updateWhenIdle: true,      // 平移期间攒批更新，减少移动网络下的无效请求
updateWhenZooming: false,  // 缩放动画期间不发新瓦片请求
keepBuffer: 2,             // 多留 2 圈屏幕外瓦片，小幅平移无需重新请求
maxNativeZoom, maxZoom,    // 见下
crossOrigin: true,
detectRetina: false,       // 这些镜像不提供 @2x，开了只会请求到 404
```

> ⚠️ **`updateWhenIdle: true` 是有代价的**：拖动过程中新区域的瓦片要等松手才出现，
> 桌面端比 Leaflet 默认行为（桌面端为 `false`）更明显。
> 这是按需求实现的选择；若你觉得拖动时「发白」，把这一个值改成 `false` 即可。

`maxNativeZoom` 的真实用途在天地图：`vec_w` 只到 18 级，所以配置成
`maxNativeZoom: 18, maxZoom: 19` —— 允许用户缩放到 19，超出部分由 Leaflet
放大 18 级瓦片，否则 z19 的请求会**全部 404**，看起来就是「地图加载失败」。

### 4. 首屏中心瓦片预热

Leaflet 自己会请求**当前视口**的瓦片，所以「预加载当前屏幕」是多余的。
真正有用的是预热**放大一级**的中心瓦片：用户最常见的下一步就是滚轮放大。
见 `src/components/map/map-effects.tsx` 的 `PreloadCenterTiles`，只预热 4 张。

### 5. 全部镜像失败时的降级

判据刻意设为「**连续 4 张失败且一张都没成功过**」—— 单张 404（地图边界瓦片）
不该把整块底图判死。命中后在**地图容器内**盖一层兜底：

- 静态占位图 `public/map-fallback.svg`（纯文本 SVG，无二进制资产）
- 文案「地图加载失败，请刷新重试」
- 「重试」按钮（重建 TileLayer）与「刷新页面」
- 仍然保留 `© OpenStreetMap contributors` 署名

### 镜像准入规则

只收录**实测可用**的镜像。以下候选都已实测被排除，**不要加回来**：

| 候选 | 结果 |
| --- | --- |
| `tile.openstreetmap.bzh` | fetch failed（死链） |
| `osm.nixqz.com` | fetch failed（死链） |
| `maps.wikimedia.org` | fetch failed |
| `a.basemaps.cartocdn.com` | fetch failed |
| `tile.openstreetmap.jp` | 200 但 9386ms，慢一个数量级，反而拖慢首屏 |
| `tile.osm.ch` | 200 但**无 ACAO**，会破坏 `crossOrigin` 缓存 |
| `tiles.openfreemap.org` | 该路径不是栅格瓦片（0 字节） |

**新增镜像的流程**：改 `TILE_PROVIDERS`（记得设 `speedTest: true`）→
跑 `npm run check:tiles` 确认它真的活着、有 CORS、够快 → 再提交。

### 关闭自动测速

```bash
# .env.local
NEXT_PUBLIC_TILE_PROVIDER=de     # 固定用德国镜像
```

图层面板里也能手动切换；手动选定后会写回会话缓存，不再被测速结果覆盖。

---

## 大学校历抓取与录入

### 数据模型：一校一学年一行（宽表）

```ts
interface CollegeHoliday {
  id, university_name, province, city, lat, lng
  academic_year            // 2025-2026
  winter_start, winter_end // 可为 null（未公布）
  summer_start, summer_end // 可为 null
  source_url, note
  version, created_at, updated_at
}
```

改成宽表的原因：现实中抓到的校历就是「某某大学 2025-2026 学年校历」**一份文档**，
里面同时写着寒假和暑假。宽表与数据来源同构，而且
`(university_name, academic_year)` 成了**天然唯一键** ——
重复导入同一所学校可以直接 upsert，不会堆出重复行。
数据库层有这个唯一约束，`submitCollegeHoliday` 与导入 SQL 都依赖它。

### 人工抓取流程

1. 打开目标高校的校历页（通常是教务处/党政办通知页里的附件或正文表格）
2. 读完页面，提取：大学名称、学年、寒假起止、暑假起止、来源 URL
3. 把结果写成 JSON（格式见 `data/college-calendars.example.json`）
4. 生成导入语句：

   ```bash
   cp data/college-calendars.example.json data/college-calendars.json
   # 编辑 data/college-calendars.json 填入真实数据
   npm run calendar:sql
   ```

   产出 `supabase/college-holidays-import.sql`（**幂等**，可反复执行）
   与 `data/college-holidays.csv`（供 Supabase 表导入用）。
5. 把 SQL 内容粘进 Supabase SQL Editor 执行

`npm run calendar:check` 是这套转换的自检（19 项），覆盖 SQL 单引号转义、
CSV 引号规则、以及**直接复用应用自己的 `validateCollegeHoliday`** 跑的各类拒绝路径。
校验规则只有一份，不会出现「前端能过、导入脚本也能过、但两者口径已经分叉」。

### ⚠️ 当前抓取的实测状态（重要）

**浏览器插件与目标站点目前都不可用，抓取这一步需要你提供页面文本。**

| 项目 | 实测结果 |
| --- | --- |
| `dsh-plugin-browsers` / BrowserSkill | 工具未注入，调用返回 **`unknown tool "browser_session"`** |
| 西华大学校历页 `dzb.xhu.edu.cn/…` | **HTTP 412**（带真实浏览器 UA 也一样） |
| `www.xhu.edu.cn` 与 `dzb.xhu.edu.cn` 首页 | 同样 **HTTP 412** |

412 的响应体是 `$_ts` / `$_ts.cd` 混淆脚本 + `set-cookie` 挑战串，
这是**瑞数信息（Riversafe）动态防护**的特征：它要求真实浏览器执行 JS 并维护 cookie，
纯 HTTP 请求无法通过。所以这不是代码能绕的问题。

**两条可行路径：**

1. **你手动粘贴**（最快）：把校历页正文/表格文本贴给我，我解析成 JSON 并生成 SQL。
2. **恢复浏览器插件**：确认 `bsk` CLI 已安装并在 PATH 上（
   [BrowserSkill](https://github.com/Tencent/BrowserSkill) 的安装脚本），
   插件生效后我就能用真实浏览器打开页面并读取（瑞数那类挑战在真实浏览器里会自动通过）。

### 匿名上传/修改入口

`/college-holiday` 页面的 **「上传/修改校历」** 按钮 → `/submit?type=college`。

复用与中学完全相同的三层防护：

- **RLS**：anon 可 SELECT/INSERT/UPDATE，`college_holidays` 与
  `college_holiday_revisions` 都**没有 DELETE 策略**且额外 `REVOKE DELETE`
- **敏感词**：扫描 `university_name` 与 `note`
- **蜜罐 + 时间陷阱 + IP 限流**：与中学共用同一套实现

> ⚠️ 一个被冒烟测试抓出来的坑：最初我把 `source_url` 也放进敏感词扫描，
> 而词表里有 `http://` / `https://` 两条防广告词 —— 结果**每一条合法提交都被拦死**（422）。
> URL 字段该用的是格式校验（`^https?://`），不是关键词黑名单。现已修正。

**版本历史与回滚 UI**：修改前会先把旧行整体快照进 `college_holiday_revisions`，
`version` +1。大学校历的详情页 `/college-holiday/[id]` 与中学详情页一样，
列出全部历史版本并提供**「回滚到此版本」按钮**
（从地图弹层的「查看详情 / 版本历史 →」进入）。

> 实现上踩过一个 Next.js 的边界坑，值得记下来：
> 最初 `RevisionList` 用 `renderTitle` / `renderSummary` 两个 **render 函数**做参数化，
> 结果两个详情页直接 500 —— **服务端组件传给客户端组件的 props 必须可序列化，函数不行**。
> 改成由服务端预先格式化好标题与摘要行（纯数据）后就正常了，
> 组件也因此去掉了泛型。这个回归是被冒烟测试抓出来的。

### 已有旧库的迁移

如果你已经执行过**上一版**的 `schema.sql`（`college_holidays` 还是
`holiday_type/start_date/end_date/days` 结构），按顺序执行：

```
supabase/migrations/20260919_college_calendar_wide.sql   -- 透视成宽表
supabase/migrations/20260919_remove_primary_and_add_status.sql
supabase/rls.sql                                          -- 换表后策略会丢，必须重跑
supabase/admin-cleanup.sql                                -- 可选：管理员清理通道
```

迁移脚本是**幂等**的：旧结构不存在（全新安装）或已是新结构时，它什么都不做。
注意旧结构里 `holiday_type='other'` 的记录无法映射到新结构，会被丢弃 ——
执行前先跑文末的检查语句确认数量。

> 顺序很重要：`remove_primary` 那个迁移里「先标记 deprecated 再收紧 stage 约束」
> 不能颠倒，否则旧行仍带着 `'primary'` 会直接把约束检查顶失败。

---

## 接入 Supabase

完整分步指南见 **[`supabase/README.md`](supabase/README.md)**。简要三步：

1. SQL Editor 执行 `supabase/schema.sql`（建表 + 约束 + 原子限流函数）
2. 执行 `supabase/rls.sql`（第一层防护）
3. `.env.local` 填入 `SUPABASE_URL` 与 `SUPABASE_ANON_KEY`，重启

可选第四步：部署 `submit-guard` Edge Function 做跨实例严格限流。

---

## Vercel 部署

### 1. 推送仓库

```bash
git init
git add .
git commit -m "feat: zxssxsc 初始版本"
git remote add origin <your-repo-url>
git push -u origin main
```

### 2. 在 Vercel 导入项目

- Framework Preset 会自动识别为 **Next.js**，构建命令 `next build`，无需改
- Root Directory 若你把项目放在子目录，需指向该子目录

### 3. 配置环境变量

Vercel → Project → Settings → Environment Variables，按需添加：

| Key | 环境 | 说明 |
| --- | --- | --- |
| `SUPABASE_URL` | Production / Preview | 留空则线上也是演示模式 |
| `SUPABASE_ANON_KEY` | Production / Preview | |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | 建议只加 Production，避免 Preview 泄露面扩大 |
| `NEXT_PUBLIC_TILE_PROVIDER` | All | 默认 `hot` |
| `NEXT_PUBLIC_TIANDITU_KEY` | All | 仅用 `tian` 时 |
| `SUBMIT_RATE_LIMIT_PER_HOUR` | All | 默认 3 |
| `SUBMIT_MIN_FILL_MS` | All | 默认 3000 |
| `NEXT_PUBLIC_SITE_NAME` | All | 默认 zxssxsc |

> `NEXT_PUBLIC_*` 是**构建期**内联的，改完必须重新部署才生效。

### 4. 部署后检查

- [ ] 首页地图能加载瓦片（若 bottom-right 出现大块空白，说明底图被墙 → 切 `de` 或天地图）
- [ ] 顶栏徽标显示「已连接」（而不是「演示数据」）
- [ ] 定位按钮可用 → 说明 HTTPS 生效（Geolocation 要求安全上下文）
- [ ] 提交一条测试数据，确认返回 201 并出现在地图上
- [ ] 再提交一次，确认出现 `429`（IP 限流生效）

### 5. 自定义域名

Vercel 会自动签发 HTTPS 证书。**必须用 HTTPS**，否则浏览器 Geolocation 直接拒绝。

---

## 自检脚本

这些脚本不只是「能跑」，而是能**证明行为正确**：

### `npm run verify:solar`（41 项）

把算出来的晨昏线纬度**代回太阳高度角公式**验证：

```
ok  春分 晨昏线高度角残差  max|alt|=0.0000°
ok  夏至 直射经度上晨昏线应在南半球高纬  lat=-66.56°
ok  最大斜率等于 cot(δ)  实测=2.3063°/° 解析=2.3070°/°
ok  每小时直射点西移约 15°  Δ=-14.998°
```

判据是「代回公式必须为 0」以及「斜率必须等于解析值 `cot δ`」，
而不是拍一个阈值 —— 后者会把 bug 当成通过。

### `npm run smoke`（92 项，需先启动 dev）

覆盖：页面渲染、SSR 崩溃检测、三层防护逐条生效、行政区划伪造、限流、
「新增 → 修改 → 快照 → 回滚」全链路、底图多镜像与调优参数、
大学校历宽表字段与「一校一学年一行」不变量、校历提交的幂等与全部拒绝路径、
随机标语确实只在客户端随机（SSR 为空串）。

**两个测试自身的坑（都已修，值得记下来）：**

1. **IP 限流用例不可重复运行**：限流是 1 小时滑动窗口而计数器活在 dev server 进程里，
   固定 IP 会让第二次运行的第一个请求就直接 429。
   → 改为每次运行使用**随机 IP 段**（`RUN_TAG`）。
2. **校历「新增」用例不可重复运行**：提交逻辑按 `(校名, 学年)` 幂等，
   固定校名会让第二次运行走「修改」分支。
   → 改为每次运行使用**随机校名后缀**。

同一个教训：断言必须是**不变量**（「不存在重复的 (大学, 学年)」），
而不是会随运行累积变化的**绝对数量**（不用 `=== 60`）。

### `npm run check:tiles`

真实请求一张覆盖中国的瓦片，确认镜像可用，并打印耗时排名 ——
**这个排名就是自动选源在你的网络下会选中的那个**。本机实测：

```
ok    hot    200 22890B 1008ms  https://a.tile.openstreetmap.fr/hot/4/12/6.png
ok    osmfr  200 25636B  437ms  https://c.tile.openstreetmap.fr/osmfr/4/12/6.png
ok    de     200 18449B 1208ms  https://tile.openstreetmap.de/4/12/6.png
FAIL  osm      0     0B 10576ms  https://tile.openstreetmap.org/4/12/6.png

✅ 3 个测速候选镜像全部可用，自动选源成立。
   耗时排名（决定自动选源）：osmfr:437ms > hot:1008ms > de:1208ms
ℹ️  官方 tile.openstreetmap.org 不可用 —— 这正是它被设为默认禁用、仅作调试的原因。
```

**官方源实测不可用**，这实证了「禁止使用官方 `tile.openstreetmap.org`」这条要求的必要性。

> ⚠️ 本机网络位置 ≠ 你的用户位置。**国内可访问性的最终结论请在国内网络下重跑一次。**

### `npm run calendar:check`（19 项）

校历导入转换的自检：SQL 单引号转义（含注入尝试）、CSV 引号规则、日期字面量、
以及直接复用 `validateCollegeHoliday` 跑的 7 条拒绝路径 + 同批重复检测。

---

## 我做的假设与需要你确认的点

### 已确认的决定

以下五项已由你确认，**当前代码即按此实现，无需再改**：

| # | 决定 | 落点 |
| --- | --- | --- |
| A | 三档阈值保持 **8h / 11h** 不变 | `src/lib/geo.ts` 的 `DURATION_BUCKETS` |
| B | `CollegeHoliday` **加上 lat / lng**，保证大学能在地图上打点 | `types.ts`、`schema.sql`、`college-markers.tsx` |
| C | 允许任意访客修改，**加「修改前快照回滚」UI 按钮** + 留 SQL 删除通道 | `revision-list.tsx`、`/school/[id]`、`/college-holiday/[id]`、`supabase/admin-cleanup.sql` |
| D | **每月上学天数保留**为展示字段（不参与计算） | `School.monthly_days`，仅展示 |
| E | 对 anon **禁止 DELETE**，清理走后台通道 | `supabase/rls.sql`（无 DELETE 策略 + `REVOKE DELETE`） |

### 关于 C 的两条通道

**回滚 UI**：学校与大学校历的详情页都有历史版本列表 + 「回滚到此版本」按钮。
回滚本身也是一次修改 —— 先把当前版本存成新快照，再恢复目标版本，`version` +1，
所以回滚之后仍然可以回滚回来，历史不会丢。

**SQL 删除通道**：`supabase/admin-cleanup.sql`。设计上刻意做了三层保护：

1. **先归档再删除** —— 被删的行先整行写进 `deleted_records`，事后可还原
2. **只给 `service_role`** —— 函数都是 `SECURITY DEFINER` 且 `REVOKE` 掉了
   anon / authenticated 的 EXECUTE 权限，访客连调用资格都没有
3. **提供软删除替代** —— `schools.status='deprecated'` 只下架不销毁，优先用它

日常用法（软删除、按 id 硬删、批量清理、从归档还原、审计查询）都写在那个文件里。

---

以下是信息不足时我按默认方案做的决定。**每一条都可以改，标 ★ 的建议你确认。**

### 数据与口径

1. ★ **演示数据是示例值，不是真实数据。** 学校名单是真实的，经纬度取所在城区的近似坐标
   （误差约 1–5km），但**「每日在校时长 / 上学天数 / 作息」全部是示例值**，
   **大学校历也全部是示例**（`source` 字段统一标记 `mock-demo`）。
   页面上有醒目提示。接入 Supabase 后自动切换到真实数据。

2. **三档划分口径**：短 `< 8h` / 中 `8–11h` / 长 `≥ 11h`（`src/lib/geo.ts` 的
   `DURATION_BUCKETS`）。这是我自己定的分界，你若有更合理的阈值，改这一个常量即可。

3. ★ **给 `CollegeHoliday` 增加了 `lat` / `lng`。** 你给的数据模型里没有大学坐标，
   但「地图展示大学位置并按状态着色」必须要位置。若你打算单独建一张大学位置表，
   需要同时改 `types.ts`、`schema.sql` 与 `college-markers.tsx`。

4. **「每日上学时长」定义为从到校到离校的总时长（含早读与晚自习）**，
   与页面上的「每周在校总时长 = 每日 × 每周天数」口径一致。

5. **节假日数据**：2025 年依据国务院办公厅安排；**2026 年为参考排布**，
   页面/接口都标注了「（参考）」，最终以当年通知为准。

6. **大学的「已放假/未放假/假期中」三态**，我理解为：
   未放假（假期未开始）/ 假期中 / 已开学（假期已结束），
   并分别用橙 / 绿 / 灰三色。如果你指的是别的语义，改 `COLLEGE_STATUS_LABELS` 即可。

### 技术与实现

7. ★ **生产构建我未能在本机跑通**（见「已知限制」），只完成了
   `tsc --noEmit` 零错误 + dev server 全路由编译通过。
   请你务必本地跑一次 `npm run build` 确认。

8. **Next 15 + React 19 + react-leaflet 5 + Tailwind 3.4**。
   Tailwind 刻意停在 v3：v4 改了配置范式，与 shadcn 生态的既有写法不兼容风险较高。

9. **级联下拉用原生 `<select>`** 而非 Radix Select（理由见「技术选型说明」）。
   如果你更想要 Radix 的视觉一致性，我可以换。

10. **不加 Next.js Middleware 做限流**。Serverless 下 middleware 同样多实例，
    并不能比 Route Handler 提供更强保证，反而多一层复杂度。
    真正的严格限流放在了数据库原子计数器。

11. **地址搜索（Nominatim/Photon）是可选增强，且默认折叠**。
    主路径始终是地图选点。服务端代理 + 5 分钟缓存 + 每 IP 1 秒 1 次节流，
    遵守 Nominatim 使用政策；失败时前端自动回退，不会阻断流程。

12. **访客定位只取经纬度**：不反查文字地址、不发第三方、不写数据库/localStorage，
    坐标只存在于页面内存。这是按你的隐私要求实现的。

13. **敏感词表是我起的一个基础词表（78 条 / 4 分类）**，
    已刻意避开容易误伤的裸词。**请按你的实际需要增删** —— 直接改
    `data/sensitive-words.json`，然后 `npm run sync:words` 同步到 Edge Function。

14. **版本快照写在 API 层**（而非数据库触发器）。理由与取舍见
    `supabase/README.md` 第 6 节；若要「无论如何都留痕」，那里提供了触发器方案。

15. **`/api/geocode` 没有做持久化缓存**，只有进程内 5 分钟缓存。
    流量大时可换成 Supabase 表或 Vercel KV。

### 需要你确认的问题

- **A.** 三档阈值（8h / 11h）是否合适？还是你希望按「走读/住宿」或「含不含晚自习」再细分？
- **B.** 「每月上学天数」这个字段的实际用途是什么？目前只是展示，没有参与任何计算。
  如果你的本意是「月假制学校每月实际放假几天」，语义要调整。
- **C.** 是否真的允许**任意访客修改任意学校**（按需求原文是这样实现的）？
  没有任何审核或管理员角色的代价是：数据可能被恶意覆盖。
  当前已有版本历史兜底，但如果想要「修改需二次确认」或「保留最近一次给管理员审核」，
  需要增加机制 —— 请明确你的取舍。
- **D.** 大学数据是否需要独立的 `universities` 表（含坐标、985/211 标签等）？
  目前坐标是冗余存在每条假期记录上的。
- **E.** 是否需要**管理员删除**通道？当前 RLS 对 anon **完全禁止 DELETE**（按需求实现），
  误提交的垃圾数据只能靠修改覆盖，无法清除。若有此需求，
  建议走 `service_role` 的后台脚本，而不是给前端开删除权限。

---

## 已知限制

诚实说明我实际验证到什么程度：

**已验证：**

- ✅ `tsc --noEmit` 零错误
- ✅ dev server 全路由编译通过，`/` `/submit` `/college-holiday` `/school/[id]` 与全部 API 均 200
- ✅ 集成冒烟测试 **92/92** 通过，且**连续两次运行结果一致**（含三层防护、
  学校版本回滚链路、大学校历宽表字段、校历提交幂等与全部拒绝路径、底图调优参数）
- ✅ 晨昏线天文算法 41/41 通过，高度角残差 `0.0000°`
- ✅ 校历导入转换自检 19/19 通过（含 SQL 注入转义、CSV 规则、复用应用校验器）
- ✅ 省市区数据交叉校验：58 所 mock 学校的省/市/区县均可在级联中被选中
- ✅ 底图镜像实测：3 个测速候选全部可用，**官方源 fetch failed**；
  7 个候选因死链/慢/无 CORS/非栅格瓦片被排除
- ✅ 全项目源码与用户可见文案中**不再出现「小学」**（残留仅在解释性的代码注释与迁移 SQL 里）
- ✅ 两个 Leaflet 插件的 UMD 包装确认真实挂载了 `L.heatLayer` / `L.markerClusterGroup`

**未验证（受本机环境限制，请你补验）：**

- ⚠️ **生产构建未跑通**：Next.js 构建会 `child_process.fork` 派生 worker，
  在我的沙箱环境中被拒（`spawn EPERM`）。请本地执行 `npm run build` 确认。
- ⚠️ **未做真实浏览器渲染验证**：BrowserSkill 的工具未注入
  （调用返回 `unknown tool "browser_session"`），我无法打开任何页面。因此：
  - 瓦片是否真的画出来、聚合与热力图的运行时表现
  - **自动测速是否真的选中了最快的镜像**（逻辑与镜像可达性都已单独验证，
    但「跑起来选中谁」没在浏览器里看过 —— 打开控制台应能看到
    `[zxssxsc] 底图自动选源：…`）
  - 随机标语是否**真的没有 hydration 警告**

  以上请务必打开页面亲眼确认一次（见下方「每步验证方法」）。
- ⚠️ **Supabase 路径未经真实数据库实测**（本机无 Supabase 实例）。
  演示模式的等价逻辑已全部测通，但 `supabaseStore` 的 SQL 交互、
  RLS 策略、以及两个迁移脚本本身建议你在 Supabase 上跑一遍验证。
- ⚠️ **校历抓取未完成**：浏览器插件不可用 + 西华大学为瑞数动态防护（全域 HTTP 412）。
  真实校历数据需要你提供页面文本。

**其他：**

- 底图瓦片不缓存到本地，每次浏览都由浏览器正常加载（遵守 OSM 使用政策，不做批量抓取）。
- OSM 数据采用 **ODbL 许可**：免费、可商用，但**必须署名**并遵守**相同方式共享**。
  站点已在图例、详情页、弹层、地图兜底层多处保留 `© OpenStreetMap contributors`。
- 访客定位需要 HTTPS（或 localhost）。Vercel 默认提供 HTTPS，本地开发用 `localhost` 也可。
- `zxssxsc/nodejs/` 是环境预置时误落在项目目录里的便携 Node 发行版（约 100MB）。
  已加入 `.gitignore`，**建议直接删掉**：`Remove-Item -Recurse -Force nodejs`。

---

## 每步验证方法（在浏览器里看什么）

### 验证地图性能优化

1. 打开首页，开 DevTools → Network，筛选 `png`
   - 应看到瓦片请求**只打到一个镜像域名**（自动选源生效）
   - Console 应打印 `[zxssxsc] 底图自动选源：osmfr（xxx ms）；对比 …`
2. 拖动地图：瓦片应在**松手后**成批出现（`updateWhenIdle: true` 的表现）。
   若觉得别扭，把 `tileProviders.ts` 里 `updateWhenIdle` 改成 `false`。
3. **验证降级**：DevTools → Network 里把域名加入 request blocking，
   屏蔽 `tile.openstreetmap.fr` 与 `tile.openstreetmap.de`，刷新页面。
   应看到「地图加载失败，请刷新重试」+ 兜底占位图 + 「重试」按钮（而不是一片空白）。
4. 在「图层 → 底图」里手动切到 `de`，地图应立刻换源且**不再被自动测速覆盖**。

### 验证小学已全部移除

1. `/submit` → 学段下拉应只有 **初中 / 高中 / 其他**
2. 首页搜索：选「北京市」应能搜到人大附中等，但搜不到任何小学
3. 首页地图标记应为 58 个（原 60 减去 2 所小学）
4. 全局搜索页面文本，不应出现「小学」

### 验证随机标语

1. 顶栏站点名下方应有一行居中的浅色标语
2. **反复刷新**，应在「适当的休息是必要的噢！」与「祝你好运！」之间随机切换
3. Console 不应出现 `Hydration failed` / `Text content did not match` 警告

### 验证大学校历改动

1. `/college-holiday` 搜索栏右侧应有 **「上传/修改校历」** 按钮
2. 点击任一大学标记，弹层应同时显示**寒假**与**暑假**的起止日期 + 天数 + 版本号 + 来源链接
3. 拖动右侧时间滑块到 1 月下旬，地图上应出现一批**橙色**（假期中）标记
4. 点「上传/修改校历」→ 只填寒假、暑假留空 → 应能提交成功（前端提示「未公布可留空」）
5. 同一所学校同一学年再提交一次 → 应提示「修改成功」而**不是**新增第二条

### 验证回滚按钮（学校与大学校历都有）

1. 打开任意学校详情页 `/school/mock-school-001` → 底部「版本历史」
   - 若从没被改过，会显示空态「还没有历史版本」
   - 先用 `/submit` 改一次它，刷新后应出现 v1 快照行 + **「回滚到此版本」**按钮
2. 点回滚 → 确认弹窗 → 应提示「已回滚到 v1，当前版本 v2」，且数据回到修改前
3. 再点同一行的回滚 → 仍可用（回滚也会留下快照，历史不会丢）
4. 大学校历：首页地图 `/college-holiday` → 点大学标记 → 「查看详情 / 版本历史 →」
   → 同一个列表与按钮

### 验证 SQL 删除通道

1. Supabase SQL Editor 执行 `supabase/admin-cleanup.sql`
2. 先验匿名删不掉：

   ```sql
   set role anon;
   delete from public.schools where true;                  -- 期望：permission denied 或 0 行
   select public.admin_delete_school(gen_random_uuid());   -- 期望：permission denied
   reset role;
   ```

3. 再验管理员通道可用且**先归档**：

   ```sql
   select public.admin_delete_school('<某个 id>', '测试清理');   -- 期望：返回 1
   select table_name, record_id, reason from public.deleted_records order by deleted_at desc limit 5;
   ```

4. 确认 `deleted_records` 里有整行 `payload`，可以按文件末尾的语句还原
