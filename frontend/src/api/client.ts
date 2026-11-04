import type { CreateResurrectionRequest, LogsResponse, Resurrection } from '@contracts/types'
import { ApiRequestError } from './errors'
import { readAdminToken, type ResurrectApi } from './types'

const BASE_URL = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, admin = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (admin) {
    const token = readAdminToken()
    if (token) headers['X-Resurrect-Admin'] = token
  }

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiRequestError(0, 'internal', 'Could not reach the Resurrect server. Check your connection and try again.')
  }

  let parsed: unknown = null
  const text = await res.text()
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
  }
  if (!res.ok) throw ApiRequestError.fromEnvelope(res.status, parsed)
  return parsed as T
}

const enc = encodeURIComponent

export function createResurrection(repoUrl: string): Promise<Resurrection> {
  const body: CreateResurrectionRequest = { repo_url: repoUrl }
  return request<Resurrection>('POST', '/resurrections', body, true)
}

export function getResurrection(id: string): Promise<Resurrection> {
  return request<Resurrection>('GET', `/resurrections/${enc(id)}`)
}

export function getLogs(id: string, cursor: string | null): Promise<LogsResponse> {
  const q = cursor == null ? '' : `?cursor=${enc(cursor)}`
  return request<LogsResponse>('GET', `/resurrections/${enc(id)}/logs${q}`)
}

export function retryResurrection(id: string): Promise<Resurrection> {
  return request<Resurrection>('POST', `/resurrections/${enc(id)}/retry`, {}, true)
}

export function badgeUrl(id: string): string {
  return `${BASE_URL}/badge/${enc(id)}.svg`
}

export const httpApi: ResurrectApi = { createResurrection, getResurrection, getLogs, retryResurrection, badgeUrl }
