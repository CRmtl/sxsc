/**
 * zxssxsc 数据模型
 *
 * 与 supabase/schema.sql 中的表结构一一对应。
 * 命名遵循用户给定的数据模型；下划线字段名与数据库列名保持一致，
 * 便于 mock 数据与 Supabase 返回对象互换。
 */

/**
 * 学段。
 * 只保留初中 / 高中 / 其他 —— 本项目不收录小学数据。
 * 数据库层的 CHECK 约束与这里是同一套值，见 supabase/schema.sql。
 */
export type Stage = 'junior' | 'senior' | 'other'

export const STAGE_LABELS: Record<Stage, string> = {
  junior: '初中',
  senior: '高中',
  other: '其他',
}

export const STAGE_OPTIONS = Object.keys(STAGE_LABELS) as Stage[]

/**
 * 记录状态。
 * 历史遗留数据（例如已经不收录的小学）会被迁移脚本标为 deprecated，
 * 前端一律只展示 active，从而不必真的删数据。
 */
export type SchoolStatus = 'active' | 'deprecated'

/** 走读 / 住宿各自的上下学时间 */
export interface DaySchedule {
  /** 到校时间，HH:mm */
  arrive_time: string | null
  /** 离校时间，HH:mm */
  leave_time: string | null
}

export interface ScheduleJson {
  /** 主口径到校时间（表单必填项落到这里） */
  arrive_time: string | null
  /** 主口径离校时间 */
  leave_time: string | null
  /** 住宿生作息 */
  boarding_schedule: DaySchedule | null
  /** 走读生作息 */
  day_schedule: DaySchedule | null
}

/** 中学 */
export interface School {
  id: string
  name: string
  stage: Stage
  province: string
  city: string
  district: string
  address: string | null
  lat: number
  lng: number
  /** 每日在校时长（小时，含早晚自习），支持 1 位小数 */
  daily_hours: number
  /** 每周上学天数 */
  weekly_days: number
  /** 每月上学天数 */
  monthly_days: number
  /** 是否住宿制 */
  boarding: boolean
  schedule_json: ScheduleJson
  remark: string | null
  created_at: string
  updated_at: string
  /** 版本号，每次修改 +1 */
  version: number
  /** 记录状态；前端只展示 active */
  status: SchoolStatus
}

/**
 * 「带快照的版本记录」通用形状。
 * 学校与大学校历共用同一套版本历史语义（只增不改不删），
 * 前端的版本列表组件也据此泛化，不必写两份。
 */
export interface EntityRevision<S> {
  id: string
  /** 该快照对应的版本号（= 被这次修改覆盖掉的那一版） */
  version: number
  snapshot: S
  change_note: string | null
  created_at: string
}

/** 修改前快照，用于回滚 */
export interface SchoolRevision extends EntityRevision<School> {
  school_id: string
}

/** 假期窗口类型 */
export type HolidayWindowType = 'winter' | 'summer'

export const HOLIDAY_WINDOW_LABELS: Record<HolidayWindowType, string> = {
  winter: '寒假',
  summer: '暑假',
}

/**
 * 大学校历：**一校一学年一行**（宽表）。
 *
 * 为什么不是「一条假期一行」：现实中抓到的校历就是
 * 「某某大学 2025-2026 学年校历」这样一份文档，一校一年一份，
 * 里面同时写着寒假和暑假的起止。
 * 这样 (university_name, academic_year) 就是天然唯一键，
 * 重复导入同一所学校时可以直接 upsert，不会产生重复行。
 */
export interface CollegeHoliday {
  id: string
  university_name: string
  province: string
  city: string
  /** 需求给的模型未包含坐标，但地图着色必须有位置 —— 见 README「假设」 */
  lat: number
  lng: number
  /** 学年，如 2025-2026 */
  academic_year: string
  /** YYYY-MM-DD；未抓取到则留 null，前端按「未公布」处理 */
  winter_start: string | null
  winter_end: string | null
  summer_start: string | null
  summer_end: string | null
  /** 校历来源 URL */
  source_url: string | null
  note: string | null
  created_at?: string
  updated_at?: string
  /** 版本号，每次修改 +1 */
  version: number
}

/** 修改前快照，用于回滚大学校历 */
export interface CollegeHolidayRevision extends EntityRevision<CollegeHoliday> {
  holiday_id: string
}

/** 节假日/纪念日，用于大学放假页的“备注节日” */
export interface Holiday {
  date: string
  name: string
  type: 'statutory' | 'traditional' | 'school' | 'international' | 'other'
}

/** 大学在某一天的状态 */
export type CollegeStatus = 'before' | 'during' | 'after'

export const COLLEGE_STATUS_LABELS: Record<CollegeStatus, string> = {
  before: '未放假',
  during: '假期中',
  after: '已开学',
}

/** 提交表单载荷 */
export interface SchoolSubmission {
  name: string
  stage: Stage
  province: string
  city: string
  district: string
  address: string | null
  lat: number
  lng: number
  daily_hours: number
  weekly_days: number
  monthly_days: number
  boarding: boolean
  schedule_json: ScheduleJson
  remark: string | null
  /** 可选：提交到已有学校 id 表示“修改” */
  id?: string | null
  /** 反滥用：蜜罐字段，必须为空 */
  website?: string
  /** 反滥用：表单渲染时间戳（ms），用于时间陷阱 */
  form_loaded_at?: number
}

/** 统一 API 返回 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; field?: string }
