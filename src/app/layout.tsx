import type { Metadata, Viewport } from 'next'

import './globals.css'
import { AppToaster } from '@/components/app-toaster'
import { SiteHeader } from '@/components/site-header'
import { getDataMode } from '@/lib/data-source'

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME?.trim() || 'zxssxsc'

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} · 中学生上学时长地图`,
    template: `%s · ${SITE_NAME}`,
  },
  description:
    '以地图可视化中国中学生的每日在校时长：支持省市区筛选、搜索、动态晨昏线、附近学校定位，以及大学生寒假暑假查询。数据由匿名访客共同维护。',
  keywords: ['中学生', '上学时长', '在校时间', '地图', '晨昏线', '大学放假', '寒暑假'],
  applicationName: SITE_NAME,
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 允许放大到 5 倍，不做无障碍上的反向优化
  maximumScale: 5,
  themeColor: '#ffffff',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // 在服务端判定数据模式，避免把「演示数据」徽标做成闪烁的客户端状态
  const dataMode = getDataMode()

  return (
    <html lang="zh-CN">
      <body className="min-h-dvh">
        <SiteHeader siteName={SITE_NAME} dataMode={dataMode} />
        <main>{children}</main>
        <AppToaster />
      </body>
    </html>
  )
}
