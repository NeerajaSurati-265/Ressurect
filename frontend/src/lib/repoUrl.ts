export type ParsedRepo = { owner: string; name: string; url: string }

// github.com/<owner>/<repo>, optional scheme, www, .git, trailing slash, or extra path (/tree/main, ?tab=…).
const REPO_RE =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/?#].*)?$/i

/** Returns the normalised https://github.com/owner/repo, or null when it isn't a repo link. */
export function parseRepoUrl(raw: string): ParsedRepo | null {
  const m = REPO_RE.exec(raw.trim())
  if (!m) return null
  const [, owner, name] = m
  if (name === '.' || name === '..') return null
  return { owner, name, url: `https://github.com/${owner}/${name}` }
}

export const INVALID_URL_COPY = "That isn't a grave we can find. Paste a github.com/owner/repo link."
