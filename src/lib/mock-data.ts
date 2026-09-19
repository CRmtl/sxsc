/**
 * 演示用 mock 数据。
 *
 * ⚠️ 重要声明
 * - 中学：学校名单真实，经纬度取自所在城区的近似坐标（误差约 1–5km，用于演示足够）。
 *   但“每日在校时长 / 上学天数 / 作息”均为**示例值**，不代表任何学校的真实作息。
 * - 大学假期：**全部为示例校历**，不是任何学校的真实校历。
 *   source 字段统一标记为 `mock-demo`，接入真实数据后应替换。
 *
 * 未配置 Supabase 时，前端与 API 都会落到这份数据上，保证项目开箱即可跑通。
 */

import type { CollegeHoliday, Holiday, School, Stage } from './types'

/* ------------------------------------------------------------------ */
/* 中学                                                                */
/* ------------------------------------------------------------------ */

interface SchoolSeed {
  /** name */
  n: string
  /** stage */
  st: Stage
  /** province */
  p: string
  /** city */
  c: string
  /** district */
  d: string
  lat: number
  lng: number
  /** daily_hours 每日在校时长 */
  h: number
  /** weekly_days */
  w: number
  /** monthly_days */
  m: number
  /** boarding 是否住宿制 */
  b: boolean
  /** arrive_time */
  a: string
  /** leave_time */
  l: string
  /** remark */
  r?: string
}

const SCHOOL_SEEDS: SchoolSeed[] = [
  // —— 北京 ——
  { n: '中国人民大学附属中学', st: 'senior', p: '北京市', c: '北京市', d: '海淀区', lat: 39.976, lng: 116.312, h: 11.5, w: 5, m: 22, b: true, a: '07:20', l: '21:30', r: '示例值：早读 + 晚自习，高三周六上课' },
  { n: '北京市第四中学', st: 'senior', p: '北京市', c: '北京市', d: '西城区', lat: 39.932, lng: 116.372, h: 10.5, w: 5, m: 21, b: false, a: '07:30', l: '17:30', r: '示例值：走读为主' },
  { n: '清华大学附属中学', st: 'senior', p: '北京市', c: '北京市', d: '海淀区', lat: 40.0, lng: 116.326, h: 11.0, w: 5, m: 22, b: true, a: '07:25', l: '21:00' },
  // —— 上海 ——
  { n: '上海中学', st: 'senior', p: '上海市', c: '上海市', d: '徐汇区', lat: 31.152, lng: 121.438, h: 11.0, w: 5, m: 22, b: true, a: '07:30', l: '21:00' },
  { n: '华东师范大学第二附属中学', st: 'senior', p: '上海市', c: '上海市', d: '浦东新区', lat: 31.228, lng: 121.542, h: 10.5, w: 5, m: 21, b: true, a: '07:20', l: '20:30' },
  { n: '上海市实验学校', st: 'other', p: '上海市', c: '上海市', d: '浦东新区', lat: 31.221, lng: 121.556, h: 9.0, w: 5, m: 21, b: false, a: '08:00', l: '16:45' },
  // —— 广东 ——
  { n: '华南师范大学附属中学', st: 'senior', p: '广东省', c: '广州市', d: '天河区', lat: 23.14, lng: 113.34, h: 11.5, w: 5, m: 22, b: true, a: '07:15', l: '21:30' },
  { n: '深圳中学', st: 'senior', p: '广东省', c: '深圳市', d: '罗湖区', lat: 22.556, lng: 114.118, h: 11.0, w: 5, m: 22, b: true, a: '07:20', l: '21:00' },
  { n: '广州市执信中学', st: 'senior', p: '广东省', c: '广州市', d: '越秀区', lat: 23.129, lng: 113.296, h: 10.5, w: 5, m: 21, b: false, a: '07:30', l: '18:00' },
  { n: '东莞市东华高级中学', st: 'senior', p: '广东省', c: '东莞市', d: '东城街道', lat: 23.02, lng: 113.79, h: 12.5, w: 6, m: 26, b: true, a: '06:50', l: '22:00', r: '示例值：月休制，两周放一次' },
  { n: '汕头市第一中学', st: 'senior', p: '广东省', c: '汕头市', d: '金平区', lat: 23.36, lng: 116.68, h: 11.0, w: 5.5, m: 24, b: true, a: '07:00', l: '21:30' },
  // —— 江苏 ——
  { n: '南京外国语学校', st: 'other', p: '江苏省', c: '南京市', d: '玄武区', lat: 32.056, lng: 118.796, h: 9.5, w: 5, m: 21, b: false, a: '07:40', l: '17:30' },
  { n: '江苏省苏州中学', st: 'senior', p: '江苏省', c: '苏州市', d: '姑苏区', lat: 31.305, lng: 120.63, h: 10.5, w: 5, m: 22, b: true, a: '07:20', l: '20:30' },
  { n: '南京师范大学附属中学', st: 'senior', p: '江苏省', c: '南京市', d: '鼓楼区', lat: 32.07, lng: 118.77, h: 10.5, w: 5, m: 21, b: false, a: '07:30', l: '18:30' },
  { n: '江苏省南通中学', st: 'senior', p: '江苏省', c: '南通市', d: '崇川区', lat: 31.98, lng: 120.87, h: 12.0, w: 6, m: 26, b: true, a: '06:40', l: '21:50', r: '示例值：县中模式，月假' },
  { n: '徐州市第一中学', st: 'senior', p: '江苏省', c: '徐州市', d: '云龙区', lat: 34.256, lng: 117.21, h: 12.0, w: 6, m: 26, b: true, a: '06:45', l: '22:00' },
  // —— 浙江 ——
  { n: '杭州第二中学', st: 'senior', p: '浙江省', c: '杭州市', d: '滨江区', lat: 30.186, lng: 120.19, h: 10.5, w: 5, m: 22, b: true, a: '07:20', l: '20:30' },
  { n: '宁波市镇海中学', st: 'senior', p: '浙江省', c: '宁波市', d: '镇海区', lat: 29.949, lng: 121.72, h: 12.0, w: 5.5, m: 24, b: true, a: '06:50', l: '21:40' },
  { n: '温州市第二高级中学', st: 'senior', p: '浙江省', c: '温州市', d: '鹿城区', lat: 28.01, lng: 120.66, h: 11.5, w: 6, m: 25, b: true, a: '06:55', l: '21:30' },
  { n: '杭州市学军中学', st: 'senior', p: '浙江省', c: '杭州市', d: '西湖区', lat: 30.272, lng: 120.13, h: 11.0, w: 5, m: 22, b: true, a: '07:10', l: '21:00' },
  // —— 山东 ——
  { n: '山东省实验中学', st: 'senior', p: '山东省', c: '济南市', d: '市中区', lat: 36.651, lng: 117.03, h: 11.5, w: 6, m: 25, b: true, a: '06:50', l: '21:30' },
  { n: '青岛市第二中学', st: 'senior', p: '山东省', c: '青岛市', d: '市南区', lat: 36.062, lng: 120.34, h: 11.0, w: 5, m: 22, b: true, a: '07:15', l: '21:00' },
  { n: '潍坊第一中学', st: 'senior', p: '山东省', c: '潍坊市', d: '奎文区', lat: 36.71, lng: 119.12, h: 12.5, w: 6, m: 26, b: true, a: '06:30', l: '22:10' },
  { n: '临沂第一中学', st: 'senior', p: '山东省', c: '临沂市', d: '兰山区', lat: 35.07, lng: 118.34, h: 12.5, w: 6, m: 26, b: true, a: '06:35', l: '22:00' },
  // —— 河南 ——
  { n: '郑州外国语学校', st: 'senior', p: '河南省', c: '郑州市', d: '中原区', lat: 34.746, lng: 113.61, h: 11.5, w: 6, m: 25, b: true, a: '07:00', l: '21:30' },
  { n: '河南省实验中学', st: 'senior', p: '河南省', c: '郑州市', d: '金水区', lat: 34.79, lng: 113.66, h: 11.0, w: 5.5, m: 24, b: true, a: '07:10', l: '21:00' },
  { n: '郸城县第一高级中学', st: 'senior', p: '河南省', c: '周口市', d: '郸城县', lat: 33.645, lng: 115.177, h: 13.0, w: 6.5, m: 28, b: true, a: '06:00', l: '22:30', r: '示例值：高强度县中模式' },
  { n: '南阳市第一中学', st: 'senior', p: '河南省', c: '南阳市', d: '宛城区', lat: 32.99, lng: 112.53, h: 12.0, w: 6, m: 26, b: true, a: '06:40', l: '22:00' },
  // —— 四川 / 重庆 ——
  { n: '成都市第七中学', st: 'senior', p: '四川省', c: '成都市', d: '武侯区', lat: 30.63, lng: 104.06, h: 11.0, w: 5, m: 22, b: true, a: '07:20', l: '21:00' },
  { n: '成都石室中学', st: 'senior', p: '四川省', c: '成都市', d: '青羊区', lat: 30.67, lng: 104.05, h: 10.5, w: 5, m: 21, b: false, a: '07:30', l: '18:30' },
  { n: '绵阳中学', st: 'senior', p: '四川省', c: '绵阳市', d: '涪城区', lat: 31.47, lng: 104.73, h: 12.5, w: 6, m: 26, b: true, a: '06:40', l: '22:00' },
  { n: '重庆市巴蜀中学', st: 'senior', p: '重庆市', c: '重庆市', d: '渝中区', lat: 29.556, lng: 106.546, h: 11.5, w: 5.5, m: 24, b: true, a: '07:10', l: '21:30' },
  { n: '重庆市第一中学', st: 'senior', p: '重庆市', c: '重庆市', d: '沙坪坝区', lat: 29.56, lng: 106.46, h: 11.0, w: 5, m: 22, b: true, a: '07:20', l: '21:00' },
  // —— 湖北 / 湖南 ——
  { n: '华中师范大学第一附属中学', st: 'senior', p: '湖北省', c: '武汉市', d: '洪山区', lat: 30.512, lng: 114.36, h: 11.0, w: 5, m: 22, b: true, a: '07:20', l: '21:00' },
  { n: '武汉市第二中学', st: 'senior', p: '湖北省', c: '武汉市', d: '江岸区', lat: 30.61, lng: 114.3, h: 10.5, w: 5, m: 21, b: false, a: '07:30', l: '18:30' },
  { n: '长沙市长郡中学', st: 'senior', p: '湖南省', c: '长沙市', d: '天心区', lat: 28.19, lng: 112.97, h: 11.5, w: 5.5, m: 24, b: true, a: '07:10', l: '21:30' },
  { n: '长沙市雅礼中学', st: 'senior', p: '湖南省', c: '长沙市', d: '雨花区', lat: 28.17, lng: 112.99, h: 11.0, w: 5, m: 22, b: true, a: '07:15', l: '21:00' },
  // —— 河北 / 山西 ——
  { n: '石家庄市第二中学', st: 'senior', p: '河北省', c: '石家庄市', d: '新华区', lat: 38.06, lng: 114.47, h: 12.0, w: 6, m: 26, b: true, a: '06:50', l: '22:00' },
  { n: '衡水第一中学', st: 'senior', p: '河北省', c: '衡水市', d: '桃城区', lat: 37.73, lng: 115.67, h: 13.5, w: 7, m: 30, b: true, a: '05:40', l: '22:30', r: '示例值：极端作息样本，月假制' },
  { n: '太原市第五中学', st: 'senior', p: '山西省', c: '太原市', d: '迎泽区', lat: 37.86, lng: 112.57, h: 11.5, w: 6, m: 25, b: true, a: '07:00', l: '21:30' },
  // —— 陕西 / 甘肃 / 新疆 / 西藏 / 宁夏 / 青海 / 内蒙 ——
  { n: '西安高新第一中学', st: 'senior', p: '陕西省', c: '西安市', d: '雁塔区', lat: 34.22, lng: 108.88, h: 11.5, w: 6, m: 25, b: true, a: '07:00', l: '21:30' },
  { n: '西北师范大学附属中学', st: 'senior', p: '甘肃省', c: '兰州市', d: '安宁区', lat: 36.1, lng: 103.72, h: 11.0, w: 5.5, m: 24, b: true, a: '07:10', l: '21:00' },
  { n: '乌鲁木齐市第一中学', st: 'senior', p: '新疆维吾尔自治区', c: '乌鲁木齐市', d: '天山区', lat: 43.796, lng: 87.62, h: 10.5, w: 5.5, m: 24, b: true, a: '09:00', l: '19:30', r: '示例值：新疆作息整体后移约 2 小时' },
  { n: '拉萨中学', st: 'senior', p: '西藏自治区', c: '拉萨市', d: '城关区', lat: 29.65, lng: 91.13, h: 9.5, w: 5.5, m: 24, b: true, a: '09:30', l: '19:00', r: '示例值：高原作息，含午休' },
  { n: '银川市第一中学', st: 'senior', p: '宁夏回族自治区', c: '银川市', d: '兴庆区', lat: 38.48, lng: 106.29, h: 11.0, w: 5.5, m: 24, b: true, a: '07:20', l: '21:00' },
  { n: '西宁市第五中学', st: 'senior', p: '青海省', c: '西宁市', d: '城西区', lat: 36.63, lng: 101.75, h: 11.0, w: 5.5, m: 24, b: true, a: '07:20', l: '21:00' },
  { n: '呼和浩特市第二中学', st: 'senior', p: '内蒙古自治区', c: '呼和浩特市', d: '新城区', lat: 40.85, lng: 111.69, h: 11.0, w: 5.5, m: 24, b: true, a: '07:20', l: '21:00' },
  // —— 东北 ——
  { n: '哈尔滨市第三中学', st: 'senior', p: '黑龙江省', c: '哈尔滨市', d: '南岗区', lat: 45.75, lng: 126.63, h: 10.5, w: 5.5, m: 24, b: true, a: '07:30', l: '20:30' },
  { n: '东北师范大学附属中学', st: 'senior', p: '吉林省', c: '长春市', d: '朝阳区', lat: 43.87, lng: 125.29, h: 11.0, w: 5.5, m: 24, b: true, a: '07:20', l: '21:00' },
  { n: '大连市第二十四中学', st: 'senior', p: '辽宁省', c: '大连市', d: '中山区', lat: 38.91, lng: 121.64, h: 10.5, w: 5, m: 22, b: false, a: '07:30', l: '18:30' },
  // —— 福建 / 安徽 / 江西 / 广西 / 云南 / 贵州 / 海南 ——
  { n: '福州第一中学', st: 'senior', p: '福建省', c: '福州市', d: '鼓楼区', lat: 26.08, lng: 119.29, h: 10.5, w: 5, m: 22, b: true, a: '07:30', l: '20:30' },
  { n: '厦门双十中学', st: 'senior', p: '福建省', c: '厦门市', d: '思明区', lat: 24.48, lng: 118.13, h: 11.0, w: 5, m: 22, b: true, a: '07:20', l: '21:00' },
  { n: '合肥市第一中学', st: 'senior', p: '安徽省', c: '合肥市', d: '包河区', lat: 31.79, lng: 117.3, h: 11.5, w: 6, m: 25, b: true, a: '07:00', l: '21:30' },
  { n: '江西师范大学附属中学', st: 'senior', p: '江西省', c: '南昌市', d: '青山湖区', lat: 28.68, lng: 115.93, h: 11.0, w: 5.5, m: 24, b: true, a: '07:10', l: '21:00' },
  { n: '南宁市第三中学', st: 'senior', p: '广西壮族自治区', c: '南宁市', d: '青秀区', lat: 22.81, lng: 108.36, h: 11.0, w: 5.5, m: 24, b: true, a: '07:15', l: '21:00' },
  { n: '云南师范大学附属中学', st: 'senior', p: '云南省', c: '昆明市', d: '五华区', lat: 25.05, lng: 102.69, h: 10.5, w: 5, m: 22, b: false, a: '07:40', l: '18:30' },
  { n: '贵阳市第一中学', st: 'senior', p: '贵州省', c: '贵阳市', d: '观山湖区', lat: 26.63, lng: 106.62, h: 11.5, w: 6, m: 25, b: true, a: '07:10', l: '21:30' },
  { n: '海南中学', st: 'senior', p: '海南省', c: '海口市', d: '琼山区', lat: 20.0, lng: 110.36, h: 11.0, w: 5.5, m: 24, b: true, a: '07:20', l: '21:00' },
]

const MOCK_BASE_TS = Date.parse('2025-09-01T08:00:00.000Z')

export const MOCK_SCHOOLS: School[] = SCHOOL_SEEDS.map((s, i) => {
  const boardingSchedule = s.b ? { arrive_time: s.a, leave_time: s.l } : null
  const daySchedule = s.b ? { arrive_time: '07:40', leave_time: '17:40' } : { arrive_time: s.a, leave_time: s.l }
  const created = new Date(MOCK_BASE_TS + i * 3_600_000).toISOString()
  return {
    id: `mock-school-${String(i + 1).padStart(3, '0')}`,
    name: s.n,
    stage: s.st,
    province: s.p,
    city: s.c,
    district: s.d,
    address: null,
    lat: s.lat,
    lng: s.lng,
    daily_hours: s.h,
    weekly_days: s.w,
    monthly_days: s.m,
    boarding: s.b,
    schedule_json: {
      arrive_time: s.a,
      leave_time: s.l,
      boarding_schedule: boardingSchedule,
      day_schedule: daySchedule,
    },
    remark: s.r ?? null,
    created_at: created,
    updated_at: created,
    version: 1,
    status: 'active',
  }
})

/* ------------------------------------------------------------------ */
/* 大学假期（示例校历，非真实数据）                                     */
/* ------------------------------------------------------------------ */

interface CollegeSeed {
  /** university_name */
  n: string
  p: string
  c: string
  lat: number
  lng: number
  /** 寒假起始 MM-DD */
  ws: string
  /** 寒假周数 */
  ww: number
  /** 暑假起始 MM-DD */
  ss: string
  /** 暑假周数 */
  sw: number
}

/**
 * 规律贴近现实：东北/华北高校寒假更长（6–7 周），华南/西南更短（4–5 周），
 * 暑假则大致相反。但具体日期纯属示例。
 */
const COLLEGE_SEEDS: CollegeSeed[] = [
  { n: '北京大学', p: '北京市', c: '北京市', lat: 39.992, lng: 116.306, ws: '01-13', ww: 6, ss: '07-01', sw: 8 },
  { n: '清华大学', p: '北京市', c: '北京市', lat: 40.0, lng: 116.326, ws: '01-13', ww: 6, ss: '07-01', sw: 8 },
  { n: '复旦大学', p: '上海市', c: '上海市', lat: 31.298, lng: 121.503, ws: '01-20', ww: 5, ss: '07-06', sw: 8 },
  { n: '上海交通大学', p: '上海市', c: '上海市', lat: 31.025, lng: 121.435, ws: '01-20', ww: 5, ss: '07-06', sw: 8 },
  { n: '浙江大学', p: '浙江省', c: '杭州市', lat: 30.263, lng: 120.12, ws: '01-20', ww: 5, ss: '07-06', sw: 8 },
  { n: '南京大学', p: '江苏省', c: '南京市', lat: 32.056, lng: 118.773, ws: '01-20', ww: 5, ss: '07-06', sw: 8 },
  { n: '中国科学技术大学', p: '安徽省', c: '合肥市', lat: 31.84, lng: 117.27, ws: '01-20', ww: 5, ss: '07-13', sw: 7 },
  { n: '武汉大学', p: '湖北省', c: '武汉市', lat: 30.54, lng: 114.36, ws: '01-13', ww: 6, ss: '07-06', sw: 8 },
  { n: '华中科技大学', p: '湖北省', c: '武汉市', lat: 30.51, lng: 114.42, ws: '01-13', ww: 6, ss: '07-06', sw: 8 },
  { n: '中山大学', p: '广东省', c: '广州市', lat: 23.097, lng: 113.298, ws: '01-20', ww: 5, ss: '07-13', sw: 7 },
  { n: '华南理工大学', p: '广东省', c: '广州市', lat: 23.154, lng: 113.347, ws: '01-20', ww: 5, ss: '07-13', sw: 7 },
  { n: '四川大学', p: '四川省', c: '成都市', lat: 30.63, lng: 104.08, ws: '01-20', ww: 5, ss: '07-13', sw: 7 },
  { n: '电子科技大学', p: '四川省', c: '成都市', lat: 30.75, lng: 103.93, ws: '01-20', ww: 5, ss: '07-13', sw: 7 },
  { n: '西安交通大学', p: '陕西省', c: '西安市', lat: 34.247, lng: 108.983, ws: '01-13', ww: 6, ss: '07-06', sw: 8 },
  { n: '西北工业大学', p: '陕西省', c: '西安市', lat: 34.032, lng: 108.76, ws: '01-13', ww: 6, ss: '07-06', sw: 8 },
  { n: '哈尔滨工业大学', p: '黑龙江省', c: '哈尔滨市', lat: 45.74, lng: 126.63, ws: '01-06', ww: 7, ss: '06-29', sw: 9 },
  { n: '吉林大学', p: '吉林省', c: '长春市', lat: 43.83, lng: 125.29, ws: '01-06', ww: 7, ss: '06-29', sw: 9 },
  { n: '大连理工大学', p: '辽宁省', c: '大连市', lat: 38.88, lng: 121.53, ws: '01-13', ww: 6, ss: '07-06', sw: 8 },
  { n: '山东大学', p: '山东省', c: '济南市', lat: 36.67, lng: 117.05, ws: '01-13', ww: 6, ss: '07-06', sw: 8 },
  { n: '厦门大学', p: '福建省', c: '厦门市', lat: 24.44, lng: 118.1, ws: '01-20', ww: 5, ss: '07-13', sw: 7 },
  { n: '中南大学', p: '湖南省', c: '长沙市', lat: 28.17, lng: 112.93, ws: '01-13', ww: 6, ss: '07-06', sw: 8 },
  { n: '湖南大学', p: '湖南省', c: '长沙市', lat: 28.18, lng: 112.94, ws: '01-13', ww: 6, ss: '07-06', sw: 8 },
  { n: '重庆大学', p: '重庆市', c: '重庆市', lat: 29.57, lng: 106.46, ws: '01-20', ww: 5, ss: '07-13', sw: 7 },
  { n: '兰州大学', p: '甘肃省', c: '兰州市', lat: 36.05, lng: 103.86, ws: '01-13', ww: 6, ss: '07-06', sw: 8 },
  { n: '郑州大学', p: '河南省', c: '郑州市', lat: 34.82, lng: 113.53, ws: '01-13', ww: 6, ss: '07-06', sw: 8 },
  { n: '云南大学', p: '云南省', c: '昆明市', lat: 25.05, lng: 102.7, ws: '01-20', ww: 5, ss: '07-13', sw: 7 },
  { n: '广西大学', p: '广西壮族自治区', c: '南宁市', lat: 22.84, lng: 108.29, ws: '01-20', ww: 5, ss: '07-13', sw: 7 },
  { n: '海南大学', p: '海南省', c: '海口市', lat: 20.06, lng: 110.33, ws: '01-20', ww: 5, ss: '07-13', sw: 7 },
  { n: '新疆大学', p: '新疆维吾尔自治区', c: '乌鲁木齐市', lat: 43.77, lng: 87.62, ws: '01-13', ww: 6, ss: '07-06', sw: 8 },
  { n: '西藏大学', p: '西藏自治区', c: '拉萨市', lat: 29.65, lng: 91.15, ws: '01-13', ww: 6, ss: '07-13', sw: 7 },
]

/** 生成假期记录的公历年份：覆盖 2025 与 2026 全年，保证任意“当天”都有数据可看 */
const HOLIDAY_YEARS = [2025, 2026]

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function inclusiveDays(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000,
  ) + 1
}

/**
 * 生成「一校一学年一行」的示例校历。
 *
 * 公历年份取 2025 与 2026，因此学年分别是 2024-2025 与 2025-2026，
 * 两者合起来覆盖了 2025、2026 全年 —— 无论「今天」是哪天，页面上都有数据可看。
 */
function buildCollegeHolidays(): CollegeHoliday[] {
  const out: CollegeHoliday[] = []
  let i = 0

  for (const year of HOLIDAY_YEARS) {
    const academicYear = `${year - 1}-${year}`
    for (const seed of COLLEGE_SEEDS) {
      const winterStart = `${year}-${seed.ws}`
      const winterEnd = addDays(winterStart, seed.ww * 7 - 1)
      const summerStart = `${year}-${seed.ss}`
      const summerEnd = addDays(summerStart, seed.sw * 7 - 1)

      out.push({
        id: `mock-calendar-${String(++i).padStart(4, '0')}`,
        university_name: seed.n,
        province: seed.p,
        city: seed.c,
        lat: seed.lat,
        lng: seed.lng,
        academic_year: academicYear,
        winter_start: winterStart,
        winter_end: winterEnd,
        summer_start: summerStart,
        summer_end: summerEnd,
        source_url: null,
        note: `示例校历：寒假约 ${seed.ww} 周（${inclusiveDays(winterStart, winterEnd)} 天），暑假约 ${seed.sw} 周（${inclusiveDays(summerStart, summerEnd)} 天）`,
        version: 1,
      })
    }
  }

  return out
}

export const MOCK_COLLEGE_HOLIDAYS: CollegeHoliday[] = buildCollegeHolidays()

/* ------------------------------------------------------------------ */
/* 节假日（用于大学放假页标注“今天是什么节”）                            */
/* ------------------------------------------------------------------ */

/**
 * 2025 年为国务院办公厅公布的法定节假日安排；
 * 2026 年为参考排布，**最终以国务院办公厅当年通知为准**，页面会标注“参考”。
 */
export const MOCK_HOLIDAYS: Holiday[] = [
  { date: '2025-01-01', name: '元旦', type: 'statutory' },
  { date: '2025-01-28', name: '除夕', type: 'traditional' },
  { date: '2025-01-29', name: '春节', type: 'statutory' },
  { date: '2025-04-04', name: '清明节', type: 'statutory' },
  { date: '2025-05-01', name: '劳动节', type: 'statutory' },
  { date: '2025-05-31', name: '端午节', type: 'statutory' },
  { date: '2025-10-01', name: '国庆节', type: 'statutory' },
  { date: '2025-10-06', name: '中秋节', type: 'statutory' },
  { date: '2026-01-01', name: '元旦（参考）', type: 'statutory' },
  { date: '2026-02-16', name: '除夕（参考）', type: 'traditional' },
  { date: '2026-02-17', name: '春节（参考）', type: 'statutory' },
  { date: '2026-04-05', name: '清明节（参考）', type: 'statutory' },
  { date: '2026-05-01', name: '劳动节（参考）', type: 'statutory' },
  { date: '2026-06-19', name: '端午节（参考）', type: 'statutory' },
  { date: '2026-09-25', name: '中秋节（参考）', type: 'statutory' },
  { date: '2026-10-01', name: '国庆节（参考）', type: 'statutory' },
]
