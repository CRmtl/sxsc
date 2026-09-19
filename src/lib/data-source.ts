/**
 * 数据层抽象：**同一份代码，mock 与 Supabase 双模式**。
 *
 * - 未配置 Supabase 环境变量：落到 mock-data.ts，提交写入进程内存储，
 *   开箱即可跑通全部交互（含新增/修改/版本历史）。
 * - 配置了 Supabase：自动切到真实读写，API 形状完全一致。
 *
 * 这样「先用 mock 数据跑通，再接入 Supabase」不需要改任何页面代码。
 */

import {
  MOCK_COLLEGE_HOLIDAYS,
  MOCK_HOLIDAYS,
  MOCK_SCHOOLS,
} from './mock-data'
import type {
  CollegeHoliday,
  CollegeHolidayRevision,
  Holiday,
  School,
  SchoolRevision,
  SchoolSubmission,
} from './types'
import type { CollegeHolidaySubmission } from './validation'
import { getSupabase, getSupabaseAdmin, selectAll, supabaseConfigured } from './supabase'

export type DataMode = 'mock' | 'supabase'

export function getDataMode(): DataMode {
  return supabaseConfigured() ? 'supabase' : 'mock'
}

export class DataError extends Error {
  code: string
  constructor(message: string, code = 'data_error') {
    super(message)
    this.code = code
  }
}

export interface SubmitOutcome {
  school: School
  created: boolean
  /** 本次修改留下的前一版版本号（新增时为 null） */
  previousVersion: number | null
}

export interface Store {
  listSchools(): Promise<School[]>
  getSchool(id: string): Promise<School | null>
  listRevisions(schoolId: string): Promise<SchoolRevision[]>
  submitSchool(sub: SchoolSubmission): Promise<SubmitOutcome>
  rollbackSchool(schoolId: string, version: number): Promise<School>
  listCollegeHolidays(): Promise<CollegeHoliday[]>
  getCollegeHoliday(id: string): Promise<CollegeHoliday | null>
  listCollegeHolidayRevisions(id: string): Promise<CollegeHolidayRevision[]>
  submitCollegeCalendar(sub: CollegeHolidaySubmission): Promise<{
    holiday: CollegeHoliday
    created: boolean
  }>
  rollbackCollegeHoliday(id: string, version: number): Promise<CollegeHoliday>
  listHolidays(): Promise<Holiday[]>
}

/* ================================================================== */
/* mock 实现                                                           */
/* ================================================================== */

interface MockDb {
  schools: School[]
  revisions: SchoolRevision[]
  collegeHolidays: CollegeHoliday[]
  /** 大学校历的修改前快照 */
  collegeRevisions: CollegeHolidayRevision[]
  holidays: Holiday[]
}

/**
 * 挂在 globalThis 上，避免 Next.js 开发模式的模块热替换把用户
 * 在本次会话里提交的数据清空。
 */
const globalForMock = globalThis as unknown as { __zxssxscMockDb?: MockDb }

function mockDb(): MockDb {
  if (!globalForMock.__zxssxscMockDb) {
    globalForMock.__zxssxscMockDb = {
      schools: structuredClone(MOCK_SCHOOLS),
      revisions: [],
      collegeHolidays: structuredClone(MOCK_COLLEGE_HOLIDAYS),
      collegeRevisions: [],
      holidays: structuredClone(MOCK_HOLIDAYS),
    }
  }
  return globalForMock.__zxssxscMockDb
}

const mockStore: Store = {
  async listSchools() {
    // 与 supabaseStore 对齐：只吐 active。
    // 这里不做「只靠数据已经干净」的假设，读路径统一过滤才不会漏。
    return mockDb().schools.filter((s) => s.status !== 'deprecated')
  },

  async getSchool(id) {
    const found = mockDb().schools.find((s) => s.id === id)
    if (!found || found.status === 'deprecated') return null
    return found
  },

  async listRevisions(schoolId) {
    return mockDb()
      .revisions.filter((r) => r.school_id === schoolId)
      .sort((a, b) => b.version - a.version)
  },

  async submitSchool(sub) {
    const db = mockDb()
    const now = new Date().toISOString()

    if (sub.id) {
      const idx = db.schools.findIndex((s) => s.id === sub.id)
      if (idx === -1) {
        throw new DataError('要修改的学校不存在，可能已被删除。请重新搜索。', 'not_found')
      }
      const before = db.schools[idx]
      // 保留修改前快照（第一层版本历史）
      db.revisions.push({
        id: `mock-rev-${db.revisions.length + 1}`,
        school_id: before.id,
        version: before.version,
        snapshot: structuredClone(before),
        change_note: null,
        created_at: now,
      })
      const updated: School = {
        ...before,
        name: sub.name,
        stage: sub.stage,
        province: sub.province,
        city: sub.city,
        district: sub.district,
        address: sub.address,
        lat: sub.lat,
        lng: sub.lng,
        daily_hours: sub.daily_hours,
        weekly_days: sub.weekly_days,
        monthly_days: sub.monthly_days,
        boarding: sub.boarding,
        schedule_json: sub.schedule_json,
        remark: sub.remark,
        updated_at: now,
        version: before.version + 1,
      }
      db.schools[idx] = updated
      return { school: updated, created: false, previousVersion: before.version }
    }

    const created: School = {
      id: `local-${crypto.randomUUID()}`,
      name: sub.name,
      stage: sub.stage,
      province: sub.province,
      city: sub.city,
      district: sub.district,
      address: sub.address,
      lat: sub.lat,
      lng: sub.lng,
      daily_hours: sub.daily_hours,
      weekly_days: sub.weekly_days,
      monthly_days: sub.monthly_days,
      boarding: sub.boarding,
      schedule_json: sub.schedule_json,
      remark: sub.remark,
      created_at: now,
      updated_at: now,
      version: 1,
      status: 'active',
    }
    db.schools.push(created)
    return { school: created, created: true, previousVersion: null }
  },

  async rollbackSchool(schoolId, version) {
    const db = mockDb()
    const rev = db.revisions.find((r) => r.school_id === schoolId && r.version === version)
    if (!rev) throw new DataError('找不到该版本快照', 'not_found')
    const idx = db.schools.findIndex((s) => s.id === schoolId)
    if (idx === -1) throw new DataError('学校不存在', 'not_found')
    const now = new Date().toISOString()
    const before = db.schools[idx]
    db.revisions.push({
      id: `mock-rev-${db.revisions.length + 1}`,
      school_id: schoolId,
      version: before.version,
      snapshot: structuredClone(before),
      change_note: `回滚到 v${version}`,
      created_at: now,
    })
    const restored: School = {
      ...structuredClone(rev.snapshot),
      updated_at: now,
      version: before.version + 1,
    }
    db.schools[idx] = restored
    return restored
  },

  async listCollegeHolidays() {
    return [...mockDb().collegeHolidays]
  },

  async getCollegeHoliday(id) {
    return mockDb().collegeHolidays.find((h) => h.id === id) ?? null
  },

  async listCollegeHolidayRevisions(id) {
    return mockDb()
      .collegeRevisions.filter((r) => r.holiday_id === id)
      .sort((a, b) => b.version - a.version)
  },

  async submitCollegeCalendar(sub) {
    return submitCollegeHolidayImpl(sub)
  },

  async rollbackCollegeHoliday(id, version) {
    const db = mockDb()
    const rev = db.collegeRevisions.find((r) => r.holiday_id === id && r.version === version)
    if (!rev) throw new DataError('找不到该版本快照', 'not_found')
    const idx = db.collegeHolidays.findIndex((h) => h.id === id)
    if (idx === -1) throw new DataError('校历记录不存在', 'not_found')

    const now = new Date().toISOString()
    const before = db.collegeHolidays[idx]
    // 与学校回滚一致：先把当前版本存成新快照，因此回滚之后仍可再回滚回来
    db.collegeRevisions.push({
      id: `mock-crev-${db.collegeRevisions.length + 1}`,
      holiday_id: id,
      version: before.version,
      snapshot: structuredClone(before),
      change_note: `回滚到 v${version}`,
      created_at: now,
    })
    const restored: CollegeHoliday = {
      ...structuredClone(rev.snapshot),
      updated_at: now,
      version: before.version + 1,
    }
    db.collegeHolidays[idx] = restored
    return restored
  },

  async listHolidays() {
    return [...mockDb().holidays]
  },
}

/* ================================================================== */
/* Supabase 实现                                                       */
/* ================================================================== */

const supabaseStore: Store = {
  async listSchools() {
    const client = getSupabase()
    if (!client) throw new DataError('Supabase 未配置', 'not_configured')
    return selectAll<School>(client, 'schools', {
      order: 'created_at',
      filter: { column: 'status', value: 'active' },
    })
  },

  async getSchool(id) {
    const client = getSupabase()
    if (!client) throw new DataError('Supabase 未配置', 'not_configured')
    const { data, error } = await client
      .from('schools')
      .select('*')
      .eq('id', id)
      // 已弃用的记录（如历史遗留的小学数据）不再对外可见
      .eq('status', 'active')
      .maybeSingle()
    if (error) throw new DataError(`读取学校失败：${error.message}`)
    return (data as School) ?? null
  },

  async listRevisions(schoolId) {
    const client = getSupabase()
    if (!client) throw new DataError('Supabase 未配置', 'not_configured')
    const { data, error } = await client
      .from('school_revisions')
      .select('*')
      .eq('school_id', schoolId)
      .order('version', { ascending: false })
      .limit(50)
    if (error) throw new DataError(`读取版本历史失败：${error.message}`)
    return (data ?? []) as SchoolRevision[]
  },

  async submitSchool(sub) {
    const client = getSupabase()
    if (!client) throw new DataError('Supabase 未配置', 'not_configured')
    const now = new Date().toISOString()

    if (sub.id) {
      const { data: existing, error: readErr } = await client
        .from('schools')
        .select('*')
        .eq('id', sub.id)
        .maybeSingle()
      if (readErr) throw new DataError(`读取原数据失败：${readErr.message}`)
      if (!existing) {
        throw new DataError('要修改的学校不存在，可能已被删除。请重新搜索。', 'not_found')
      }
      const before = existing as School

      // 版本快照：优先用 service_role 写（访客无法伪造历史）
      const revisionClient = getSupabaseAdmin() ?? client
      const { error: revErr } = await revisionClient.from('school_revisions').insert({
        school_id: before.id,
        version: before.version,
        snapshot: before,
      })
      if (revErr) throw new DataError(`写入版本快照失败：${revErr.message}`)

      const { data: updated, error: upErr } = await client
        .from('schools')
        .update({
          name: sub.name,
          stage: sub.stage,
          province: sub.province,
          city: sub.city,
          district: sub.district,
          address: sub.address,
          lat: sub.lat,
          lng: sub.lng,
          daily_hours: sub.daily_hours,
          weekly_days: sub.weekly_days,
          monthly_days: sub.monthly_days,
          boarding: sub.boarding,
          schedule_json: sub.schedule_json,
          remark: sub.remark,
          updated_at: now,
          version: before.version + 1,
        })
        .eq('id', before.id)
        .select('*')
        .single()

      if (upErr) throw new DataError(`保存失败：${upErr.message}`)
      return {
        school: updated as School,
        created: false,
        previousVersion: before.version,
      }
    }

    const { data: created, error } = await client
      .from('schools')
      .insert({
        name: sub.name,
        stage: sub.stage,
        province: sub.province,
        city: sub.city,
        district: sub.district,
        address: sub.address,
        lat: sub.lat,
        lng: sub.lng,
        daily_hours: sub.daily_hours,
        weekly_days: sub.weekly_days,
        monthly_days: sub.monthly_days,
        boarding: sub.boarding,
        schedule_json: sub.schedule_json,
        remark: sub.remark,
        version: 1,
        status: 'active',
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single()

    if (error) throw new DataError(`新增失败：${error.message}`)
    return { school: created as School, created: true, previousVersion: null }
  },

  async rollbackSchool(schoolId, version) {
    const client = getSupabase()
    if (!client) throw new DataError('Supabase 未配置', 'not_configured')
    const { data: rev, error: revErr } = await client
      .from('school_revisions')
      .select('*')
      .eq('school_id', schoolId)
      .eq('version', version)
      .maybeSingle()
    if (revErr) throw new DataError(`读取快照失败：${revErr.message}`)
    if (!rev) throw new DataError('找不到该版本快照', 'not_found')

    const { data: current, error: curErr } = await client
      .from('schools')
      .select('*')
      .eq('id', schoolId)
      .maybeSingle()
    if (curErr) throw new DataError(`读取当前数据失败：${curErr.message}`)
    if (!current) throw new DataError('学校不存在', 'not_found')

    const now = new Date().toISOString()
    const snapshot = (rev as SchoolRevision).snapshot

    const revisionClient = getSupabaseAdmin() ?? client
    await revisionClient.from('school_revisions').insert({
      school_id: schoolId,
      version: (current as School).version,
      snapshot: current,
      change_note: `回滚到 v${version}`,
    })

    const { id: _ignoredId, created_at: _ignoredCreated, ...restorable } = snapshot as School
    const { data: restored, error: resErr } = await client
      .from('schools')
      .update({
        ...restorable,
        updated_at: now,
        version: (current as School).version + 1,
      })
      .eq('id', schoolId)
      .select('*')
      .single()
    if (resErr) throw new DataError(`回滚失败：${resErr.message}`)
    return restored as School
  },

  async listCollegeHolidays() {
    const client = getSupabase()
    if (!client) throw new DataError('Supabase 未配置', 'not_configured')
    // 注意别按 start_date 排 —— 宽表结构里没有这一列了，PostgREST 会直接报错。
    return selectAll<CollegeHoliday>(client, 'college_holidays', {
      order: 'university_name',
    })
  },

  async getCollegeHoliday(id) {
    const client = getSupabase()
    if (!client) throw new DataError('Supabase 未配置', 'not_configured')
    const { data, error } = await client
      .from('college_holidays')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new DataError(`读取校历失败：${error.message}`)
    return (data as CollegeHoliday) ?? null
  },

  async listCollegeHolidayRevisions(id) {
    const client = getSupabase()
    if (!client) throw new DataError('Supabase 未配置', 'not_configured')
    const { data, error } = await client
      .from('college_holiday_revisions')
      .select('*')
      .eq('holiday_id', id)
      .order('version', { ascending: false })
      .limit(50)
    if (error) throw new DataError(`读取校历版本历史失败：${error.message}`)
    return (data ?? []) as CollegeHolidayRevision[]
  },

  async submitCollegeCalendar(sub) {
    return submitCollegeHolidayImpl(sub)
  },

  async rollbackCollegeHoliday(id, version) {
    const client = getSupabase()
    if (!client) throw new DataError('Supabase 未配置', 'not_configured')

    const { data: rev, error: revErr } = await client
      .from('college_holiday_revisions')
      .select('*')
      .eq('holiday_id', id)
      .eq('version', version)
      .maybeSingle()
    if (revErr) throw new DataError(`读取快照失败：${revErr.message}`)
    if (!rev) throw new DataError('找不到该版本快照', 'not_found')

    const { data: current, error: curErr } = await client
      .from('college_holidays')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (curErr) throw new DataError(`读取当前校历失败：${curErr.message}`)
    if (!current) throw new DataError('校历记录不存在', 'not_found')

    const now = new Date().toISOString()
    const snapshot = (rev as CollegeHolidayRevision).snapshot

    const revisionClient = getSupabaseAdmin() ?? client
    await revisionClient.from('college_holiday_revisions').insert({
      holiday_id: id,
      version: (current as CollegeHoliday).version,
      snapshot: current,
      change_note: `回滚到 v${version}`,
    })

    // id / created_at / updated_at / version 不能从快照里覆盖回来
    const {
      id: _ignoredId,
      created_at: _ignoredCreated,
      updated_at: _ignoredUpdated,
      version: _ignoredVersion,
      ...restorable
    } = snapshot as CollegeHoliday
    const { data: restored, error: resErr } = await client
      .from('college_holidays')
      .update({
        ...restorable,
        updated_at: now,
        version: (current as CollegeHoliday).version + 1,
      })
      .eq('id', id)
      .select('*')
      .single()
    if (resErr) throw new DataError(`回滚失败：${resErr.message}`)
    return restored as CollegeHoliday
  },

  async listHolidays() {
    const client = getSupabase()
    if (!client) throw new DataError('Supabase 未配置', 'not_configured')
    return selectAll<Holiday>(client, 'holidays', { order: 'date' })
  },
}

/* ================================================================== */
/* 对外入口                                                            */
/* ================================================================== */

export function getStore(): Store {
  return getDataMode() === 'supabase' ? supabaseStore : mockStore
}

/**
 * 大学校历的新增/修改的共用实现。
 *
 * 与学校走同一套模式：修改前先把旧行整体存进 college_holiday_revisions
 * 做快照，再把 version +1，出问题可以按版本回滚。
 *
 * mock 侧还会按 (university_name, academic_year) 去重 —— 一个学校一个学年
 * 只应有一行，重复导入同一份校历不该产生第二行。
 *
 * 不直接对外暴露：mock / Supabase 两侧的 Store 实现都调它，
 * 调用方统一走 getStore().submitCollegeCalendar()。
 */
async function submitCollegeHolidayImpl(
  sub: CollegeHolidaySubmission,
): Promise<{ holiday: CollegeHoliday; created: boolean }> {
  const fields = {
    university_name: sub.university_name,
    province: sub.province,
    city: sub.city,
    lat: sub.lat,
    lng: sub.lng,
    academic_year: sub.academic_year,
    winter_start: sub.winter_start,
    winter_end: sub.winter_end,
    summer_start: sub.summer_start,
    summer_end: sub.summer_end,
    source_url: sub.source_url,
    note: sub.note,
  }

  if (getDataMode() === 'mock') {
    const db = mockDb()
    const now = new Date().toISOString()

    // 显式给了 id 就按 id 改；没给 id 但 (校名, 学年) 已存在，也视为修改，
    // 否则重复提交同一份校历会静默产生重复行
    const idx = sub.id
      ? db.collegeHolidays.findIndex((h) => h.id === sub.id)
      : db.collegeHolidays.findIndex(
          (h) =>
            h.university_name === sub.university_name &&
            h.academic_year === sub.academic_year,
        )

    if (idx !== -1) {
      const before = db.collegeHolidays[idx]
      db.collegeRevisions.push({
        id: `mock-crev-${db.collegeRevisions.length + 1}`,
        holiday_id: before.id,
        version: before.version,
        snapshot: structuredClone(before),
        change_note: null,
        created_at: now,
      })
      const updated: CollegeHoliday = {
        ...before,
        ...fields,
        updated_at: now,
        version: before.version + 1,
      }
      db.collegeHolidays[idx] = updated
      return { holiday: updated, created: false }
    }

    const created: CollegeHoliday = {
      id: `local-calendar-${crypto.randomUUID()}`,
      ...fields,
      version: 1,
      created_at: now,
      updated_at: now,
    }
    db.collegeHolidays.push(created)
    return { holiday: created, created: true }
  }

  const client = getSupabase()
  if (!client) throw new DataError('Supabase 未配置', 'not_configured')
  const now = new Date().toISOString()

  if (sub.id) {
    const { data: existing, error: readErr } = await client
      .from('college_holidays')
      .select('*')
      .eq('id', sub.id)
      .maybeSingle()
    if (readErr) throw new DataError(`读取原校历失败：${readErr.message}`)
    if (!existing) throw new DataError('要修改的校历记录不存在', 'not_found')

    const before = existing as CollegeHoliday
    const revisionClient = getSupabaseAdmin() ?? client
    const { error: revErr } = await revisionClient
      .from('college_holiday_revisions')
      .insert({ holiday_id: before.id, version: before.version, snapshot: before })
    if (revErr) throw new DataError(`写入版本快照失败：${revErr.message}`)

    const { data, error } = await client
      .from('college_holidays')
      .update({ ...fields, updated_at: now, version: before.version + 1 })
      .eq('id', before.id)
      .select('*')
      .single()
    if (error) throw new DataError(`保存失败：${error.message}`)
    return { holiday: data as CollegeHoliday, created: false }
  }

  // 新增：靠 (university_name, academic_year) 唯一约束做 upsert，
  // 这样「同一所学校重复导入」是幂等的，不会堆出重复行
  const { data, error } = await client
    .from('college_holidays')
    .upsert(
      { ...fields, version: 1, created_at: now, updated_at: now },
      { onConflict: 'university_name,academic_year' },
    )
    .select('*')
    .single()
  if (error) throw new DataError(`新增失败：${error.message}`)
  return { holiday: data as CollegeHoliday, created: true }
}

/** 清空 mock 存储（仅开发调试用） */
export function resetMockDb(): void {
  delete globalForMock.__zxssxscMockDb
}
