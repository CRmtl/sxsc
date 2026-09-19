/**
 * 日期 / 假期工具。
 */

import type { CollegeHoliday, CollegeStatus, Holiday, HolidayWindowType } from './types'

/** Date -> YYYY-MM-DD（按本地时区，因为用户看到的是“他所在的那一天”） */
export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** YYYY-MM-DD -> 当天 00:00 的本地 Date */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/* ------------------------------------------------------------------ */
/* 大学校历：一校一学年一行，一行里含寒假与暑假两个窗口                  */
/* ------------------------------------------------------------------ */

export interface HolidayWindow {
  type: HolidayWindowType
  /** YYYY-MM-DD */
  start: string
  /** YYYY-MM-DD，含首尾 */
  end: string
  /** 含首尾的天数 */
  days: number
}

/**
 * 取出一条校历记录里所有**有效**的假期窗口。
 * 起止日期必须都填了、且 end >= start 才算数 ——
 * 抓取时经常只拿到「寒假自 1 月 19 日起」这种半截信息，不能当成完整窗口。
 */
export function windowsOf(c: CollegeHoliday): HolidayWindow[] {
  const out: HolidayWindow[] = []
  if (c.winter_start && c.winter_end && c.winter_end >= c.winter_start) {
    out.push({
      type: 'winter',
      start: c.winter_start,
      end: c.winter_end,
      days: daysBetween(c.winter_start, c.winter_end) + 1,
    })
  }
  if (c.summer_start && c.summer_end && c.summer_end >= c.summer_start) {
    out.push({
      type: 'summer',
      start: c.summer_start,
      end: c.summer_end,
      days: daysBetween(c.summer_start, c.summer_end) + 1,
    })
  }
  return out.sort((a, b) => a.start.localeCompare(b.start))
}

export interface CollegeDayState {
  status: CollegeStatus
  /** 命中或时间上最接近当天的那个窗口 */
  window: HolidayWindow | null
  /** before 时 = 距放假天数（正）；其余为负/0 */
  daysToStart: number
  /** during 时 = 距开学天数（正）；其余为负/0 */
  daysToEnd: number
}

/**
 * 某条校历记录在指定日期的状态。
 *
 * 三态语义（与配色对应）：
 *   before 未放假 —— 当天在下一个假期开始之前
 *   during 假期中 —— 当天落在寒假或暑假区间内
 *   after  已开学 —— 当天在最后一个假期结束之后
 */
export function collegeDayState(c: CollegeHoliday, dateKey: string): CollegeDayState {
  const ws = windowsOf(c)
  if (ws.length === 0) {
    return { status: 'after', window: null, daysToStart: 0, daysToEnd: 0 }
  }

  const during = ws.find((w) => dateKey >= w.start && dateKey <= w.end)
  if (during) {
    return {
      status: 'during',
      window: during,
      daysToStart: daysBetween(dateKey, during.start),
      daysToEnd: daysBetween(dateKey, during.end),
    }
  }

  const upcoming = ws.find((w) => w.start > dateKey)
  if (upcoming) {
    return {
      status: 'before',
      window: upcoming,
      daysToStart: daysBetween(dateKey, upcoming.start),
      daysToEnd: daysBetween(dateKey, upcoming.end),
    }
  }

  const past = ws[ws.length - 1]
  return {
    status: 'after',
    window: past,
    daysToStart: daysBetween(dateKey, past.start),
    daysToEnd: daysBetween(dateKey, past.end),
  }
}

/** 到最近窗口边界的距离（天），当天在假期内则为 0；用于挑选最相关的学年 */
function distanceToDate(c: CollegeHoliday, dateKey: string): number {
  const ws = windowsOf(c)
  if (ws.length === 0) return Number.POSITIVE_INFINITY
  const t = Date.parse(`${dateKey}T00:00:00Z`)
  let min = Number.POSITIVE_INFINITY
  for (const w of ws) {
    if (dateKey >= w.start && dateKey <= w.end) return 0
    min = Math.min(
      min,
      Math.abs(Date.parse(`${w.start}T00:00:00Z`) - t),
      Math.abs(Date.parse(`${w.end}T00:00:00Z`) - t),
    )
  }
  return min
}

/** 按大学归组：每所大学在某天的状态 */
export interface CollegeGroup {
  key: string
  university_name: string
  province: string
  city: string
  lat: number
  lng: number
  status: CollegeStatus
  /** 命中或最相关的学年记录 */
  current: CollegeHoliday
  /** current 里命中/最近的假期窗口 */
  window: HolidayWindow | null
  daysToStart: number
  daysToEnd: number
  /** 该校全部学年记录，按学年升序 */
  all: CollegeHoliday[]
}

export function groupByUniversity(holidays: CollegeHoliday[], dateKey: string): CollegeGroup[] {
  const byUni = new Map<string, CollegeHoliday[]>()
  for (const h of holidays) {
    const arr = byUni.get(h.university_name)
    if (arr) arr.push(h)
    else byUni.set(h.university_name, [h])
  }

  const groups: CollegeGroup[] = []
  for (const [name, all] of byUni) {
    const sorted = [...all].sort((a, b) => a.academic_year.localeCompare(b.academic_year))

    // 选「最相关」的那一学年：正在放假的优先，其次是与当天时间距离最近的。
    // 距离取窗口起止边界的最小值，这样学期间隙里也会落到相邻的学年上，
    // 而不会因为「跨年排序」选到一个毫无关系的学年。
    let best = sorted[0]
    let bestState = collegeDayState(best, dateKey)
    let bestRank = bestState.status === 'during' ? 0 : 1
    let bestDist = distanceToDate(best, dateKey)

    for (const c of sorted.slice(1)) {
      const st = collegeDayState(c, dateKey)
      const rank = st.status === 'during' ? 0 : 1
      const dist = distanceToDate(c, dateKey)
      if (rank < bestRank || (rank === bestRank && dist < bestDist)) {
        best = c
        bestState = st
        bestRank = rank
        bestDist = dist
      }
    }

    groups.push({
      key: name,
      university_name: name,
      province: best.province,
      city: best.city,
      lat: best.lat,
      lng: best.lng,
      status: bestState.status,
      current: best,
      window: bestState.window,
      daysToStart: bestState.daysToStart,
      daysToEnd: bestState.daysToEnd,
      all: sorted,
    })
  }

  return groups.sort((a, b) => a.university_name.localeCompare(b.university_name, 'zh-Hans-CN'))
}

/** 查某天的节日/纪念日 */
export function holidayOn(holidays: Holiday[], dateKey: string): Holiday | null {
  return holidays.find((h) => h.date === dateKey) ?? null
}

/** “1 月 5 日 星期一” 这类中文日期 */
export function formatChineseDate(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date)
}

/** HH:mm:ss */
export function formatClock(date: Date, withSeconds = true): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  }).format(date)
}

/** 本地时区描述，例如 UTC+08:00（中国标准时间） */
export function describeTimezone(date: Date): string {
  const offsetMin = -date.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const hh = String(Math.floor(abs / 60)).padStart(2, '0')
  const mm = String(abs % 60).padStart(2, '0')
  let zoneName = ''
  try {
    zoneName = Intl.DateTimeFormat('zh-CN', { timeZoneName: 'long' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value ?? ''
  } catch {
    zoneName = ''
  }
  return `UTC${sign}${hh}:${mm}${zoneName ? `（${zoneName}）` : ''}`
}

/** 把小时偏移量格式化成 +3.25h / −12h 这种形式 */
export function formatHourOffset(hours: number): string {
  if (Math.abs(hours) < 1e-9) return '0h（当前）'
  const sign = hours > 0 ? '+' : '−'
  const abs = Math.abs(hours)
  const h = Math.floor(abs)
  const m = Math.round((abs - h) * 60)
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h${String(m).padStart(2, '0')}m`
}

/** 时间偏移后的日期时间（可跨天） */
export function shiftDate(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 3_600_000)
}

/** 两个日期相差天数（本地口径） */
export function daysBetween(aKey: string, bKey: string): number {
  return Math.round(
    (Date.parse(`${bKey}T00:00:00Z`) - Date.parse(`${aKey}T00:00:00Z`)) / 86400000,
  )
}
