import type { Metadata } from 'next'

import { CollegeExplorer } from '@/components/college-explorer'
import { FaqSection } from '@/components/faq-section'
import { getDataMode, getStore } from '@/lib/data-source'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '大学生放假查询',
  description:
    '按任意日期查询全国大学的寒假 / 暑假起止时间与剩余天数，地图按「假期中 / 未放假 / 已开学」着色。',
}

export default async function CollegeHolidayPage() {
  const store = getStore()
  const [holidays, festivals] = await Promise.all([
    store.listCollegeHolidays(),
    store.listHolidays(),
  ])

  return (
    <>
      <CollegeExplorer
        holidays={holidays}
        festivals={festivals}
        dataMode={getDataMode()}
      />
      <FaqSection />
    </>
  )
}
