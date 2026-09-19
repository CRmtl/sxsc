'use client'

import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'

import { useTimeTravel } from '@/hooks/use-time-travel'
import type { School } from '@/lib/types'

const LeafletMap = dynamic(() => import('@/components/map/leaflet-map'), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-muted">
      <Loader2 className="size-4 animate-spin text-muted-foreground" />
    </div>
  ),
})

/** 详情页的小地图：显示这所学校，并叠上当前时刻的晨昏线作为语境 */
export function SchoolDetailMap({ school }: { school: School }) {
  const time = useTimeTravel()

  return (
    <div className="relative h-[320px] overflow-hidden rounded-lg border">
      <LeafletMap
        schools={[school]}
        visibleLayers={{
          schools: true,
          heat: false,
          terminator: true,
          colleges: false,
        }}
        geometryDate={time.geometryDate}
        activeSchool={school}
        onSelectSchool={() => {}}
        focus={{ lat: school.lat, lng: school.lng, zoom: 14, key: 1 }}
        deselectOnMapClick={false}
      />
    </div>
  )
}
