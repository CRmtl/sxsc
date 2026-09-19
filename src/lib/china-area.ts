/**
 * 省-市-区县三级数据。
 *
 * 数据来源：npm 包 `china-area-data`（MIT），已由 scripts/build-area-data.mjs
 * 预生成为 src/data/china-area.json（34 省 / 374 市 / 3397 区县，149KB）。
 * **不依赖任何外部 API**，离线可用。
 *
 * 注意：直辖市已归一化为「北京市 / 北京市 / 海淀区」这种形态，
 * 而不是源数据里的「北京市 / 市辖区 / 海淀区」。
 */

import areaData from '@/data/china-area.json'

export interface AreaDistrict {
  code: string
  name: string
}

export interface AreaCity {
  code: string
  name: string
  districts: AreaDistrict[]
}

export interface AreaProvince {
  code: string
  name: string
  cities: AreaCity[]
}

interface AreaFile {
  provinces: AreaProvince[]
}

export const AREA_PROVINCES: AreaProvince[] = (areaData as AreaFile).provinces

export const PROVINCE_NAMES: string[] = AREA_PROVINCES.map((p) => p.name)

const provinceIndex = new Map(AREA_PROVINCES.map((p) => [p.name, p]))

export function findProvince(name: string | null | undefined): AreaProvince | undefined {
  if (!name) return undefined
  return provinceIndex.get(name)
}

export function citiesOf(provinceName: string | null | undefined): AreaCity[] {
  return findProvince(provinceName)?.cities ?? []
}

export function cityNamesOf(provinceName: string | null | undefined): string[] {
  return citiesOf(provinceName).map((c) => c.name)
}

export function findCity(
  provinceName: string | null | undefined,
  cityName: string | null | undefined,
): AreaCity | undefined {
  if (!cityName) return undefined
  return citiesOf(provinceName).find((c) => c.name === cityName)
}

export function districtsOf(
  provinceName: string | null | undefined,
  cityName: string | null | undefined,
): AreaDistrict[] {
  return findCity(provinceName, cityName)?.districts ?? []
}

export function districtNamesOf(
  provinceName: string | null | undefined,
  cityName: string | null | undefined,
): string[] {
  return districtsOf(provinceName, cityName).map((d) => d.name)
}

/**
 * 有些省（如直辖市）只有一个市，有些直筒子市没有区县。
 * 表单里可以据此自动跳过无意义的层级，减少点击。
 */
export function hasSingleCity(provinceName: string): boolean {
  return citiesOf(provinceName).length === 1
}

export function hasNoDistrict(provinceName: string, cityName: string): boolean {
  const districts = districtsOf(provinceName, cityName)
  return districts.length === 0
}

/** 校验一个省/市/区县组合是否真实存在（防止伪造提交） */
export function isValidArea(
  provinceName: string,
  cityName: string,
  districtName: string,
): boolean {
  const province = findProvince(provinceName)
  if (!province) return false
  const city = province.cities.find((c) => c.name === cityName)
  if (!city) return false
  if (city.districts.length === 0) return districtName === cityName || districtName === ''
  return city.districts.some((d) => d.name === districtName)
}

/**
 * 只校验到市级。
 * 大学数据只精确到「省 + 市」（没有区县），用 isValidArea 会误杀，
 * 所以单独提供这个更宽松、语义也更准确的入口。
 */
export function isValidProvinceCity(
  provinceName: string,
  cityName: string,
): boolean {
  const province = findProvince(provinceName)
  if (!province) return false
  return province.cities.some((c) => c.name === cityName)
}
