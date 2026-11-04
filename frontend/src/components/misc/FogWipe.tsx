import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { EASE_OUT_EXPO, prefersReducedMotion } from '../../styles/motion'

const BLOBS = [
  { x: '12%', y: '30%', w: '60vmax', o: 0.9 },
  { x: '48%', y: '62%', w: '70vmax', o: 1 },
  { x: '78%', y: '24%', w: '55vmax', o: 0.85 },
  { x: '30%', y: '88%', w: '50vmax', o: 0.75 },
]

/**
 * A bank of mist that rolls across the screen when the route changes between the landing
 * and a ritual. Transform/opacity only, never blocks input. Reduced motion: a quick fade.
 */
export function FogWipe({ trigger }: { trigger: string }) {
  const [run, setRun] = useState(0)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setRun((n) => n + 1)
  }, [trigger])
  if (run === 0) return null
  const reduced = prefersReducedMotion()

  return (
    <motion.div
      key={run}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-30 overflow-hidden"
      initial={reduced ? { opacity: 0.5 } : { opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={reduced ? { duration: 0.2 } : { duration: 0.4, delay: 0.25, ease: EASE_OUT_EXPO }}
    >
      {!reduced && (
        <motion.div
          className="absolute inset-y-0 -left-1/2 w-[200%]"
          initial={{ x: '-45%' }}
          animate={{ x: '20%' }}
          transition={{ duration: 0.65, ease: EASE_OUT_EXPO }}
        >
          {BLOBS.map((b, i) => (
            <span
              key={i}
              className="absolute rounded-full"
              style={{
                left: b.x,
                top: b.y,
                width: b.w,
                height: b.w,
                transform: 'translate(-50%,-50%)',
                opacity: b.o,
                background: 'radial-gradient(closest-side, rgba(143,163,199,0.42), rgba(52,62,92,0.28) 55%, rgba(13,16,32,0) 100%)',
              }}
            />
          ))}
        </motion.div>
      )}
      {reduced && <div className="absolute inset-0 bg-night-900/60" />}
    </motion.div>
  )
}
