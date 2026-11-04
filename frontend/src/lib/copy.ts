import type { ErrorCode, ResurrectionStatus, Stack } from '@contracts/types'

// Copy from frontend/DESIGN.md (Copy voice). Spooky headline, plain detail.
export const COPY = {
  tagline: 'Bring your dead repos back to life.',
  alive: 'It lives.',
  fallbackGhost: 'The spirits are silent. Here is the raw log.',
  cannotRiseHeadline: "This spirit can't rise yet.",
  cannotRiseBody: "We can only raise static sites and React apps today, but here's what's wrong with it.",
  expired: 'Rest in peace. Resurrect again?',
  emptyGraveyard: 'Your graveyard is empty. For now.',
  notFound: 'You wandered off the path.',
}

export const STACK_LABEL: Record<Stack, string> = {
  static: 'Static HTML',
  'react-vite': 'React (Vite)',
  'react-cra': 'React (Create React App)',
  'node-other': 'Node.js (other)',
  python: 'Python',
  unknown: 'Unknown stack',
}

/** Plain words for the aria-live region. */
export const STATUS_ANNOUNCEMENT: Record<ResurrectionStatus, string> = {
  summoning: 'Ritual started. The build is queued.',
  building: 'Build started',
  checking_pulse: 'Build finished. Checking that your app responds.',
  alive: 'Your app is live',
  failed: 'The build failed',
  cannot_rise: 'This repo cannot be deployed. The autopsy lists what to fix.',
  expired: 'Your app has expired and was taken down',
}

type TurnedAwayCopy = { headline: string; detail: string }

export function turnedAwayCopy(code: ErrorCode, retryAfterS: number | null, serverMessage: string): TurnedAwayCopy {
  switch (code) {
    case 'invalid_url':
      return { headline: "That isn't a grave we can find.", detail: 'Paste a github.com/owner/repo link.' }
    case 'repo_not_found':
      return {
        headline: 'No grave by that name.',
        detail: 'Is the repo public? We could not find it on GitHub. Check the owner and name, and make sure it is not private.',
      }
    case 'repo_too_large':
      return {
        headline: 'This one is too heavy to lift (over 100 MB).',
        detail: 'Resurrect can only clone repositories up to 100 MB. Remove large files (videos, datasets, build output) and try again.',
      }
    case 'rate_limited': {
      const mm = Math.max(1, Math.ceil((retryAfterS ?? 3600) / 60))
      return {
        headline: `The graveyard is full for you this hour. Return in ${mm} ${mm === 1 ? 'minute' : 'minutes'}.`,
        detail: 'You have started the maximum number of resurrections allowed per hour from your network.',
      }
    }
    case 'quota_exhausted':
      return {
        headline: "Tonight's rituals are spent. Come back tomorrow.",
        detail: 'Resurrect has used its daily build allowance for everyone. It resets at midnight UTC.',
      }
    case 'resurrections_disabled':
      return {
        headline: 'The spirits are resting. Resurrections are paused.',
        detail: 'New deploys are switched off for the moment. Apps that are already live keep running.',
      }
    case 'not_found':
      return {
        headline: 'This grave is empty.',
        detail: 'We could not find a resurrection with that link. It may have been cleared away after it expired.',
      }
    case 'not_retryable':
      return {
        headline: 'This spirit cannot be called back right now.',
        detail: 'Only a failed build can be retried. Reload the page to see its current state.',
      }
    case 'internal':
    default:
      return {
        headline: 'Something stirred in the dark.',
        detail: serverMessage || 'The server hit an unexpected error. Please try again in a moment.',
      }
  }
}
