'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  Loader2,
  MapPin,
  PencilLine,
  PlusCircle,
  Search,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { citiesOf, districtsOf, PROVINCE_NAMES } from '@/lib/china-area'
import { DURATION_BUCKET_MAP, durationBucket } from '@/lib/geo'
import { STAGE_LABELS, STAGE_OPTIONS, type School, type Stage } from '@/lib/types'
import { LIMITS } from '@/lib/validation'
import { cn } from '@/lib/utils'

/** 选点地图同样是浏览器专用（Leaflet 需要 window） */
const LocationPicker = dynamic(() => import('@/components/map/location-picker'), {
  ssr: false,
  loading: () => (
    <div className="grid h-[280px] place-items-center rounded-lg border bg-muted text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
    </div>
  ),
})

export interface GeoResult {
  label: string
  lat: number
  lng: number
  provider: string
}

interface FormState {
  name: string
  stage: Stage
  province: string
  city: string
  district: string
  address: string
  lat: string
  lng: string
  daily_hours: string
  weekly_days: string
  monthly_days: string
  boarding: boolean
  arrive_time: string
  leave_time: string
  boarding_arrive: string
  boarding_leave: string
  day_arrive: string
  day_leave: string
  remark: string
  /** 蜜罐，正常用户永远为空 */
  website: string
}

const EMPTY_FORM: FormState = {
  name: '',
  stage: 'senior',
  province: '',
  city: '',
  district: '',
  address: '',
  lat: '',
  lng: '',
  daily_hours: '',
  weekly_days: '5',
  monthly_days: '22',
  boarding: false,
  arrive_time: '',
  leave_time: '',
  boarding_arrive: '',
  boarding_leave: '',
  day_arrive: '',
  day_leave: '',
  remark: '',
  website: '',
}

function schoolToForm(s: School): FormState {
  const sj = s.schedule_json
  return {
    name: s.name,
    stage: s.stage,
    province: s.province,
    city: s.city,
    district: s.district,
    address: s.address ?? '',
    lat: String(s.lat),
    lng: String(s.lng),
    daily_hours: String(s.daily_hours),
    weekly_days: String(s.weekly_days),
    monthly_days: String(s.monthly_days),
    boarding: s.boarding,
    arrive_time: sj.arrive_time ?? '',
    leave_time: sj.leave_time ?? '',
    boarding_arrive: sj.boarding_schedule?.arrive_time ?? '',
    boarding_leave: sj.boarding_schedule?.leave_time ?? '',
    day_arrive: sj.day_schedule?.arrive_time ?? '',
    day_leave: sj.day_schedule?.leave_time ?? '',
    remark: s.remark ?? '',
    website: '',
  }
}

interface SchoolFormProps {
  schools: School[]
  dataMode: 'mock' | 'supabase'
  antiAbuse: { enabled: boolean; minFillMs: number; rateLimitPerHour: number }
}

export function SchoolForm({ schools, dataMode, antiAbuse }: SchoolFormProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [focus, setFocus] = useState<{ lat: number; lng: number; key: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null)
  const [success, setSuccess] = useState<{ id: string; message: string } | null>(null)

  // 时间陷阱基准：表单在浏览器里挂载的时刻。
  // 用 lazy initializer 且从不渲染该值，因此不会造成 hydration 不一致。
  const [loadedAt] = useState(() => Date.now())

  // —— 修改模式：搜索已有学校 ——
  const [lookup, setLookup] = useState('')
  const [lookupProvince, setLookupProvince] = useState('')

  // —— 可选增强：地址搜索 ——
  const [geoQuery, setGeoQuery] = useState('')
  const [geoProvider, setGeoProvider] = useState<'nominatim' | 'photon'>('nominatim')
  const [geoLoading, setGeoLoading] = useState(false)
  const [geoResults, setGeoResults] = useState<GeoResult[]>([])
  const [geoMessage, setGeoMessage] = useState('')

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setSuccess(null)
  }, [])

  const cityOptions = useMemo(() => citiesOf(form.province), [form.province])
  const districtOptions = useMemo(
    () => districtsOf(form.province, form.city),
    [form.province, form.city],
  )

  const position = useMemo<[number, number] | null>(() => {
    const lat = Number(form.lat)
    const lng = Number(form.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (!form.lat && !form.lng)) return null
    return [lat, lng]
  }, [form.lat, form.lng])

  const previewBucket = useMemo(() => {
    const h = Number(form.daily_hours)
    if (!Number.isFinite(h) || h <= 0) return null
    const b = DURATION_BUCKET_MAP[durationBucket(h)]
    return b
  }, [form.daily_hours])

  const lookupResults = useMemo(() => {
    const kw = lookup.trim().toLowerCase()
    if (!kw && !lookupProvince) return []
    return schools
      .filter((s) => (lookupProvince ? s.province === lookupProvince : true))
      .filter((s) => (kw ? s.name.toLowerCase().includes(kw) : true))
      .slice(0, 30)
  }, [schools, lookup, lookupProvince])

  const handlePickPosition = useCallback(
    (lat: number, lng: number) => {
      setForm((f) => ({ ...f, lat: lat.toFixed(6), lng: lng.toFixed(6) }))
      setFieldError(null)
    },
    [],
  )

  const handleLocate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      toast.error('当前浏览器不支持定位')
      return
    }
    if (!window.isSecureContext) {
      toast.error('定位需要 HTTPS 或 localhost 环境')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        setForm((f) => ({ ...f, lat: latitude.toFixed(6), lng: longitude.toFixed(6) }))
        setFocus({ lat: latitude, lng: longitude, key: Date.now() })
        toast.success('已填入你当前的经纬度（仅本地使用，不会上传坐标本身以外的东西）')
      },
      () => toast.error('定位失败或被拒绝，请直接在地图上选点'),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    )
  }, [])

  const runGeocode = useCallback(async () => {
    const q = geoQuery.trim()
    if (q.length < 2) {
      setGeoMessage('请输入至少 2 个字的地址关键词')
      return
    }
    setGeoLoading(true)
    setGeoResults([])
    setGeoMessage('')
    try {
      const res = await fetch(
        `/api/geocode?q=${encodeURIComponent(q)}&provider=${geoProvider}`,
        { cache: 'no-store' },
      )
      const json = (await res.json()) as
        | { ok: true; data: { results: GeoResult[] } }
        | { ok: false; error: string }
      if (!json.ok) {
        setGeoMessage(json.error)
      } else if (json.data.results.length === 0) {
        setGeoMessage('没有找到匹配地址，请直接在地图上选点')
      } else {
        setGeoResults(json.data.results)
      }
    } catch {
      setGeoMessage('地址搜索请求失败，请直接在地图上选点')
    } finally {
      setGeoLoading(false)
    }
  }, [geoQuery, geoProvider])

  const loadSchool = useCallback((school: School) => {
    setEditingId(school.id)
    setForm(schoolToForm(school))
    setFieldError(null)
    setSuccess(null)
    if (Number.isFinite(school.lat) && Number.isFinite(school.lng)) {
      setFocus({ lat: school.lat, lng: school.lng, key: Date.now() })
    }
    toast.success(`已载入「${school.name}」的现有数据（v${school.version}）`)
  }, [])

  const resetAll = useCallback(() => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFieldError(null)
    setSuccess(null)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFieldError(null)
    setSuccess(null)

    // 前端先做一遍格式校验，给即时反馈；服务端仍会独立校验一次
    if (!form.province || !form.city || !form.district) {
      setFieldError({ field: 'province', message: '请完整选择省 / 市 / 区县' })
      return
    }
    if (!position) {
      setFieldError({ field: 'lat', message: '请在地图上点击或拖动图钉来确定经纬度' })
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        id: editingId,
        name: form.name,
        stage: form.stage,
        province: form.province,
        city: form.city,
        district: form.district,
        address: form.address,
        lat: Number(form.lat),
        lng: Number(form.lng),
        daily_hours: Number(form.daily_hours),
        weekly_days: Number(form.weekly_days),
        monthly_days: Number(form.monthly_days),
        boarding: form.boarding,
        schedule_json: {
          arrive_time: form.arrive_time || null,
          leave_time: form.leave_time || null,
          boarding_schedule:
            form.boarding_arrive || form.boarding_leave
              ? {
                  arrive_time: form.boarding_arrive || null,
                  leave_time: form.boarding_leave || null,
                }
              : null,
          day_schedule:
            form.day_arrive || form.day_leave
              ? { arrive_time: form.day_arrive || null, leave_time: form.day_leave || null }
              : null,
        },
        remark: form.remark,
        // 反滥用字段
        website: form.website,
        form_loaded_at: loadedAt,
      }

      const res = await fetch('/api/schools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await res.json()) as
        | { ok: true; data: { school: School; message: string } }
        | { ok: false; error: string; field?: string; code?: string }

      if (!json.ok) {
        setFieldError({ field: json.field, message: json.error })
        toast.error(json.error)
        return
      }

      setSuccess({ id: json.data.school.id, message: json.data.message })
      toast.success(json.data.message)
      // 保持 editingId，方便连续修正同一所学校
      setEditingId(json.data.school.id)
      if (!editingId) setForm(EMPTY_FORM)
    } catch {
      const msg = '网络异常，提交失败，请稍后重试'
      setFieldError({ message: msg })
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* 蜜罐：视觉与读屏都不可见，正常用户永远不会填 */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-[-9999px] top-0 h-0 w-0 overflow-hidden"
      >
        <label htmlFor="website">请勿填写此项（防机器人）</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={form.website}
          onChange={(e) => set('website', e.target.value)}
        />
      </div>

      {/* 模式与既有数据 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {editingId ? (
              <>
                <PencilLine className="size-4" /> 修改已有学校
              </>
            ) : (
              <>
                <PlusCircle className="size-4" /> 新增一所学校
              </>
            )}
            {editingId ? (
              <Badge variant="secondary" className="ml-2 font-mono text-[10px]">
                id: {editingId.slice(0, 14)}
              </Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[140px] flex-1">
              <Label htmlFor="lookup-province" className="mb-1 block text-xs">
                按省份缩小范围
              </Label>
              <Select
                id="lookup-province"
                value={lookupProvince}
                onChange={(e) => setLookupProvince(e.target.value)}
              >
                <option value="">全部省份</option>
                {PROVINCE_NAMES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-[220px] flex-[2]">
              <Label htmlFor="lookup" className="mb-1 block text-xs">
                搜索已有学校（选中后带出原数据再编辑）
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="lookup"
                  value={lookup}
                  onChange={(e) => setLookup(e.target.value)}
                  placeholder="输入学校名…"
                  className="pl-8"
                />
              </div>
            </div>
            {editingId ? (
              <Button type="button" variant="outline" onClick={resetAll}>
                改为新增
              </Button>
            ) : null}
          </div>

          {lookup || lookupProvince ? (
            <ul className="max-h-[180px] divide-y overflow-y-auto rounded-lg border thin-scrollbar">
              {lookupResults.length === 0 ? (
                <li className="px-3 py-2 text-xs text-muted-foreground">
                  没有找到匹配的学校。如果是新学校，请直接在下方填写。
                </li>
              ) : (
                lookupResults.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => loadSchool(s)}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent',
                        editingId === s.id && 'bg-accent',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {s.province}
                        {s.city !== s.province ? s.city : ''}
                        {s.district} · v{s.version}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      {/* 基本信息 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">基本信息</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="name" className="mb-1 block">
              学校全名 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              required
              minLength={LIMITS.nameMin}
              maxLength={LIMITS.nameMax}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="例如：某某市第一中学"
              aria-invalid={fieldError?.field === 'name'}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              请填写官方全名，便于他人检索与去重（{form.name.length}/{LIMITS.nameMax}）
            </p>
          </div>

          <div>
            <Label htmlFor="stage" className="mb-1 block">
              学段 <span className="text-destructive">*</span>
            </Label>
            <Select
              id="stage"
              value={form.stage}
              onChange={(e) => set('stage', e.target.value as Stage)}
            >
              {STAGE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label className="mb-1 block">
              是否住宿制 <span className="text-destructive">*</span>
            </Label>
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3">
              {/*
                name 不能省：Checkbox 在 <form> 内时，Radix 会额外渲染一个隐藏的
                <input type="checkbox">，其 name 取自这里；为空则触发浏览器的
                “A form field element should have an id or name attribute”。
              */}
              <Checkbox
                id="boarding"
                name="boarding"
                checked={form.boarding}
                onCheckedChange={(v) => set('boarding', v === true)}
              />
              <span className="text-sm">{form.boarding ? '住宿制' : '走读'}</span>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* 位置 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">位置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="province" className="mb-1 block">
                省份 <span className="text-destructive">*</span>
              </Label>
              <Select
                id="province"
                value={form.province}
                onChange={(e) =>
                  // 换省必须清空下级，避免残留不属于该省的选项
                  setForm((f) => ({
                    ...f,
                    province: e.target.value,
                    city: '',
                    district: '',
                  }))
                }
                aria-invalid={fieldError?.field === 'province'}
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
              <Label htmlFor="city" className="mb-1 block">
                城市 <span className="text-destructive">*</span>
              </Label>
              <Select
                id="city"
                value={form.city}
                disabled={!form.province}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value, district: '' }))}
              >
                <option value="">请选择</option>
                {cityOptions.map((c) => (
                  <option key={c.code} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="district" className="mb-1 block">
                区县 <span className="text-destructive">*</span>
              </Label>
              <Select
                id="district"
                value={form.district}
                disabled={!form.city || districtOptions.length === 0}
                onChange={(e) => set('district', e.target.value)}
              >
                <option value="">请选择</option>
                {districtOptions.map((d) => (
                  <option key={d.code} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </Select>
              {form.city && districtOptions.length === 0 ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  该市没有下辖区县，可直接填写详细地址
                </p>
              ) : null}
            </div>
          </div>

          <div>
            <Label htmlFor="address" className="mb-1 block">
              详细地址
            </Label>
            <Input
              id="address"
              maxLength={LIMITS.addressMax}
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="例如：某某区某某路 1 号"
            />
          </div>

          {/* 经纬度 */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="lat" className="mb-1 block">
                纬度 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="lat"
                inputMode="decimal"
                value={form.lat}
                onChange={(e) => set('lat', e.target.value)}
                placeholder="点击下方地图自动填入"
                aria-invalid={fieldError?.field === 'lat'}
              />
            </div>
            <div>
              <Label htmlFor="lng" className="mb-1 block">
                经度 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="lng"
                inputMode="decimal"
                value={form.lng}
                onChange={(e) => set('lng', e.target.value)}
                placeholder="点击下方地图自动填入"
                aria-invalid={fieldError?.field === 'lng'}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleLocate}>
              <Crosshair className="size-4" />
              用我的位置填入
            </Button>
            <span className="text-[11px] text-muted-foreground">
              定位只用于填入经纬度，坐标不会单独上传或存储（学校坐标本身是要公开的数据）。
            </span>
          </div>

          <div>
            <div className="mb-1 flex items-center gap-2">
              <MapPin className="size-4" />
              <span className="text-sm font-medium">在地图上选点（推荐，国内始终可用）</span>
            </div>
            <LocationPicker
              value={position}
              onChange={handlePickPosition}
              focus={focus}
              height={300}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              点击地图任意位置放置图钉，拖动图钉可微调。经纬度会自动填入上方输入框。
            </p>
          </div>

          {/* 可选增强：地址搜索 */}
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              地址搜索（可选，用于辅助定位）
            </summary>
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-2">
                <Input
                  id="geo-query"
                  name="geo-query"
                  value={geoQuery}
                  onChange={(e) => setGeoQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void runGeocode()
                    }
                  }}
                  placeholder="例如：北京市海淀区中关村大街"
                  className="min-w-[200px] flex-1"
                />
                <Select
                  id="geo-provider"
                  name="geo-provider"
                  value={geoProvider}
                  onChange={(e) => setGeoProvider(e.target.value as 'nominatim' | 'photon')}
                  className="w-[130px]"
                  aria-label="地理编码服务"
                >
                  <option value="nominatim">Nominatim</option>
                  <option value="photon">Photon</option>
                </Select>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void runGeocode()}
                  disabled={geoLoading}
                >
                  {geoLoading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                  搜索
                </Button>
              </div>

              <p className="text-[11px] text-muted-foreground">
                通过服务端代理请求 OSM Nominatim / Photon，已做 5 分钟缓存与每 IP 1 秒 1 次节流。
                这两个服务在境内直连可能不稳定 —— 若失败，直接用上面的地图选点即可。
              </p>

              {geoMessage ? (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-700">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {geoMessage}
                </p>
              ) : null}

              {geoResults.length > 0 ? (
                <ul className="max-h-[180px] divide-y overflow-y-auto rounded border thin-scrollbar">
                  {geoResults.map((r, i) => (
                    <li key={`${r.lat}-${r.lng}-${i}`}>
                      <button
                        type="button"
                        onClick={() => {
                          handlePickPosition(r.lat, r.lng)
                          setFocus({ lat: r.lat, lng: r.lng, key: Date.now() })
                          toast.success('已按搜索结果定位，请核对图钉位置')
                        }}
                        className="flex w-full items-start gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent"
                      >
                        <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">{r.label}</span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </details>
        </CardContent>
      </Card>

      {/* 作息数据 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">作息数据</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="daily_hours" className="mb-1 block">
                每日在校时长（小时） <span className="text-destructive">*</span>
              </Label>
              <Input
                id="daily_hours"
                required
                type="number"
                step="0.5"
                min={LIMITS.dailyHoursMin}
                max={LIMITS.dailyHoursMax}
                value={form.daily_hours}
                onChange={(e) => set('daily_hours', e.target.value)}
                placeholder="例如：11.5"
                aria-invalid={fieldError?.field === 'daily_hours'}
              />
              {previewBucket ? (
                <p className="mt-1 flex items-center gap-1.5 text-[11px]">
                  <span
                    className="inline-block size-2.5 rounded-full"
                    style={{ background: previewBucket.color }}
                  />
                  将归入「{previewBucket.label}」档：{previewBucket.description}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  指从到校到离校的总时长，含早读与晚自习
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="weekly_days" className="mb-1 block">
                每周上学天数 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="weekly_days"
                required
                type="number"
                step="0.5"
                min={LIMITS.weeklyDaysMin}
                max={LIMITS.weeklyDaysMax}
                value={form.weekly_days}
                onChange={(e) => set('weekly_days', e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="monthly_days" className="mb-1 block">
                每月上学天数 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="monthly_days"
                required
                type="number"
                step="1"
                min={LIMITS.monthlyDaysMin}
                max={LIMITS.monthlyDaysMax}
                value={form.monthly_days}
                onChange={(e) => set('monthly_days', e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="arrive_time" className="mb-1 block">
                到校时间（主口径）
              </Label>
              <Input
                id="arrive_time"
                type="time"
                value={form.arrive_time}
                onChange={(e) => set('arrive_time', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="leave_time" className="mb-1 block">
                离校时间（主口径）
              </Label>
              <Input
                id="leave_time"
                type="time"
                value={form.leave_time}
                onChange={(e) => set('leave_time', e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 rounded-lg border bg-muted/40 p-3 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">走读生作息</div>
              <div className="flex items-center gap-2">
                <Input
                  id="day-arrive"
                  name="day-arrive"
                  type="time"
                  value={form.day_arrive}
                  onChange={(e) => set('day_arrive', e.target.value)}
                  aria-label="走读到校时间"
                />
                <span className="text-muted-foreground">→</span>
                <Input
                  id="day-leave"
                  name="day-leave"
                  type="time"
                  value={form.day_leave}
                  onChange={(e) => set('day_leave', e.target.value)}
                  aria-label="走读离校时间"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">住宿生作息</div>
              <div className="flex items-center gap-2">
                <Input
                  id="boarding-arrive"
                  name="boarding-arrive"
                  type="time"
                  value={form.boarding_arrive}
                  onChange={(e) => set('boarding_arrive', e.target.value)}
                  aria-label="住宿到校时间"
                />
                <span className="text-muted-foreground">→</span>
                <Input
                  id="boarding-leave"
                  name="boarding-leave"
                  type="time"
                  value={form.boarding_leave}
                  onChange={(e) => set('boarding_leave', e.target.value)}
                  aria-label="住宿离校时间"
                />
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="remark" className="mb-1 block">
              备注
            </Label>
            <Textarea
              id="remark"
              maxLength={LIMITS.remarkMax}
              value={form.remark}
              onChange={(e) => set('remark', e.target.value)}
              placeholder="例如：周六上午上课；月假制；数据来源为家长口述等"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {form.remark.length}/{LIMITS.remarkMax} · 请勿填写广告、联系方式或人身攻击内容
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 提交区 */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          {fieldError ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{fieldError.message}</span>
            </div>
          ) : null}

          {success ? (
            <div className="flex items-start gap-2 rounded-md border border-green-600/40 bg-green-50 px-3 py-2 text-sm text-green-800">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <span>
                {success.message}{' '}
                <Link href={`/school/${success.id}`} className="font-medium underline">
                  查看详情
                </Link>
              </span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {editingId ? '保存修改（直接生效）' : '提交新增（直接生效）'}
            </Button>
            <Button type="button" variant="outline" onClick={resetAll}>
              清空表单
            </Button>

            <p className="text-[11px] leading-tight text-muted-foreground">
              无需登录，提交后立即生效，并保留版本历史以便回滚。
              {antiAbuse.enabled ? (
                <>
                  <br />
                  防护：同一 IP 每小时最多 {antiAbuse.rateLimitPerHour} 次提交；
                  表单需停留至少 {(antiAbuse.minFillMs / 1000).toFixed(0)} 秒。
                </>
              ) : (
                <>
                  <br />
                  <span className="text-amber-700">反滥用防护当前已关闭（DISABLE_ANTI_ABUSE=1）。</span>
                </>
              )}
              {dataMode === 'mock' ? (
                <>
                  <br />
                  <span className="text-amber-700">
                    当前为演示模式，提交只写入服务器进程内存，重启即失效。
                  </span>
                </>
              ) : null}
            </p>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}
