/**
 * Is an optional static asset really there? CloudFront serves index.html with 200 for missing
 * files (SPA fallback), so "ok" alone is a false positive. The asset counts as present only if the
 * response is ok AND its content-type starts with `typePrefix` (e.g. "audio/"). Never throws.
 */
const cache = new Map<string, Promise<boolean>>()

export function hasAsset(url: string, typePrefix: string): Promise<boolean> {
  const key = `${typePrefix}|${url}`
  let p = cache.get(key)
  if (!p) {
    p = (async () => {
      try {
        let res = await fetch(url, { method: 'HEAD', cache: 'no-cache' })
        // some static hosts reject HEAD; try a 1-byte ranged GET
        if (res.status === 405 || res.status === 501) {
          res = await fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-cache' })
        }
        const type = (res.headers.get('content-type') || '').toLowerCase()
        return res.ok && type.startsWith(typePrefix.toLowerCase())
      } catch {
        return false
      }
    })()
    cache.set(key, p)
  }
  return p
}
