from app.models import Autopsy, Pulse, RepoRef, Resurrection, StoredRecord

T0 = "2026-11-04T07:30:00Z"


def make_autopsy(**kw):
    base = dict(verdict="healthy", stack="react-vite", app_dir=".", summary="ok", findings=[], source="rules")
    base.update(kw)
    return Autopsy(**base)


def make_record(status="summoning", build_id="resurrect-build:abc", **res_kw) -> StoredRecord:
    res = dict(
        id="r-abc123", repo=RepoRef(owner="rahul", name="todo", url="https://github.com/rahul/todo",
                                    default_branch="main", commit_sha="9f2c1e7"),
        status=status, stack="react-vite", deployable=True, attempt=1, phase_message="Summoning",
        autopsy=make_autopsy(), created_at=T0, server_time=T0)
    res.update(res_kw)
    return StoredRecord(res=Resurrection(**res), build_id=build_id)


def pulsing(**kw) -> StoredRecord:
    rec = make_record("checking_pulse", **kw)
    rec.res.pulse = Pulse(attempts=0, max_attempts=20)
    rec.pulse_started_at = "2026-11-04T07:32:00Z"
    return rec


class FakeLogs:
    """CloudWatch Logs stand-in: tokens are "f/<index>", same token when nothing is new."""

    def __init__(self, messages=()):
        self.events = []
        for m in messages:
            self.add(m)
        self.calls = []

    def add(self, message, ts=1_762_241_400_000):
        self.events.append({"timestamp": ts + len(self.events) * 1000, "message": message})

    def get_log_events(self, logGroupName, logStreamName, startFromHead=True, nextToken=None, limit=None):
        self.calls.append(nextToken)
        start = int(nextToken.split("/")[1]) if nextToken else 0
        if not startFromHead:
            return {"events": self.events[-(limit or 100):]}
        return {"events": self.events[start:], "nextForwardToken": f"f/{len(self.events)}"}
