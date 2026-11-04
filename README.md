# Resurrect

**Bring your dead repos back to life.**

![Resurrect demo GIF](docs/demo.gif)
<!-- TODO: record the demo GIF (paste a repo URL → séance → "It lives.") and save it as docs/demo.gif -->

**Live:** [https://YOUR-UI-DOMAIN.cloudfront.net](https://YOUR-UI-DOMAIN.cloudfront.net) <!-- TODO: replace with the real UI URL -->

Every student has a graveyard of GitHub repos: a React project from a course, a portfolio site, a hackathon
demo that only ever ran on a laptop. Resurrect gives each one a one-click deploy. Paste a public repo link and
Resurrect performs an **autopsy** (it detects the stack and flags problems such as a missing lockfile or a
committed `.env`), holds a **séance** (a real build in AWS CodeBuild with the logs streamed live), checks for a
**pulse** and then raises the app at a live link for 20 minutes, with a README badge to prove it. If the build
dies, an **error ghost** explains in plain words what broke, how to fix it and the exact command to run.

## Architecture

![Resurrect architecture diagram](docs/architecture.png)
<!-- TODO: export the architecture diagram to docs/architecture.png -->

Flow: autopsy (GitHub API + rules + Bedrock) → séance (CodeBuild, polled logs) → pulse check → risen (live
CloudFront link for 20 minutes) or error ghost (cause, fix, command). Region: `us-east-1`.

Deployable stacks: static HTML, React (Vite), React (Create React App).

### AWS services

- **AWS Lambda**: the API (create, status, logs, retry, badge) and the state machine
- **AWS CodeBuild**: clones and builds each repo in isolation
- **Amazon S3**: hosts the Resurrect UI, the built apps (`graves/<id>/`) and the RIP page
- **Amazon CloudFront**: serves the UI and every resurrected app over HTTPS
- **Amazon DynamoDB**: resurrection records, rate limits and the daily quota
- **Amazon Bedrock**: writes the autopsy summary and turns build failures into error ghosts
- **Amazon EventBridge Scheduler**: lays each app to rest when its 20 minutes are up

## Run it locally

### Frontend (mock mode, no AWS needed)

The frontend ships with a mock API that replays the stories in `contracts/mock-scenarios.json` in real time,
so every screen works without the backend.

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, mock mode is on via .env.development
```

Try these repo URLs to see each story:

| Repo URL contains | What happens |
| --- | --- |
| anything else | autopsy with one warning → séance → pulse check → "It lives." with a 20-minute countdown |
| `broken` | the build fails with a missing dependency; the error ghost explains it; **Try again** succeeds |
| `api` or `python` | a FastAPI backend: "This spirit can't rise yet" with the fixes |
| `greedy` | turned away with HTTP 429 (rate limited) |

To watch the countdown expire quickly: `VITE_MOCK_LIFETIME_S=60 npm run dev`.
See `frontend/.env.example` for every setting.

```bash
npm run build        # type-check and production build
npm run lint         # oxlint
```

### Backend

<!-- TODO (backend owner): local setup, tests and deploy steps for backend/, buildspec/ and infra/. -->
_Coming soon._

### Deploying the frontend

`frontend/deploy.sh` builds the UI against the real API, uploads it to S3 with long-lived caching for hashed
assets, publishes the RIP page and invalidates CloudFront. It needs `BUCKET`, `UI_DISTRIBUTION_ID`,
`GRAVES_DISTRIBUTION_ID`, `UI_URL` and `API_BASE_URL` set, and AWS credentials for `us-east-1`.

## Credits

- Fonts from Google Fonts, all under the SIL Open Font License (OFL):
  [Cinzel](https://fonts.google.com/specimen/Cinzel) by Natanael Gama,
  [Inter](https://fonts.google.com/specimen/Inter) by Rasmus Andersson,
  [Special Elite](https://fonts.google.com/specimen/Special+Elite) by Astigmatic.
- Every illustration (the graveyard, the Keeper, the ghost, tombstones, bats and pumpkins) is original and
  drawn in code with SVG, canvas and CSS. No stock images and no copyrighted characters.

Builds on my earlier project DeployForge ([link](https://github.com/YOUR-GITHUB/DeployForge)). Built during
Hack-to-Ween: autopsy, stack detection, graveyard UI, error ghosts, live build logs, pulse check, cost
guardrails.
<!-- TODO: replace the DeployForge link with the real repository URL -->
