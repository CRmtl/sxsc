'use client'

import { useMemo, useState } from 'react'
import { MapPin, Search, X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { citiesOf, districtsOf, PROVINCE_NAMES } from '@/lib/china-area'
import { durationColor, fuzzyMatchName, matchArea } from '@/lib/geo'
import { STAGE_LABELS, type School } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface SchoolFilter {
  province: string
  city: string
  district: string
  keyword: string
}

export const EMPTY_FILTER: SchoolFilter = {
  province: '',
  city: '',
  district: '',
  keyword: '',
}

export function isFilterActive(f: SchoolFilter): boolean {
  return Boolean(f.province || f.city || f.district || f.keyword.trim())
}

/** 纯函数：按筛选条件过滤学校。抽出来便于测试与复用。 */
export function filterSchools(schools: School[], f: SchoolFilter): School[] {
  return schools.filter(
    (s) =>
      matchArea(s, f.province || null, f.city || null, f.district || null) &&
      fuzzyMatchName(s.name, f.keyword),
  )
}

interface SearchBarProps {
  schools: School[]
  filter: SchoolFilter
  onFilterChange: (f: SchoolFilter) => void
  onPick: (school: School) => void
  className?: string
}

/**
 * 搜索栏：左侧省-市-区县三级联动（本地内置数据，离线可用），
 * 右侧学校名模糊搜索。两种方式可叠加使用，也可各自单独使用。
 */
export function SearchBar({
  schools,
  filter,
  onFilterChange,
  onPick,
  className,
}: SearchBarProps) {
  const [showResults, setShowResults] = useState(false)

  const cityOptions = useMemo(() => citiesOf(filter.province), [filter.province])
  const districtOptions = useMemo(
    () => districtsOf(filter.province, filter.city),
    [filter.province, filter.city],
  )

  const matched = useMemo(() => filterSchools(schools, filter), [schools, filter])
  const active = isFilterActive(filter)

  const set = (patch: Partial<SchoolFilter>) => onFilterChange({ ...filter, ...patch })

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-col gap-2 rounded-lg border bg-background/92 p-2 shadow-lg backdrop-blur sm:flex-row sm:items-center">
        {/* 省 */}
        <Select
          id="search-province"
          name="province"
          aria-label="省份"
          value={filter.province}
          onChange={(e) =>
            // 换省必须清空市与区县，否则会留下不属于该省的选项
            set({ province: e.target.value, city: '', district: '' })
          }
          className="sm:w-[110px]"
        >
          <option value="">全部省份</option>
          {PROVINCE_NAMES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>

        {/* 市 */}
        <Select
          id="search-city"
          name="city"
          aria-label="城市"
          value={filter.city}
          disabled={!filter.province || cityOptions.length === 0}
          onChange={(e) => set({ city: e.target.value, district: '' })}
          className="sm:w-[110px]"
        >
          <option value="">全部城市</option>
          {cityOptions.map((c) => (
            <option key={c.code} value={c.name}>
              {c.name}
            </option>
          ))}
        </Select>

        {/* 区县 */}
        <Select
          id="search-district"
          name="district"
          aria-label="区县"
          value={filter.district}
          disabled={!filter.city || districtOptions.length === 0}
          onChange={(e) => set({ district: e.target.value })}
          className="sm:w-[110px]"
        >
          <option value="">全部区县</option>
          {districtOptions.map((d) => (
            <option key={d.code} value={d.name}>
              {d.name}
            </option>
          ))}
        </Select>

        {/* 关键词 */}
        <div className="relative flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="search-keyword"
            name="keyword"
            value={filter.keyword}
            onChange={(e) => {
              set({ keyword: e.target.value })
              setShowResults(true)
            }}
            onFocus={() => setShowResults(true)}
            placeholder="输入学校全名或关键词…"
            className="pl-8"
            aria-label="学校名关键词"
          />
          {filter.keyword ? (
            <button
              type="button"
              onClick={() => set({ keyword: '' })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="清空关键词"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>

        {active ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onFilterChange(EMPTY_FILTER)
              setShowResults(false)
            }}
            className="shrink-0"
          >
            重置
          </Button>
        ) : null}
      </div>

      {/* 结果列表 */}
      {active && showResults ? (
        <div className="max-h-[240px] overflow-y-auto rounded-lg border bg-background/95 p-1 shadow-lg backdrop-blur thin-scrollbar">
          <div className="flex items-center justify-between px-2 py-1 text-[11px] text-muted-foreground">
            <span>
              匹配 <strong className="text-foreground">{matched.length}</strong> 所
              {filter.province ? ` · ${filter.province}` : ''}
              {filter.city ? ` · ${filter.city}` : ''}
              {filter.district ? ` · ${filter.district}` : ''}
            </span>
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => setShowResults(false)}
            >
              收起
            </button>
          </div>

          {matched.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              没有匹配的学校。可以换个关键词，或者
              <a href="/submit" className="ml-1 text-primary hover:underline">
                帮我们补充一所
              </a>
              。
            </p>
          ) : (
            <ul className="divide-y">
              {matched.slice(0, 50).map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(s)
                      setShowResults(false)
                    }}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: durationColor(s.daily_hours) }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {STAGE_LABELS[s.stage]} · {s.province}
                      {s.city !== s.province ? s.city : ''}
                      {s.district}
                    </span>
                    <span
                      className="w-12 shrink-0 text-right font-mono text-xs tabular-nums"
                      style={{ color: durationColor(s.daily_hours) }}
                    >
                      {s.daily_hours}h
                    </span>
                  </button>
                </li>
              ))}
              {matched.length > 50 ? (
                <li className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  仅显示前 50 条，共 {matched.length} 条，请缩小范围
                </li>
              ) : null}
            </ul>
          )}
        </div>
      ) : null}

      {/* 已筛选但收起时给一个提示 */}
      {active && !showResults ? (
        <button
          type="button"
          onClick={() => setShowResults(true)}
          className="flex items-center gap-1.5 self-start rounded-full border bg-background/92 px-2.5 py-1 text-[11px] shadow backdrop-blur hover:bg-accent"
        >
          <MapPin className="size-3" />
          已筛选出 {matched.length} 所 · 展开列表
        </button>
      ) : null}
    </div>
  )
}
