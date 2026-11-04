import sqlite3

from fastapi import FastAPI

app = FastAPI()
DB = "notes.db"  # relative path: must be writable, so it only works from the /tmp copy


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
