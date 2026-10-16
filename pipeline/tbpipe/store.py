"""Local SQLite state: run history, per-movie outcomes, and separate quota
counters per provider and per model.

No Triggerboxd table is ever touched. Nothing here is uploaded.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
create table if not exists runs (
  id integer primary key autoincrement,
  region text not null,
  window_start text not null,
  window_end text not null,
  timezone text not null,
  started_at text not null,
  finished_at text,
  summary_json text
);
create table if not exists run_movies (
  run_id integer not null references runs(id) on delete cascade,
  tmdb_id integer not null,
  status text not null,
  payload_json text not null,
  primary key (run_id, tmdb_id)
);
create table if not exists quota (
  scope text not null,        -- e.g. 'provider:subdl:download', 'model:deepseek-v4-flash:tokens'
  subject text not null,      -- provider or model name
  action text not null,       -- search | download | tokens | requests
  period text not null,       -- UTC day, e.g. 2026-10-15
  used integer not null default 0,
  primary key (scope, subject, action, period)
);
"""


def _utc_now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


class Store:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._db = sqlite3.connect(self.path)
        self._db.execute("pragma foreign_keys = on")
        self._db.executescript(SCHEMA)
        self._db.commit()

    def close(self) -> None:
        self._db.close()

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    # runs -----------------------------------------------------------------
    def start_run(self, *, region: str, window: dict) -> int:
        cursor = self._db.execute(
            "insert into runs (region, window_start, window_end, timezone, started_at) values (?,?,?,?,?)",
            (region, window["startDate"], window["endDate"], window["timezone"], _utc_now()),
        )
        self._db.commit()
        return int(cursor.lastrowid)

    def finish_run(self, run_id: int, summary: dict) -> None:
        self._db.execute(
            "update runs set finished_at = ?, summary_json = ? where id = ?",
            (_utc_now(), json.dumps(summary, ensure_ascii=False), run_id),
        )
        self._db.commit()

    def record_movie(self, run_id: int, tmdb_id: int, status: str, payload: dict) -> None:
        self._db.execute(
            "insert or replace into run_movies (run_id, tmdb_id, status, payload_json) values (?,?,?,?)",
            (run_id, tmdb_id, status, json.dumps(payload, ensure_ascii=False)),
        )
        self._db.commit()

    def recent_runs(self, limit: int = 10) -> list[dict]:
        rows = self._db.execute(
            "select id, region, window_start, window_end, started_at, finished_at from runs order by id desc limit ?",
            (limit,),
        ).fetchall()
        return [
            {"id": r[0], "region": r[1], "windowStart": r[2], "windowEnd": r[3], "startedAt": r[4], "finishedAt": r[5]}
            for r in rows
        ]

    def seen_tmdb_ids(self) -> set[int]:
        rows = self._db.execute("select distinct tmdb_id from run_movies").fetchall()
        return {int(r[0]) for r in rows}

    # quota ----------------------------------------------------------------
    @staticmethod
    def quota_period(when: datetime | None = None) -> str:
        moment = when or datetime.now(tz=timezone.utc)
        return moment.astimezone(timezone.utc).date().isoformat()

    def quota_used(self, *, scope: str, subject: str, action: str, period: str | None = None) -> int:
        row = self._db.execute(
            "select used from quota where scope=? and subject=? and action=? and period=?",
            (scope, subject, action, period or self.quota_period()),
        ).fetchone()
        return int(row[0]) if row else 0

    def quota_add(self, *, scope: str, subject: str, action: str, amount: int, period: str | None = None) -> int:
        if amount < 0:
            raise ValueError("amount must not be negative")
        day = period or self.quota_period()
        self._db.execute(
            """insert into quota (scope, subject, action, period, used) values (?,?,?,?,?)
               on conflict(scope, subject, action, period) do update set used = used + excluded.used""",
            (scope, subject, action, day, amount),
        )
        self._db.commit()
        return self.quota_used(scope=scope, subject=subject, action=action, period=day)

    def quota_reserve(self, *, scope: str, subject: str, action: str, amount: int,
                      ceiling: int, period: str | None = None) -> bool:
        """Atomically reserve allowance before an external request is dispatched."""
        if amount < 1 or ceiling < amount:
            return False
        day = period or self.quota_period()
        cursor = self._db.execute(
            """insert into quota (scope, subject, action, period, used) values (?,?,?,?,?)
               on conflict(scope, subject, action, period) do update set
                 used = used + excluded.used where used + excluded.used <= ?""",
            (scope, subject, action, day, amount, ceiling),
        )
        self._db.commit()
        return cursor.rowcount == 1

    def quota_release(self, *, scope: str, subject: str, action: str, amount: int,
                      period: str | None = None) -> None:
        """Return unused reserved capacity after reported usage is known."""
        if amount < 0:
            raise ValueError("release amount must not be negative")
        day = period or self.quota_period()
        self._db.execute(
            """update quota set used = max(0, used - ?) where
               scope=? and subject=? and action=? and period=?""",
            (amount, scope, subject, action, day),
        )
        self._db.commit()

    def quota_snapshot(self, period: str | None = None) -> list[dict]:
        day = period or self.quota_period()
        rows = self._db.execute(
            "select scope, subject, action, used from quota where period=? order by scope, subject, action",
            (day,),
        ).fetchall()
        return [{"scope": r[0], "subject": r[1], "action": r[2], "used": r[3], "period": day} for r in rows]
