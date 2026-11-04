import { GroundBox } from './Ground'

const BASE = 455
const STEP = 22

function buildFence() {
  let pickets = ''
  let tips = ''
  let posts = ''
  for (let i = 0, x = 6; x < 1600; i++, x += STEP) {
    if (i % 13 === 0) {
      // stone-capped post
      posts += `M${x - 5} ${BASE}V${BASE - 74}H${x + 5}V${BASE}Z`
      posts += `M${x - 8} ${BASE - 74}H${x + 8}V${BASE - 79}H${x - 8}Z`
      posts += `M${x} ${BASE - 79}m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0`
      continue
    }
    // a few bent bars for character
    const lean = i % 17 === 5 ? 6 : i % 23 === 9 ? -5 : 0
    const top = BASE - 62 - (i % 3) * 2
    pickets += `M${x} ${BASE}L${x + lean} ${top}`
    const tx = x + lean
    tips += `M${tx} ${top - 9}L${tx + 3.5} ${top}L${tx} ${top + 3}L${tx - 3.5} ${top}Z`
  }
  return { pickets, tips, posts }
}

const FENCE = buildFence()

/** Wrought-iron fence with spear finials and capped posts. */
export function IronFence() {
  return (
    <GroundBox>
      <g fill="#080a16" stroke="#080a16">
        <path d={FENCE.pickets} strokeWidth="3" fill="none" />
        <path d={FENCE.tips} strokeWidth="0.5" />
        <path d={FENCE.posts} strokeWidth="0.5" />
        <path d={`M0 ${BASE - 50}H1600M0 ${BASE - 10}H1600`} strokeWidth="3.5" fill="none" />
      </g>
    </GroundBox>
  )
}
