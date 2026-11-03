# Resurrect
Halloween-themed one-click deploys for students' dead GitHub repos.
Flow: autopsy (GitHub API + rules + Bedrock) -> seance (CodeBuild, polled logs) -> pulse check ->
risen (live CloudFront link for 20 minutes) or error ghost (cause, fix, command).
Region: us-east-1. Deployable stacks: static HTML, React (Vite), React (Create React App).

## Ownership (strict)
- Person A owns frontend/ and README.md.
- Person B owns backend/, buildspec/, infra/, scripts/.
- contracts/, CLAUDE.md and .gitignore are FROZEN. Never edit them. If a change seems needed,
  stop and tell the human.
- Never create or edit files outside your owner's folders.

## Source of truth
- contracts/api.md: endpoints, statuses, error codes.
- contracts/types.ts: every JSON shape. Backend models must serialise to exactly these.
- contracts/mock-scenarios.json: scripted stories the frontend mock replays.

## Conventions
- JSON keys snake_case; times ISO 8601 UTC with Z.
- No secrets in git. Secrets live in SSM Parameter Store.
- Copy is spooky in headlines, plain in details. Students must always understand what broke.
- All visuals are original, drawn in code. No stock images, no copyrighted characters.
