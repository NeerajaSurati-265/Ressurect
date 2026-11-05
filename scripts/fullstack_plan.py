"""Run the REAL autopsy (flags on) over a local repo folder and print what B5 would do, as shell variables.

  backend/.venv/bin/python -I scripts/fullstack_plan.py <repo-dir>      (used by local_fullstack_repo.sh)

The file fetches are served from disk but go through the same planning and caps as autopsy.run().
No AWS, no network, no Bedrock.
"""
import os
import shlex
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
os.environ.update(BACKENDS_ENABLED="true", FULLSTACK_ENABLED="true")

from app import autopsy, bedrock, builds, detect, github  # noqa: E402

bedrock.converse_json = lambda *a, **k: None
repo = os.path.abspath(sys.argv[1])
paths = subprocess.check_output(["git", "-C", repo, "ls-files"], text=True).split("\n")
paths = [p for p in paths if p]
fetched = []


def fake_raw(client, owner, name, branch, wanted):
    fetched.extend(wanted)
    out = {}
    for p in wanted:
        full = os.path.join(repo, p)
        if os.path.isfile(full):
            out[p] = open(full, encoding="utf-8", errors="replace").read()[:200_000]
    return out


github.fetch_raw_files = fake_raw
app_dir, wanted = autopsy.plan_fetch(paths, True)
files = fake_raw(None, "", "", "", wanted)
files.update(fake_raw(None, "", "", "", detect.extra_files(app_dir, paths, files)))
files.update(autopsy._fullstack_files(None, "", "", "", paths, files))
a, pkg, info, fs = autopsy.analyze_full(paths, files, True, True)

for f in a.findings:
    print("# finding %-5s %-22s %s" % (f.severity, f.id, f.title), file=sys.stderr)
print("# verdict=%s stack=%s fetched=%d files" % (a.verdict, a.stack, len(set(fetched))), file=sys.stderr)
if fs is None:
    print("FS=0")
    sys.exit(0)
env = builds.wiring_env("https://abcd1234.lambda-url.us-east-1.on.aws", fs.env_names if fs.wiring_kind == "env" else [],
                        fs.localhost_urls if fs.wiring_kind == "localhost" else [])
vals = dict(FS=1, FE_DIR=fs.frontend_dir, FE_STACK=fs.frontend_stack, BE_DIR=fs.backend_dir, BE_RUNTIME=fs.backend.runtime,
            BE_ENTRY=fs.backend.entry, BE_PORT=fs.backend.app_port, BE_DJANGO=fs.backend.django_project or "",
            BE_PROBES=" ".join(fs.backend.probe_paths), WIRING=fs.wiring_kind, APP_CORS=int(fs.app_cors),
            WIRE_ENV_NAMES=env.get("WIRE_ENV_NAMES", ""), REWRITE_ORIGINS=env.get("REWRITE_ORIGINS", ""),
            WARNINGS=" ".join(f.id for f in a.findings if f.severity == "warn"))
for k, v in vals.items():
    print("%s=%s" % (k, shlex.quote(str(v))))
