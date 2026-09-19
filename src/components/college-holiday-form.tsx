'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Loader2, PlusCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { citiesOf, PROVINCE_NAMES } from '@/lib/china-area'
import { cn } from '@/lib/utils'
import { LIMITS, daysInclusive } from '@/lib/validation'

const LocationPicker = dynamic(() => import('@/components/map/location-picker'), {
  ssr: false,
  loading: () => (
    <div className="grid h-[280px] place-items-center rounded-lg border bg-muted text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
    </div>
  ),
})

interface CollegeFormProps {
  antiAbuse: { enabled: boolean; minFillMs: number; rateLimitPerHour: number }
  dataMode: 'mock' | 'supabase'
}

/** 一对起止日期 → 含首尾天数；不完整或顺序不对返回 null */
function pairDays(start: string, end: string): number | null {
  if (!start || !end || end < start) return null
  const d = daysInclusive(start, end)
  return d > 0 && d <= 200 ? d : null
}

function PairHint({ start, end }: { start: string; end: string }) {
  const days = pairDays(start, end)
  if (days !== null) {
    return (
      <p className="mt-1 text-[11px] text-muted-foreground">
        共 <strong className="font-mono tabular-nums">{days}</strong> 天（含首尾）
      </p>
    )
  }
  if (start && end && end < start) {
    return <p className="mt-1 text-[11px] text-destructive">结束日期不能早于开始日期</p>
  }
  if ((start && !end) || (!start && end)) {
    return <p className="mt-1 text-[11px] text-amber-700">开始与结束日期要么都填，要么都留空</p>
  }
  return <p className="mt-1 text-[11px] text-muted-foreground">未公布可留空</p>
}

export function CollegeHolidayForm({ antiAbuse, dataMode }: CollegeFormProps) {
  const [universityName, setUniversityName] = useState('')
  const [province, setProvince] = useState('')
  const [city, setCity] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [academicYear, setAcademicYear] = useState('')
  const [winterStart, setWinterStart] = useState('')
  const [winterEnd, setWinterEnd] = useState('')
  const [summerStart, setSummerStart] = useState('')
  const [summerEnd, setSummerEnd] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [note, setNote] = useState('')
  const [website, setWebsite] = useState('') // 蜜罐

  const [focus, setFocus] = useState<{ lat: number; lng: number; key: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [loadedAt] = useState(() => Date.now())

  // 学年默认值只能在挂载后算：服务端渲染时算出来的学年会与浏览器不一致，
  // 直接放进 useState 初值会导致 hydration 不匹配。
  // 口径：8 月及以后属于新学年。
  useEffect(() => {
    const now = new Date()
    const start = now.getMonth() + 1 >= 8 ? now.getFullYear() : now.getFullYear() - 1
    setAcademicYear((cur) => cur || `${start}-${start + 1}`)
  }, [])

  const cityOptions = useMemo(() => citiesOf(province), [province])

  const position = useMemo<[number, number] | null>(() => {
    const a = Number(lat)
    const b = Number(lng)
    if (!lat || !lng || !Number.isFinite(a) || !Number.isFinite(b)) return null
    return [a, b]
  }, [lat, lng])

  const handlePick = useCallback((a: number, b: number) => {
    setLat(a.toFixed(6))
    setLng(b.toFixed(6))
    setError(null)
  }, [])

  /* ------------------------------------------------------------------ */
  /* 输入大学全名 → 自动获取省/市/经纬度并在地图上定位                    */
  /* ------------------------------------------------------------------ */

  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'ok' | 'partial' | 'error'>(
    'idle',
  )
  const [lookupMsg, setLookupMsg] = useState('')
  const lookupTimer = useRef<number | null>(null)
  /** 上一次成功查询过的名字：避免 Enter 之后紧接着 blur 触发第二次请求 */
  const lastLookedUp = useRef('')

  const runLookup = useCallback(async (name: string) => {
    const q = name.trim()
    if (q.length < 2) return
    if (lastLookedUp.current === q) return

    setLookupState('loading')
    setLookupMsg('正在查询学校位置…')

    try {
      const res = await fetch(`/api/geocode/university?name=${encodeURIComponent(q)}`, {
        cache: 'no-store',
      })
      const json = (await res.json()) as
        | {
            ok: true
            data: {
              result: {
                province: string
                city: string
                subCity?: string
                provinceMatched: boolean
                cityMatched: boolean
                amapProvince: string
                amapCity: string
                amapDistrict: string
                lat: number
                lng: number
                address: string
                matchedName: string
              } | null
              message: string
            }
          }
        | { ok: false; error: string }

      if (!json.ok) {
        // 失败不标记为「已查询」，这样用户再失焦一次就能重试
        setLookupState('error')
        setLookupMsg(json.error)
        return
      }

      const result = json.data.result
      if (!result) {
        setLookupState('error')
        setLookupMsg(json.data.message)
        return
      }

      lastLookedUp.current = q

      // 经纬度总是填 —— 即使省市没对上，坐标本身也是有用的
      setLat(result.lat.toFixed(6))
      setLng(result.lng.toFixed(6))
      // 让地图平滑飞过去并打点（LocationPicker 收到新的 focus 就会 flyTo）
      setFocus({ lat: result.lat, lng: result.lng, key: Date.now() })

      if (result.provinceMatched) {
        setProvince(result.province)
        // 市没匹配上时必须清空，否则会留下一个不属于新省份的旧值，
        // 下拉框里会出现一个不存在的选中项
        setCity(result.cityMatched ? result.city : '')
      }

      const partial = !result.provinceMatched || !result.cityMatched
      if (!partial) {
        const sub = result.subCity ? `（${result.subCity} 在本级数据中归属「${result.city}」）` : ''
        setLookupState('ok')
        setLookupMsg(`已自动定位：${result.province} ${result.city}${sub} · ${result.address}`)
      } else {
        setLookupState('partial')
        setLookupMsg(
          result.provinceMatched
            ? `经纬度已填入，但城市未能自动匹配（高德返回：${result.amapCity || '空'}）。请在下方手动选择城市。`
            : `经纬度已填入，但省/市都未能自动匹配（高德返回：${result.amapProvince}${result.amapCity}）。请手动选择。`,
        )
      }
    } catch {
      setLookupState('error')
      setLookupMsg('自动定位请求失败，请手动选择省市并在地图上选点。')
    }
  }, [])

  /**
   * 500ms 防抖后查询。
   * 触发点是 blur 与 Enter，所以正常打字不会发请求；
   * 防抖在这里真正的作用是合并「按下 Enter 后紧接着 blur」这类连续事件。
   */
  const scheduleLookup = useCallback(
    (name: string) => {
      if (lookupTimer.current !== null) window.clearTimeout(lookupTimer.current)
      lookupTimer.current = window.setTimeout(() => {
        lookupTimer.current = null
        void runLookup(name)
      }, 500)
    },
    [runLookup],
  )

  // 卸载时清掉待触发的定时器，避免在已卸载组件上 setState
  useEffect(
    () => () => {
      if (lookupTimer.current !== null) window.clearTimeout(lookupTimer.current)
    },
    [],
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!position) {
      setError('请在地图上选点以确定经纬度')
      return
    }
    if (!winterStart && !summerStart) {
      setError('寒假和暑假至少要填写一个完整的起止区间')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/college-holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          university_name: universityName,
          province,
          city,
          lat: Number(lat),
          lng: Number(lng),
          academic_year: academicYear,
          winter_start: winterStart || null,
          winter_end: winterEnd || null,
          summer_start: summerStart || null,
          summer_end: summerEnd || null,
          source_url: sourceUrl || null,
          note,
          website,
          form_loaded_at: loadedAt,
        }),
      })
      const json = (await res.json()) as
        | { ok: true; data: { message: string } }
        | { ok: false; error: string }

      if (!json.ok) {
        setError(json.error)
        toast.error(json.error)
        return
      }
      setSuccess(json.data.message)
      toast.success(json.data.message)
      // 保留省份/城市/校名，方便连续补录同一所学校的其他学年
      setWinterStart('')
      setWinterEnd('')
      setSummerStart('')
      setSummerEnd('')
      setSourceUrl('')
      setNote('')
    } catch {
      const msg = '网络异常，提交失败，请稍后重试'
      setError(msg)
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div
        aria-hidden
        className="pointer-events-none absolute left-[-9999px] top-0 h-0 w-0 overflow-hidden"
      >
        <label htmlFor="website-college">请勿填写此项（防机器人）</label>
        <input
          id="website-college"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PlusCircle className="size-4" />
            新增 / 修改大学校历
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="university_name" className="mb-1 block">
              大学全名 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="university_name"
              name="university_name"
              required
              maxLength={LIMITS.universityNameMax}
              value={universityName}
              onChange={(e) => setUniversityName(e.target.value)}
              // 失焦后自动定位
              onBlur={(e) => scheduleLookup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  // 回车在这里的语义是「触发自动定位」，
                  // 必须阻止它冒泡成「提交整个表单」——否则用户刚输完校名就把空表单提交了
                  e.preventDefault()
                  scheduleLookup(e.currentTarget.value)
                }
              }}
              placeholder="例如：西华大学"
              aria-describedby="university-name-hint"
            />
            <p id="university-name-hint" className="mt-1 text-[11px] text-muted-foreground">
              输入完整校名后<strong className="font-medium">按回车</strong>或点开别处，
              会自动获取省份、城市与经纬度并把地图移过去。
              同一所学校同一学年只会保留一行，重复提交会覆盖并留下版本快照。
            </p>

            {lookupState !== 'idle' ? (
              <p
                role="status"
                aria-live="polite"
                className={cn(
                  'mt-2 flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] leading-relaxed',
                  lookupState === 'loading' && 'border-border bg-muted/40 text-muted-foreground',
                  lookupState === 'ok' && 'border-green-600/40 bg-green-50 text-green-800',
                  lookupState === 'partial' && 'border-amber-500/50 bg-amber-50 text-amber-800',
                  lookupState === 'error' && 'border-destructive/40 bg-destructive/5 text-destructive',
                )}
              >
                {lookupState === 'loading' ? (
                  <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />
                ) : lookupState === 'ok' ? (
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                )}
                <span>{lookupMsg}</span>
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="college-province" className="mb-1 block">
              省份 <span className="text-destructive">*</span>
            </Label>
            <Select
              id="college-province"
              value={province}
              onChange={(e) => {
                setProvince(e.target.value)
                setCity('')
              }}
            >
              <option value="">请选择</option>
              {PROVINCE_NAMES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="college-city" className="mb-1 block">
              城市 <span className="text-destructive">*</span>
            </Label>
            <Select
              id="college-city"
              value={city}
              disabled={!province}
              onChange={(e) => setCity(e.target.value)}
            >
              <option value="">请选择</option>
              {cityOptions.map((c) => (
                <option key={c.code} value={c.name}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">位置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="college-lat" className="mb-1 block">
                纬度 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="college-lat"
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="college-lng" className="mb-1 block">
                经度 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="college-lng"
                inputMode="decimal"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
              />
            </div>
          </div>
          <LocationPicker value={position} onChange={handlePick} focus={focus} height={280} />
          <p className="text-[11px] text-muted-foreground">
            点击地图放置图钉即可自动填入经纬度。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">校历</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="academic_year" className="mb-1 block">
              学年 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="academic_year"
              required
              maxLength={LIMITS.academicYearMax}
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              placeholder="例如：2025-2026"
            />
          </div>

          <div>
            <Label htmlFor="winter_start" className="mb-1 block">
              寒假开始
            </Label>
            <Input
              id="winter_start"
              type="date"
              value={winterStart}
              onChange={(e) => setWinterStart(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="winter_end" className="mb-1 block">
              寒假结束
            </Label>
            <Input
              id="winter_end"
              type="date"
              value={winterEnd}
              onChange={(e) => setWinterEnd(e.target.value)}
            />
            <PairHint start={winterStart} end={winterEnd} />
          </div>

          <div>
            <Label htmlFor="summer_start" className="mb-1 block">
              暑假开始
            </Label>
            <Input
              id="summer_start"
              type="date"
              value={summerStart}
              onChange={(e) => setSummerStart(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="summer_end" className="mb-1 block">
              暑假结束
            </Label>
            <Input
              id="summer_end"
              type="date"
              value={summerEnd}
              onChange={(e) => setSummerEnd(e.target.value)}
            />
            <PairHint start={summerStart} end={summerEnd} />
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="source_url" className="mb-1 block">
              校历来源 URL
            </Label>
            <Input
              id="source_url"
              type="url"
              maxLength={LIMITS.sourceMax}
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://…/校历页地址"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              强烈建议填写。其他人可以据此核对，也是这个数据集可信度的来源。
            </p>
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="college-note" className="mb-1 block">
              备注
            </Label>
            <Textarea
              id="college-note"
              maxLength={LIMITS.noteMax}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：研究生另行安排；暑期短学期不在此范围"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-4">
          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
          {success ? (
            <div className="flex items-start gap-2 rounded-md border border-green-600/40 bg-green-50 px-3 py-2 text-sm text-green-800">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <span>{success}</span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              提交（直接生效）
            </Button>
            <p className="text-[11px] leading-tight text-muted-foreground">
              无需登录。请尽量附上校历来源，方便他人核对。
              {antiAbuse.enabled ? (
                <>
                  <br />
                  防护：同一 IP 每小时最多 {antiAbuse.rateLimitPerHour} 次提交；
                  表单需停留至少 {(antiAbuse.minFillMs / 1000).toFixed(0)} 秒。
                </>
              ) : null}
              {dataMode === 'mock' ? (
                <>
                  <br />
                  <span className="text-amber-700">演示模式：提交只写入进程内存。</span>
                </>
              ) : null}
            </p>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}
