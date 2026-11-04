import { m } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { Bats } from './Bats'
import { CandleGlow } from './CandleGlow'
import { DeadTrees } from './DeadTrees'
import { GroundFog } from './GroundFog'
import { Hills } from './Hills'
import { useFinePointer, useIsMobile, useReducedMotion } from './hooks'
import { IronFence } from './IronFence'
import { MistBand } from './MistBand'
import { Moon } from './Moon'
import { ParallaxLayer } from './ParallaxLayer'
import { Pumpkins } from './Pumpkins'
import { Sky } from './Sky'
import { TheKeeper, LanternLight } from './TheKeeper'
import { Tombstones } from './Tombstones'

/**
 * The persistent moonlit graveyard. Mounted once in the app layout; every
 * route renders on top of it. Purely decorative, so it is hidden from
 * assistive tech and ignores pointer events.
 */
export function Scene({ descended = false }: { descended?: boolean }) {
  const reduced = useReducedMotion()
  const mobile = useIsMobile()
  const finePointer = useFinePointer()
  const rootRef = useRef<HTMLDivElement>(null)
  const interactive = !reduced && !mobile && finePointer

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (!interactive) {
      root.style.setProperty('--px', '0')
      root.style.setProperty('--py', '0')
      root.style.setProperty('--glow', '0')
      return
    }
    let raf = 0
    let x = 0
    let y = 0
    const apply = () => {
      raf = 0
      const w = window.innerWidth || 1
      const h = window.innerHeight || 1
      root.style.setProperty('--px', ((x / w) * 2 - 1).toFixed(3))
      root.style.setProperty('--py', ((y / h) * 2 - 1).toFixed(3))
      root.style.setProperty('--cx', `${x.toFixed(0)}px`)
      root.style.setProperty('--cy', `${y.toFixed(0)}px`)
      root.style.setProperty('--glow', '1')
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      x = e.clientX
      y = e.clientY
      if (!raf) raf = requestAnimationFrame(apply)
    }
    const onLeave = () => root.style.setProperty('--glow', '0')
    // The scene is pointer-events-none, so listen on window and write vars on the root.
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [interactive])

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-night-950"
    >
      {/* When a ritual starts the whole scene eases down ~60 px, giving the panels more sky. */}
      <m.div
        className="absolute inset-0"
        initial={false}
        animate={{ y: descended ? 60 : 0 }}
        transition={{ duration: 1.4, ease: [0.22, 0.8, 0.2, 1] }}
      >
      <ParallaxLayer depth={2}>
        <Sky reduced={reduced} mobile={mobile} />
      </ParallaxLayer>
      <ParallaxLayer depth={4}>
        <Moon />
      </ParallaxLayer>
      {!reduced && (
        <ParallaxLayer depth={5}>
          <Bats />
        </ParallaxLayer>
      )}
      <ParallaxLayer depth={7}>
        <Hills />
        <MistBand id="mist-hills" y={262} h={120} alpha={0.2} />
      </ParallaxLayer>
      <ParallaxLayer depth={10}>
        <DeadTrees mobile={mobile} />
        <MistBand id="mist-trees" y={368} h={96} alpha={0.13} />
      </ParallaxLayer>
      <ParallaxLayer depth={13}>
        <IronFence />
      </ParallaxLayer>
      <ParallaxLayer depth={16}>
        <Tombstones mobile={mobile} />
        <Pumpkins mobile={mobile} />
      </ParallaxLayer>
      {!mobile && (
        <>
          <LanternLight />
          <ParallaxLayer depth={15}>
            <TheKeeper />
          </ParallaxLayer>
        </>
      )}
      <ParallaxLayer depth={20}>
        <GroundFog reduced={reduced} />
      </ParallaxLayer>
      </m.div>
      {/* soft vignette keeps the edges dark and the centre readable */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 80% at 50% 42%, transparent 50%, rgba(4,5,10,0.5) 82%, rgba(4,5,10,0.85) 100%)',
        }}
      />
      {interactive && <CandleGlow />}
    </div>
  )
}
