/**
 * The Keeper: an original hooded lantern-bearer standing at the right edge.
 * Faceless hood with two faint ember eyes, a long plain robe and a sleeve that
 * holds a lantern out toward the URL input. No hands, no tatters.
 */
export function TheKeeper() {
  return (
    <svg
      viewBox="0 0 260 560"
      overflow="visible"
      className="absolute"
      style={{ right: 'max(1vw, 8px)', bottom: 'calc(24px + 1.5vh)', height: 'clamp(300px, 64vh, 640px)' }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="keeper-robe" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#1b1f3a" />
          <stop offset="45%" stopColor="#0f1226" />
          <stop offset="100%" stopColor="#06070e" />
        </linearGradient>
        <radialGradient id="keeper-wash" cx="56" cy="268" r="230" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ff8a1f" stopOpacity="0.45" />
          <stop offset="40%" stopColor="#ff8a1f" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="lantern-glass" cx="50%" cy="60%" r="65%">
          <stop offset="0%" stopColor="#fff1c9" />
          <stop offset="40%" stopColor="#ffb35c" />
          <stop offset="100%" stopColor="#c55400" />
        </radialGradient>
        <radialGradient id="lantern-glow">
          <stop offset="0%" stopColor="#ffb35c" stopOpacity="0.55" />
          <stop offset="25%" stopColor="#ff8a1f" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="keeper-pool">
          <stop offset="0%" stopColor="#ff8a1f" stopOpacity="0.5" />
          <stop offset="45%" stopColor="#ff8a1f" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
        <filter id="eye-blur" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
      </defs>

      {/* lantern light pooling on the ground in front of the Keeper */}
      <ellipse cx="80" cy="548" rx="150" ry="16" fill="url(#keeper-pool)" className="anim-ember-slow" />
      {/* ground shadow */}
      <ellipse cx="155" cy="548" rx="92" ry="9" fill="#000" opacity="0.55" />

      {/* robe */}
      <path
        d="M118 150 C 100 210, 86 330, 70 546 C 120 552, 190 552, 238 546 C 224 400, 206 250, 186 150 Z"
        fill="url(#keeper-robe)"
      />
      <path
        d="M118 150 C 100 210, 86 330, 70 546 C 120 552, 190 552, 238 546 C 224 400, 206 250, 186 150 Z"
        fill="url(#keeper-wash)"
      />
      <path d="M118 150 C 100 210, 86 330, 70 546" fill="none" stroke="#c9d4ec" strokeOpacity="0.1" strokeWidth="3" transform="translate(-1 0)" />
      {/* folds */}
      <g fill="none" stroke="#03040a" strokeOpacity="0.7" strokeWidth="2.2" strokeLinecap="round">
        <path d="M132 230 C 124 320, 116 420, 112 540" />
        <path d="M162 240 C 162 330, 166 430, 172 542" />
        <path d="M190 260 C 198 350, 206 450, 212 540" />
      </g>
      <path d="M118 150 C 100 210, 86 330, 70 546" fill="none" stroke="#ffb35c" strokeOpacity="0.22" strokeWidth="1.5" />

      {/* hood */}
      <path
        d="M110 166 C 98 116, 118 54, 152 40 C 184 28, 204 72, 200 112 C 198 142, 194 162, 188 176 C 166 186, 130 184, 110 166 Z"
        fill="url(#keeper-robe)"
      />
      <path
        d="M110 166 C 98 116, 118 54, 152 40 C 184 28, 204 72, 200 112 C 198 142, 194 162, 188 176 C 166 186, 130 184, 110 166 Z"
        fill="url(#keeper-wash)"
      />
      <path d="M110 166 C 98 116, 118 54, 152 40" fill="none" stroke="#ffb35c" strokeOpacity="0.25" strokeWidth="1.5" />
      {/* faceless void */}
      <path d="M118 152 C 112 120, 124 88, 147 82 C 166 78, 172 104, 168 130 C 165 150, 152 166, 133 167 Z" fill="#010104" />
      {/* two faint ember eyes */}
      <g className="anim-ember-slow">
        <g filter="url(#eye-blur)" fill="#ffb35c" opacity="0.75">
          <circle cx="134" cy="118" r="2.6" />
          <circle cx="152" cy="116" r="2.6" />
        </g>
        <circle cx="134" cy="118" r="1" fill="#fff1c9" opacity="0.8" />
        <circle cx="152" cy="116" r="1" fill="#fff1c9" opacity="0.8" />
      </g>

      {/* sleeve reaching forward */}
      <path d="M140 188 C 116 196, 88 208, 62 222 L 70 240 C 96 230, 124 222, 156 214 Z" fill="url(#keeper-robe)" />
      <path d="M140 188 C 116 196, 88 208, 62 222 L 70 240 C 96 230, 124 222, 156 214 Z" fill="url(#keeper-wash)" />
      <ellipse cx="65" cy="231" rx="7" ry="10" fill="#05060c" transform="rotate(-20 65 231)" />

      {/* lantern, swaying gently from the sleeve */}
      <g className="anim-sway" style={{ transformOrigin: '60px 232px' }}>
        <circle cx="56" cy="270" r="150" fill="url(#lantern-glow)" className="anim-ember" />
        <path d="M60 232 L57 246" stroke="#2a2418" strokeWidth="1.6" />
        <circle cx="56" cy="248" r="3.5" fill="none" stroke="#2a2418" strokeWidth="1.6" />
        <path d="M44 260 L68 260 L63 251 L49 251 Z" fill="#1a150d" />
        <rect x="42" y="260" width="28" height="38" rx="3" fill="url(#lantern-glass)" className="anim-ember" />
        <path
          d="M56 293 C 49 286, 50 278, 56 268 C 62 278, 63 286, 56 293 Z"
          fill="#fff1c9"
          className="anim-flame"
        />
        <g stroke="#1a150d" strokeWidth="2.2" fill="none">
          <rect x="42" y="260" width="28" height="38" rx="3" />
          <path d="M51 260 V298 M61 260 V298" strokeWidth="1.2" />
        </g>
        <path d="M40 298 L72 298 L68 305 L44 305 Z" fill="#1a150d" />
      </g>
    </svg>
  )
}

/** A broad, warm pool of lantern light that falls left across the URL input. */
export function LanternLight() {
  return (
    <div
      className="anim-ember-slow absolute inset-0"
      style={{
        background:
          'radial-gradient(ellipse 42% 36% at 80% 60%, rgba(255,138,31,0.13), rgba(255,138,31,0.04) 55%, transparent 75%)',
        animationDuration: '4.5s',
      }}
    />
  )
}
