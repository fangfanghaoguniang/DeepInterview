"""Offline tests for the session repositories.

``MemoryRepository`` is exercised directly. ``SupabaseRepository`` — the
PRODUCTION persistence of the live-result write-back, scorecard save, status
transitions, and the session-view read — is exercised through an injected fake
recording client: ``_table()`` only imports the optional ``supabase`` SDK when
``self._client is None``, so setting ``repo._client`` to a postgrest-shaped
fake runs every real repository method offline (conftest blanks the creds, so
nothing else in the suite ever constructs this class). The fake JSON-encodes
every write payload exactly where the real SDK would, pinning that python-mode
``model_dump()`` payloads stay JSON-safe on the hosted path too.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from deepinterview_agent.core.adapters.mock import build_mock
from deepinterview_agent.core.persistence.repository import (
    MemoryRepository,
    PostgresRepository,
    SupabaseRepository,
)
from deepinterview_agent.shared_models import (
    AnswerRecord,
    InterviewContext,
    LanguageMode,
    PrepRequest,
    ScoreCard,
)

# apps/agent/tests/ -> repo root -> the migrations that define public.sessions.
_MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "supabase" / "migrations"


def _run(coro):
    return asyncio.run(coro)


def _prep_request() -> PrepRequest:
    return PrepRequest(
        cv_url="https://example.com/cv.pdf",
        jd_text="We are hiring a backend engineer.",
        company="Acme Payments",
        language_mode=LanguageMode(primary="en", mixed=False),
    )


def test_create_save_load_round_trip() -> None:
    repo = MemoryRepository()
    session_id = _run(repo.create_session(_prep_request()))
    assert session_id.startswith("sess_")
    assert repo.get_status(session_id) == "prep"

    ctx = build_mock(InterviewContext)
    assert isinstance(ctx, InterviewContext)
    _run(repo.save_context(session_id, ctx))

    loaded = _run(repo.load_context(session_id))
    assert loaded is not None
    assert loaded.model_dump() == ctx.model_dump()


def test_create_session_stamps_user_id() -> None:
    """Regression (report RLS bug, PR #5): the owning user must land on the row.

    Dropping the ``user_id=req.user_id`` stamp would silently pass the rest of
    the suite while breaking the hosted layer's RLS ownership read
    (``auth.uid() = user_id`` in supabase/migrations/0001_init.sql).
    """
    repo = MemoryRepository()
    owner = "11111111-2222-3333-4444-555555555555"
    req = _prep_request().model_copy(update={"user_id": owner})
    session_id = _run(repo.create_session(req))
    assert repo._rows[session_id].user_id == owner

    # The offline/no-auth path stays ownerless (None), never an empty string.
    anon_id = _run(repo.create_session(_prep_request()))
    assert repo._rows[anon_id].user_id is None


def test_save_coach_transcript_does_not_touch_interview_transcript() -> None:
    """The spoken coach's log persists separately from the interview record."""
    repo = MemoryRepository()
    session_id = _run(repo.create_session(_prep_request()))
    interview = [{"role": "user", "text": "my interview answer"}]
    coach = [{"role": "assistant", "text": "let's drill system design"}]
    _run(repo.save_transcript(session_id, interview))
    _run(repo.save_coach_transcript(session_id, coach))
    row = repo._rows[session_id]
    assert row.transcript == interview
    assert row.coach_transcript == coach


def test_practice_state_round_trips_per_competency() -> None:
    """Memory path: fresh session reads {}, unknown reads None, and setting one
    competency must not clobber the others (the coach grades one at a time)."""
    repo = MemoryRepository()
    session_id = _run(repo.create_session(_prep_request()))
    assert _run(repo.get_practice_state(session_id)) == {}
    assert _run(repo.get_practice_state("sess_missing")) is None

    _run(repo.set_practice_state(session_id, "System Design", "shaky"))
    _run(repo.set_practice_state(session_id, "Leadership", "learning"))
    assert _run(repo.get_practice_state(session_id)) == {
        "System Design": "shaky",
        "Leadership": "learning",
    }
    # Re-grade one competency; the other survives.
    _run(repo.set_practice_state(session_id, "System Design", "mastered"))
    assert _run(repo.get_practice_state(session_id)) == {
        "System Design": "mastered",
        "Leadership": "learning",
    }


def test_drill_items_round_trip_and_upsert_by_id() -> None:
    """Memory path: fresh session reads [], unknown reads None, re-adding the
    same drill id updates in place (no duplicate), a new id appends."""
    repo = MemoryRepository()
    session_id = _run(repo.create_session(_prep_request()))
    assert _run(repo.get_drill_items(session_id)) == []
    assert _run(repo.get_drill_items("sess_missing")) is None

    a = [{"id": "drill_1", "competency": "X", "text": {"en": "q1"}, "answer": "a1"}]
    _run(repo.add_drill_items(session_id, a))
    assert _run(repo.get_drill_items(session_id)) == a

    _run(
        repo.add_drill_items(
            session_id,
            [{"id": "drill_1", "competency": "X", "text": {"en": "q1b"}, "answer": "a1b"}],
        )
    )
    _run(
        repo.add_drill_items(
            session_id,
            [{"id": "drill_2", "competency": "Y", "text": {"en": "q2"}, "answer": "a2"}],
        )
    )
    stored = _run(repo.get_drill_items(session_id))
    assert {d["id"] for d in stored} == {"drill_1", "drill_2"}
    assert next(d for d in stored if d["id"] == "drill_1")["answer"] == "a1b"


def test_update_status_and_missing_load() -> None:
    repo = MemoryRepository()
    session_id = _run(repo.create_session(_prep_request()))
    _run(repo.update_status(session_id, "ready"))
    assert repo.get_status(session_id) == "ready"
    # A session with no saved context returns None.
    assert _run(repo.load_context("sess_does_not_exist")) is None


def test_append_answer_and_save_scorecard() -> None:
    repo = MemoryRepository()
    session_id = _run(repo.create_session(_prep_request()))

    answer = AnswerRecord(
        question_id="q1",
        transcript="A mock answer.",
        started_at="2026-06-08T09:00:00Z",
        ended_at="2026-06-08T09:01:00Z",
    )
    _run(repo.append_answer(session_id, answer))

    scorecard = build_mock(ScoreCard)
    assert isinstance(scorecard, ScoreCard)
    _run(repo.save_scorecard(session_id, scorecard))

    _run(repo.save_transcript(session_id, [{"role": "agent", "text": "hi"}]))


# --- SupabaseRepository via an injected fake recording client -----------------


class _FakeSupabaseResponse:
    def __init__(self, data: list[dict]) -> None:
        self.data = data


class _FakeSessionsTable:
    """One postgrest-style chained call (insert/update/select … execute).

    Executes against a shared in-memory row store and appends
    ``(op, payload_or_columns, session_id)`` to the shared log. Every WRITE
    payload is ``json.dumps``-encoded first — the boundary where the real SDK
    serializes — so a non-JSON type (datetime/enum) added to a model breaks
    these tests instead of only the hosted deployment.
    """

    def __init__(self, store: dict[str, dict], log: list[tuple]) -> None:
        self._store = store
        self._log = log
        self._op: str | None = None
        self._payload: Any = None
        self._cols: str | None = None
        self._id: str | None = None

    def insert(self, payload: dict) -> _FakeSessionsTable:
        self._op, self._payload = "insert", payload
        return self

    def update(self, values: dict) -> _FakeSessionsTable:
        self._op, self._payload = "update", values
        return self

    def select(self, cols: str) -> _FakeSessionsTable:
        self._op, self._cols = "select", cols
        return self

    def eq(self, col: str, value: str) -> _FakeSessionsTable:
        assert col == "id", "the repository only ever filters by primary key"
        self._id = value
        return self

    def limit(self, n: int) -> _FakeSessionsTable:
        return self

    def execute(self) -> _FakeSupabaseResponse:
        if self._op == "insert":
            json.dumps(self._payload)  # the SDK JSON-encodes; non-JSON fails HERE
            self._log.append(("insert", self._payload, self._payload["id"]))
            self._store[self._payload["id"]] = dict(self._payload)
            return _FakeSupabaseResponse([self._payload])
        if self._op == "update":
            json.dumps(self._payload)
            self._log.append(("update", self._payload, self._id))
            row = self._store.get(self._id or "")
            if row is not None:
                row.update(self._payload)
            return _FakeSupabaseResponse([row] if row is not None else [])
        assert self._op == "select"
        self._log.append(("select", self._cols, self._id))
        row = self._store.get(self._id or "")
        if row is None:
            return _FakeSupabaseResponse([])
        cols = [c.strip() for c in (self._cols or "").split(",")]
        return _FakeSupabaseResponse([{c: row.get(c) for c in cols}])


class _FakeSupabaseClient:
    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}
        self.log: list[tuple] = []

    def table(self, name: str) -> _FakeSessionsTable:
        assert name == "sessions", "all session persistence lives in public.sessions"
        return _FakeSessionsTable(self.rows, self.log)


def _supabase_repo() -> tuple[SupabaseRepository, _FakeSupabaseClient]:
    repo = SupabaseRepository("https://example.supabase.co", "service-role-key")
    fake = _FakeSupabaseClient()
    repo._client = fake  # _table() only imports the SDK when _client is None
    return repo, fake


def test_supabase_create_and_context_round_trip_payloads_are_json_safe() -> None:
    """create_session/save_context write python-mode ``model_dump()`` payloads:
    they must stay JSON-encodable AND round-trip through ``load_context`` —
    the exact read the scoring pipeline performs on the hosted path."""
    repo, fake = _supabase_repo()
    session_id = _run(repo.create_session(_prep_request()))
    assert session_id.startswith("sess_")
    assert fake.rows[session_id]["status"] == "prep"
    assert fake.rows[session_id]["jd_text"] == "We are hiring a backend engineer."

    ctx = build_mock(InterviewContext)
    assert isinstance(ctx, InterviewContext)
    _run(repo.save_context(session_id, ctx))  # raises in execute() if non-JSON

    loaded = _run(repo.load_context(session_id))
    assert loaded is not None
    assert loaded.model_dump() == ctx.model_dump()
    # Unknown ids read as None, never raise (the worker treats this as "not ready").
    assert _run(repo.load_context("sess_missing")) is None


def test_supabase_create_session_stamps_user_id_column() -> None:
    """The RLS ownership column (report bug, PR #5) must land on the INSERT
    payload on the Supabase path too — auth.uid() = user_id reads depend on it."""
    repo, fake = _supabase_repo()
    owner = "11111111-2222-3333-4444-555555555555"
    sid = _run(repo.create_session(_prep_request().model_copy(update={"user_id": owner})))
    assert fake.rows[sid]["user_id"] == owner
    anon = _run(repo.create_session(_prep_request()))
    assert fake.rows[anon]["user_id"] is None


def test_supabase_update_status_writes_each_live_terminal_status() -> None:
    """The live path's status transitions (no_answers / error / complete) must
    each become a ``{"status": ...}`` update against the row."""
    repo, fake = _supabase_repo()
    sid = _run(repo.create_session(_prep_request()))
    for status in ("no_answers", "error", "complete"):
        _run(repo.update_status(sid, status))
        assert fake.rows[sid]["status"] == status
        assert ("update", {"status": status}, sid) in fake.log


def test_supabase_save_scorecard_payload_is_json_encodable() -> None:
    """save_scorecard ships ``sc.model_dump()`` (python mode) to the SDK: it
    must JSON-encode and land in the ``scorecard`` column unchanged."""
    repo, fake = _supabase_repo()
    sid = _run(repo.create_session(_prep_request()))
    sc = build_mock(ScoreCard)
    assert isinstance(sc, ScoreCard)
    _run(repo.save_scorecard(sid, sc))  # raises in execute() if non-JSON
    assert fake.rows[sid]["scorecard"] == sc.model_dump()


def test_supabase_set_practice_state_read_modify_writes_single_key() -> None:
    """Supabase path mirrors mark_progress: read the blob, set one competency
    key, write it back — and skip the UPDATE when the value is unchanged."""
    repo, fake = _supabase_repo()
    sid = _run(repo.create_session(_prep_request()))
    assert _run(repo.get_practice_state(sid)) == {}

    _run(repo.set_practice_state(sid, "System Design", "shaky"))
    _run(repo.set_practice_state(sid, "Leadership", "learning"))
    assert fake.rows[sid]["practice_state"] == {
        "System Design": "shaky",
        "Leadership": "learning",
    }
    assert _run(repo.get_practice_state(sid)) == {
        "System Design": "shaky",
        "Leadership": "learning",
    }

    # Idempotent re-set issues no new update against the row.
    updates_before = len([op for op, *_ in fake.log if op == "update"])
    _run(repo.set_practice_state(sid, "System Design", "shaky"))
    assert len([op for op, *_ in fake.log if op == "update"]) == updates_before


def test_supabase_add_drill_items_read_modify_upserts_by_id() -> None:
    """Supabase path mirrors the practice-state read-modify-write: drills land
    in the ``drill_items`` column and a byte-identical re-add issues no update."""
    repo, fake = _supabase_repo()
    sid = _run(repo.create_session(_prep_request()))
    assert _run(repo.get_drill_items(sid)) == []

    items = [{"id": "drill_1", "competency": "X", "text": {"en": "q"}, "answer": "a"}]
    merged = _run(repo.add_drill_items(sid, items))
    assert merged == items
    assert fake.rows[sid]["drill_items"] == items

    updates_before = len([op for op, *_ in fake.log if op == "update"])
    _run(repo.add_drill_items(sid, items))
    assert len([op for op, *_ in fake.log if op == "update"]) == updates_before


def test_supabase_append_answer_read_modify_writes_the_context_blob() -> None:
    """Supabase ``append_answer`` mutates the canonical context blob (the
    Memory/Supabase asymmetry test_score.py's docstring warns about): the
    appended answer must be visible to a later ``load_context``. With no
    context saved yet it is a silent no-op (no update issued)."""
    repo, fake = _supabase_repo()
    sid = _run(repo.create_session(_prep_request()))
    ctx = build_mock(InterviewContext)
    assert isinstance(ctx, InterviewContext)
    base_answers = len(ctx.answers)
    _run(repo.save_context(sid, ctx))

    answer = AnswerRecord(
        question_id="q1",
        transcript="A real spoken answer.",
        started_at="2026-06-11T09:00:00Z",
        ended_at="2026-06-11T09:01:00Z",
    )
    _run(repo.append_answer(sid, answer))

    loaded = _run(repo.load_context(sid))
    assert loaded is not None
    assert len(loaded.answers) == base_answers + 1
    assert loaded.answers[-1].model_dump() == answer.model_dump()

    # No context yet -> append must not write anything.
    sid2 = _run(repo.create_session(_prep_request()))
    updates_before = len([op for op, *_ in fake.log if op == "update"])
    _run(repo.append_answer(sid2, answer))
    assert len([op for op, *_ in fake.log if op == "update"]) == updates_before


def test_supabase_get_session_view_selects_migration_columns_and_maps_row() -> None:
    """``get_session_view`` must select exactly the columns the migrations
    create and map them onto SessionView (status/progress/prep_warnings/
    context/scorecard) — a renamed or dropped column fails here, not only in
    the hosted deployment."""
    repo, fake = _supabase_repo()
    sid = _run(repo.create_session(_prep_request()))
    ctx = build_mock(InterviewContext)
    sc = build_mock(ScoreCard)
    _run(repo.save_context(sid, ctx))
    _run(repo.save_scorecard(sid, sc))
    _run(repo.mark_progress(sid, "cv_analysis"))
    _run(repo.mark_progress(sid, "cv_analysis"))  # idempotent: no duplicate
    _run(repo.add_warnings(sid, ["JD text is very short."]))
    _run(repo.update_status(sid, "complete"))

    view = _run(repo.get_session_view(sid))
    assert view is not None
    assert (view.session_id, view.status) == (sid, "complete")
    assert view.progress == ["cv_analysis"]
    assert view.prep_warnings == ["JD text is very short."]
    assert view.context is not None
    assert view.context.model_dump() == ctx.model_dump()
    assert view.scorecard is not None
    assert view.scorecard.model_dump() == sc.model_dump()

    # Pin the select column list against what the migrations actually create.
    select_cols = [cols for op, cols, row_id in fake.log if op == "select" and row_id == sid][-1]
    assert select_cols == "id,status,progress,prep_warnings,context,scorecard"
    migration_files = sorted(_MIGRATIONS_DIR.glob("*.sql"))
    assert migration_files, f"no migrations found under {_MIGRATIONS_DIR}"
    migrations_sql = "".join(p.read_text() for p in migration_files)
    for col in select_cols.split(","):
        assert col in migrations_sql, f"selected column {col!r} not defined by any migration"

    # Unknown ids map to None (the API turns this into a 404, not a 500).
    assert _run(repo.get_session_view("sess_missing")) is None


def test_memory_study_cas_is_atomic_and_merges_without_aliasing() -> None:
    repo = MemoryRepository()
    sid = _run(repo.create_session(_prep_request()))
    state = {"version": "v", "view": {"targets": []}}

    async def race():
        return await asyncio.gather(*(repo.compare_and_set_study(
            sid, 0, state, [{"id": f"d{i}"}], {f"c{i}": "shaky"},
        ) for i in range(8)))

    assert sum(_run(race())) == 1
    assert _run(repo.compare_and_set_study(sid, 1, state,
        [{"id": "d0", "answer": "新版"}, {"id": "d9"}], {"c9": "learning"}))
    data = _run(repo.get_learning_data(sid))
    assert data["study_revision"] == 2
    assert data["practice_state"] == {"c0": "shaky", "c9": "learning"}
    assert {d["id"] for d in data["drill_items"]} == {"d0", "d9"}
    data["study_state"]["view"]["targets"].append("外部修改")
    state["version"] = "不能影响持久值"
    assert _run(repo.get_learning_data(sid))["study_state"] == {"version": "v", "view": {"targets": []}}


def test_supabase_study_uses_rpc_and_preserves_conflict_response() -> None:
    from types import SimpleNamespace

    repo, fake = _supabase_repo()
    sid = _run(repo.create_session(_prep_request()))
    fake.rows[sid].update(study_state={}, study_revision=7, drill_items=[], practice_state={})
    assert _run(repo.get_learning_data(sid))["study_revision"] == 7
    calls = []

    def rpc(name, payload):
        calls.append((name, json.loads(json.dumps(payload))))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=payload["p_revision"] == 7))

    fake.rpc = rpc
    assert _run(repo.compare_and_set_study(sid, 7, {"version": "v"}, [{"id": "d"}], {"能力": "shaky"}))
    assert calls[-1] == ("study_compare_and_set", {
        "p_session_id": sid, "p_revision": 7, "p_state": {"version": "v"},
        "p_drills": [{"id": "d"}], "p_practice": {"能力": "shaky"},
    })
    assert not _run(repo.compare_and_set_study(sid, 6, {}))
    assert calls[-1][1]["p_drills"] == [] and calls[-1][1]["p_practice"] == {}


def test_postgres_decodes_jsonb_and_sends_atomic_cas_parameters() -> None:
    from types import SimpleNamespace

    calls = []
    context = build_mock(InterviewContext)
    score = build_mock(ScoreCard)

    class Connection:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def fetchrow(self, sql, *args):
            calls.append((sql, args))
            if "study_compare_and_set" in sql:
                return {"ok": args[1] == 4}
            return {"id": "sess_pg", "status": "complete", "context": context.model_dump_json(),
                    "scorecard": score.model_dump_json(), "progress": '["ready"]',
                    "prep_warnings": '[]', "study_state": '{"version":"v"}',
                    "study_revision": 4, "drill_items": '[]', "practice_state": '{}',
                    "language_mode": '{"primary":"zh","mixed":false}'}

        async def fetch(self, sql, *args):
            return [await self.fetchrow(sql, *args)]

    repo = PostgresRepository("未连接的测试地址")
    repo._pool = SimpleNamespace(acquire=Connection)
    assert _run(repo.load_context("sess_pg")) == context
    assert _run(repo.get_session_view("sess_pg")).scorecard == score
    assert _run(repo.get_learning_data("sess_pg"))["study_state"] == {"version": "v"}
    assert _run(repo._fetch("test"))[0]["progress"] == ["ready"]
    assert _run(repo.compare_and_set_study("sess_pg", 4, {"version": "v"},
                                         [{"id": "d"}], {"能力": "mastered"}))
    sql, args = calls[-1]
    assert "study_compare_and_set" in sql
    assert args[:2] == ("sess_pg", 4)
    assert [json.loads(value) for value in args[2:]] == [
        {"version": "v"}, [{"id": "d"}], {"能力": "mastered"},
    ]
    assert not _run(repo.compare_and_set_study("sess_pg", 3, {}))
