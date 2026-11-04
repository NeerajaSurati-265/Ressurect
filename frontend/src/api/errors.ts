import type { ApiError, ErrorCode } from '@contracts/types'

/** Thrown for every non-2xx response (and for network failures, with status 0). */
export class ApiRequestError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly retry_after_s: number | null

  constructor(status: number, code: ErrorCode, message: string, retry_after_s: number | null = null) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.retry_after_s = retry_after_s
  }

  static fromEnvelope(status: number, body: unknown): ApiRequestError {
    const err = (body as Partial<ApiError> | null)?.error
    if (err && typeof err.code === 'string') {
      return new ApiRequestError(
        status,
        err.code,
        typeof err.message === 'string' ? err.message : 'Request failed.',
        typeof err.retry_after_s === 'number' ? err.retry_after_s : null,
      )
    }
    return new ApiRequestError(status, status === 404 ? 'not_found' : 'internal', `Request failed with status ${status}.`)
  }
}

export function isApiRequestError(e: unknown): e is ApiRequestError {
  return e instanceof ApiRequestError
}

/** Normalises anything thrown into an ApiRequestError so screens only handle one shape. */
export function toApiRequestError(e: unknown): ApiRequestError {
  if (isApiRequestError(e)) return e
  return new ApiRequestError(0, 'internal', 'Could not reach the Resurrect server. Check your connection and try again.')
}
