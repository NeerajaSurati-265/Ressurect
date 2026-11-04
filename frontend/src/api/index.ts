import { httpApi } from './client'
import type { ResurrectApi } from './types'

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

/**
 * The one API object the app uses. It never knows which implementation it got.
 * The mock is imported only when VITE_USE_MOCK is "true", so production bundles don't carry it.
 */
export const api: ResurrectApi = USE_MOCK ? (await import('./mock')).mockApi : httpApi

export { ApiRequestError, isApiRequestError, toApiRequestError } from './errors'
export type { ResurrectApi } from './types'
