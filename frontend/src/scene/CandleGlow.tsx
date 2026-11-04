/** A faint candlelight glow that follows the pointer. Position comes from --cx/--cy on the scene root. */
export function CandleGlow() {
  return (
    <div
      className="absolute left-0 top-0"
      style={{
        width: 420,
        height: 420,
        marginLeft: -210,
        marginTop: -210,
        transform: 'translate3d(var(--cx, -999px), var(--cy, -999px), 0)',
        opacity: 'var(--glow, 0)',
        transition: 'opacity 0.6s ease',
        background: 'radial-gradient(circle, rgba(255,179,92,0.09) 0%, rgba(255,138,31,0.04) 35%, transparent 70%)',
        mixBlendMode: 'screen',
      }}
    />
  )
}
