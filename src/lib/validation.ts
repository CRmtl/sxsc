/**
 * 提交校验。
 *
 * 这份规则与 supabase/schema.sql 里的 CHECK / WITH CHECK 约束**逐条对应**：
 * 客户端拦一遍是为了体验，服务端拦一遍是为了安全，
 * 数据库那一层是最后一道兜底（即使有人绕过 API 直接打 PostgREST）。
 */

import type { DaySchedule, SchoolSubmission, ScheduleJson, Stage } from './types'
// 显式 .ts 扩展名：scripts/calendar-to-sql.mjs 用 Node 直接 import 本文件，
// 而 Node 的 ESM 解析器不会像 webpack 那样补全扩展名。
import { STAGE_LABELS } from './types.ts'
import { isInsideChina } from './geo.ts'

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; field?: string }

const STAGES = new Set(Object.keys(STAGE_LABELS))
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const LIMITS = {
  nameMin: 2,
  nameMax: 80,
  areaMax: 30,
  addressMax: 120,
  remarkMax: 500,
  dailyHoursMin: 0,
  dailyHoursMax: 24,
  weeklyDaysMin: 1,
  weeklyDaysMax: 7,
  monthlyDaysMin: 1,
  monthlyDaysMax: 31,
  universityNameMax: 60,
  academicYearMax: 16,
  noteMax: 300,
  sourceMax: 300,
} as const

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function optStr(v: unknown, max: number): string | null {
  const s = str(v)
  if (!s) return null
  return s.slice(0, max)
}

function num(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') return Number(v)
  return NaN
}

function validateTime(v: unknown, field: string, required = false): ValidationResult<string | null> {
  const s = str(v)
  if (!s) {
    if (required) return { ok: false, error: '时间不能为空', field }
    return { ok: true, value: null }
  }
  if (!TIME_RE.test(s)) {
    return { ok: false, error: '时间格式应为 HH:mm（24 小时制）', field }
  }
  return { ok: true, value: s }
}

function validateSchedule(v: unknown, prefix: string): ValidationResult<DaySchedule | null> {
  if (v === null || v === undefined) return { ok: true, value: null }
  if (typeof v !== 'object') return { ok: false, error: '作息数据格式不正确', field: prefix }
  const obj = v as Record<string, unknown>
  const arrive = validateTime(obj.arrive_time, `${prefix}.arrive_time`)
  if (!arrive.ok) return arrive
  const leave = validateTime(obj.leave_time, `${prefix}.leave_time`)
  if (!leave.ok) return leave
  if (!arrive.value && !leave.value) return { ok: true, value: null }
  return { ok: true, value: { arrive_time: arrive.value, leave_time: leave.value } }
}

/** 校验并规范化「中学」提交载荷 */
export function validateSchoolSubmission(raw: unknown): ValidationResult<SchoolSubmission> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: '请求体格式不正确' }
  }
  const o = raw as Record<string, unknown>

  const name = str(o.name)
  if (name.length < LIMITS.nameMin || name.length > LIMITS.nameMax) {
    return {
      ok: false,
      error: `学校全名长度需在 ${LIMITS.nameMin}–${LIMITS.nameMax} 字之间`,
      field: 'name',
    }
  }
  if (/[<>]/.test(name)) {
    return { ok: false, error: '学校全名不能包含 < 或 >', field: 'name' }
  }

  const stage = str(o.stage) as Stage
  if (!STAGES.has(stage)) {
    return { ok: false, error: '请选择有效的学段', field: 'stage' }
  }

  const province = str(o.province)
  const city = str(o.city)
  const district = str(o.district)
  for (const [label, val, field] of [
    ['省份', province, 'province'],
    ['城市', city, 'city'],
    ['区县', district, 'district'],
  ] as const) {
    if (!val) return { ok: false, error: `${label}不能为空`, field }
    if (val.length > LIMITS.areaMax) {
      return { ok: false, error: `${label}名称过长`, field }
    }
  }

  const lat = num(o.lat)
  const lng = num(o.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: '请在地图上选点以确定经纬度', field: 'lat' }
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, error: '经纬度超出有效范围', field: 'lat' }
  }
  if (!isInsideChina(lat, lng)) {
    return {
      ok: false,
      error: '选点超出了中国范围，请重新在地图上选点',
      field: 'lat',
    }
  }

  const dailyHours = num(o.daily_hours)
  if (
    !Number.isFinite(dailyHours) ||
    dailyHours < LIMITS.dailyHoursMin ||
    dailyHours > LIMITS.dailyHoursMax
  ) {
    return { ok: false, error: '每日上学时长需在 0–24 小时之间', field: 'daily_hours' }
  }

  const weeklyDays = num(o.weekly_days)
  if (
    !Number.isFinite(weeklyDays) ||
    weeklyDays < LIMITS.weeklyDaysMin ||
    weeklyDays > LIMITS.weeklyDaysMax
  ) {
    return { ok: false, error: '每周上学天数需在 1–7 之间', field: 'weekly_days' }
  }

  const monthlyDays = num(o.monthly_days)
  if (
    !Number.isFinite(monthlyDays) ||
    monthlyDays < LIMITS.monthlyDaysMin ||
    monthlyDays > LIMITS.monthlyDaysMax
  ) {
    return { ok: false, error: '每月上学天数需在 1–31 之间', field: 'monthly_days' }
  }

  const boarding = o.boarding === true || o.boarding === 'true' || o.boarding === 'on'

  const sjRaw = (o.schedule_json ?? {}) as Record<string, unknown>
  const arrive = validateTime(sjRaw.arrive_time, 'schedule_json.arrive_time')
  if (!arrive.ok) return arrive
  const leave = validateTime(sjRaw.leave_time, 'schedule_json.leave_time')
  if (!leave.ok) return leave
  const boardingSchedule = validateSchedule(
    sjRaw.boarding_schedule,
    'schedule_json.boarding_schedule',
  )
  if (!boardingSchedule.ok) return boardingSchedule
  const daySchedule = validateSchedule(sjRaw.day_schedule, 'schedule_json.day_schedule')
  if (!daySchedule.ok) return daySchedule

  const schedule_json: ScheduleJson = {
    arrive_time: arrive.value,
    leave_time: leave.value,
    boarding_schedule: boardingSchedule.value,
    day_schedule: daySchedule.value,
  }

  const remark = optStr(o.remark, LIMITS.remarkMax)

  const id = str(o.id) || null

  return {
    ok: true,
    value: {
      id,
      name,
      stage,
      province,
      city,
      district,
      address: optStr(o.address, LIMITS.addressMax),
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      daily_hours: Math.round(dailyHours * 10) / 10,
      weekly_days: Math.round(weeklyDays * 10) / 10,
      monthly_days: Math.round(monthlyDays),
      boarding,
      schedule_json,
      remark,
    },
  }
}

/* ------------------------------------------------------------------ */
/* 大学校历（一校一学年一行）                                          */
/* ------------------------------------------------------------------ */

export interface CollegeHolidaySubmission {
  id?: string | null
  university_name: string
  province: string
  city: string
  lat: number
  lng: number
  academic_year: string
  winter_start: string | null
  winter_end: string | null
  summer_start: string | null
  summer_end: string | null
  source_url: string | null
  note: string | null
}

export function daysInclusive(start: string, end: string): number {
  return (
    Math.round(
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000,
    ) + 1
  )
}

/**
 * 校验一对起止日期。
 * 允许两个都留空（表示该假期没抓到），但不允许只填一个 ——
 * 半截区间在页面上只会变成误导。
 */
function validateDatePair(
  startRaw: unknown,
  endRaw: unknown,
  label: string,
  startField: string,
  endField: string,
): ValidationResult<{ start: string | null; end: string | null }> {
  const start = str(startRaw)
  const end = str(endRaw)

  if (!start && !end) return { ok: true, value: { start: null, end: null } }
  if (!start || !end) {
    return {
      ok: false,
      error: `${label}的开始与结束日期要么都填，要么都留空`,
      field: start ? endField : startField,
    }
  }
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return { ok: false, error: `${label}日期格式应为 YYYY-MM-DD`, field: startField }
  }
  if (end < start) {
    return { ok: false, error: `${label}的结束日期不能早于开始日期`, field: endField }
  }
  const days = daysInclusive(start, end)
  if (days > 200) {
    return { ok: false, error: `${label}天数异常（${days} 天，超过 200）`, field: endField }
  }
  return { ok: true, value: { start, end } }
}

export function validateCollegeHoliday(
  raw: unknown,
): ValidationResult<CollegeHolidaySubmission> {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: '请求体格式不正确' }
  }
  const o = raw as Record<string, unknown>

  const university_name = str(o.university_name)
  if (
    university_name.length < LIMITS.nameMin ||
    university_name.length > LIMITS.universityNameMax
  ) {
    return { ok: false, error: '大学名称长度不合法', field: 'university_name' }
  }
  if (/[<>]/.test(university_name)) {
    return { ok: false, error: '大学名称不能包含 < 或 >', field: 'university_name' }
  }

  const province = str(o.province)
  const city = str(o.city)
  if (!province || !city) {
    return { ok: false, error: '省份与城市不能为空', field: 'province' }
  }

  const lat = num(o.lat)
  const lng = num(o.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !isInsideChina(lat, lng)) {
    return { ok: false, error: '请在地图上选点以确定经纬度', field: 'lat' }
  }

  const academic_year = str(o.academic_year)
  if (!academic_year || academic_year.length > LIMITS.academicYearMax) {
    return { ok: false, error: '请填写学年，例如 2025-2026', field: 'academic_year' }
  }
  if (!/^\d{4}-\d{4}$/.test(academic_year)) {
    return { ok: false, error: '学年格式应为 YYYY-YYYY，例如 2025-2026', field: 'academic_year' }
  }

  const winter = validateDatePair(
    o.winter_start,
    o.winter_end,
    '寒假',
    'winter_start',
    'winter_end',
  )
  if (!winter.ok) return winter
  const summer = validateDatePair(
    o.summer_start,
    o.summer_end,
    '暑假',
    'summer_start',
    'summer_end',
  )
  if (!summer.ok) return summer

  // 至少要有一个完整窗口，否则这条记录在页面上没有任何可展示的信息
  if (!winter.value.start && !summer.value.start) {
    return {
      ok: false,
      error: '寒假和暑假至少要填写一个完整的起止区间',
      field: 'winter_start',
    }
  }

  const sourceUrl = optStr(o.source_url, LIMITS.sourceMax)
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
    return {
      ok: false,
      error: '校历来源需要是 http/https 开头的完整网址，或留空',
      field: 'source_url',
    }
  }

  return {
    ok: true,
    value: {
      id: str(o.id) || null,
      university_name,
      province,
      city,
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      academic_year,
      winter_start: winter.value.start,
      winter_end: winter.value.end,
      summer_start: summer.value.start,
      summer_end: summer.value.end,
      source_url: sourceUrl,
      note: optStr(o.note, LIMITS.noteMax),
    },
  }
}
