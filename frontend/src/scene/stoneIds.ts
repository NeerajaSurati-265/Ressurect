import { useId } from 'react'

export const MOON_AZIMUTH = 225 // SVG azimuth: degrees clockwise from +x in a y-down space -> upper left
export const MOON_ELEVATION = 40

export type StoneIds = { carve: string; engrave: string; moss: string; soil: string }

export function useStoneIds(prefix = 'st'): StoneIds {
  const base = `${prefix}${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return { carve: `${base}-carve`, engrave: `${base}-engrave`, moss: `${base}-moss`, soil: `${base}-soil` }
}
