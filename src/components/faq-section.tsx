import { Plus } from 'lucide-react'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { FAQ_ITEMS } from '@/content/faq'

/**
 * 常见问题区块。
 *
 * 刻意**不写 'use client'**：本组件只负责渲染静态内容，
 * 交互部分（折叠展开）由 Radix 驱动的 ui/accordion 承担。
 * 这样 FAQ 文案不必进入客户端 bundle，首屏更轻。
 *
 * 版式来自设计稿，与你确认过的三处修改：
 *   1. 标题中文化为「你需要知道的一切」；
 *   2. **移除** Product / Support / Payments 三个标签页；
 *   3. **移除**底部「Contact Us」卡片，改为一行地图加载状态说明。
 *
 * 另外两处偏离设计稿/原始提示词，理由写在这里免得日后被当成疏漏：
 *   · 不使用 framer-motion。折叠动画用 tailwind.config.ts 里已有的
 *     accordion-down / accordion-up 关键帧 + Radix 的 data-state 实现，
 *     无需为一条高度动画引入动画库。
 *   · 不引入 Google Fonts 的 Geist。fonts.googleapis.com 在国内基本不可达，
 *     引入它会拖慢首屏甚至阻塞渲染；改用站点既有的字体栈。
 *
 * 字号做了响应式收敛：中文标题比拉丁字母宽，40px 在 375px 屏上会顶边，
 * 因此小屏用 30px、sm 起恢复设计稿的 40px、md 用 52px。
 */
export function FaqSection({ id = 'faq' }: { id?: string }) {
  return (
    <section id={id} className="bg-[#FAF7F2] px-6 py-16 md:px-[60px] md:py-[120px]">
      <div className="mx-auto max-w-[820px]">
        {/* 标题区 */}
        <header className="mb-10 text-center md:mb-16">
          <h2 className="mx-auto mb-4 max-w-[800px] text-[30px] font-medium leading-[1.15] tracking-[-0.02em] text-[#1D1B1B] sm:text-[40px] sm:leading-[1.1] sm:tracking-[-0.03em] md:mb-5 md:text-[52px]">
            你需要知道的一切
          </h2>
          <p className="mx-auto max-w-[460px] text-[15px] leading-relaxed text-[#888888] md:text-base">
            关于上学时长地图、大学生放假查询，以及数据怎么来的、怎么改。
          </p>
        </header>

        {/* 折叠列表：一次只展开一项，默认全部收起 */}
        <Accordion type="single" collapsible className="w-full">
          {FAQ_ITEMS.map((item, i) => (
            <AccordionItem key={item.q} value={`faq-${i}`} className="border-b border-[#eeeeee]">
              <AccordionTrigger
                className={
                  'group py-5 text-[15px] font-medium text-[#111111] hover:text-[#111111] md:text-base'
                }
              >
                <span className="pr-4">{item.q}</span>
                {/* 圆形「+」，展开时旋转 45° 变成 × —— 旋转绑在 data-state 上，不换图标 */}
                <span
                  aria-hidden
                  className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[#e0e0e0] transition-transform duration-300 group-data-[state=open]:rotate-45 md:size-8"
                >
                  <Plus className="size-3.5 text-[#555555]" strokeWidth={2.5} />
                </span>
              </AccordionTrigger>
              <AccordionContent>
                {/* 多段落答案；右侧留出与「+」对齐的间距 */}
                <div className="space-y-2.5 pr-0 text-[14px] leading-[1.7] text-[#666666] sm:pr-12 md:text-[15px]">
                  {item.a.map((paragraph, j) => (
                    <p key={j}>{paragraph}</p>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        {/*
          设计稿底部的「Have more questions? / Contact Us」卡片按要求移除。
          这里改放一行地图加载状态说明，顺带把「地图空白怎么办」的入口讲清楚。
        */}
        <p className="mx-auto mt-12 max-w-[560px] text-center text-[13px] leading-[1.7] text-[#888888] md:mt-16">
          地图底图加载期间，地图区域会显示「正在加载地图数据…」「正在计算晨昏线…」等提示。
          如果地图一直空白，多半是国内访问境外瓦片的网络波动 ——
          右上角「图层」里可以手动切换底图镜像，或直接刷新页面。
        </p>
      </div>
    </section>
  )
}
