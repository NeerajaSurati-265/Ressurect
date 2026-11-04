import type { LogsResponse, Resurrection } from '@contracts/types'

/** The surface every implementation (HTTP or mock) provides. The app only sees this. */
export interface ResurrectApi {
  createResurrection(repoUrl: string): Promise<Resurrection>
  getResurrection(id: string): Promise<Resurrection>
  getLogs(id: string, cursor: string | null): Promise<LogsResponse>
  retryResurrection(id: string): Promise<Resurrection>
  badgeUrl(id: string): string
}

export const ADMIN_STORAGE_KEY = 'resurrect.admin'

/** Admin token from localStorage, if any. Storage can throw in private modes, so this never does. */
export function readAdminToken(): string | null {
  try {
    const v = window.localStorage.getItem(ADMIN_STORAGE_KEY)
    return v && v.trim() ? v.trim() : null
  } catch {
    return null
  }
}
