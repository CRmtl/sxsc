import { FaqSection } from '@/components/faq-section'
import { SchoolExplorer } from '@/components/school-explorer'
import { getDataMode, getStore } from '@/lib/data-source'

// 数据来自数据库或 mock 存储，必须每次请求实时取，不能静态化
export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const store = getStore()
  const [schools, collegeHolidays, festivals] = await Promise.all([
    store.listSchools(),
    store.listCollegeHolidays(),
    store.listHolidays(),
  ])

  return (
    <>
      <SchoolExplorer
        schools={schools}
        collegeHolidays={collegeHolidays}
        festivals={festivals}
        dataMode={getDataMode()}
      />
      {/* 常见问题放在所有既有区块之后，锚点 id="faq" 供顶栏链接跳转 */}
      <FaqSection />
    </>
  )
}
