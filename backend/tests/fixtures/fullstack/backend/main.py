import sqlite3

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
DB = "notes.db"


def conn():
    c = sqlite3.connect(DB)
    c.execute("create table if not exists notes (id integer primary key, text text)")
    return c


@app.post("/notes")
def add(text: str):
    c = conn()
    c.execute("insert into notes(text) values (?)", (text,))
    c.commit()
    return {"ok": True}


@app.get("/notes")
def notes():
    return [r[0] for r in conn().execute("select text from notes")]
