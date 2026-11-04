"""Placeholder API. B2 replaces this with the real routes."""
import os

from fastapi import FastAPI
from mangum import Mangum

app = FastAPI(title="Resurrect API")


@app.get("/health")
def health():
    enabled = os.environ.get("RESURRECTIONS_ENABLED", "true").lower() == "true"
    return {"ok": True, "resurrections_enabled": enabled}


handler = Mangum(app, lifespan="off")
