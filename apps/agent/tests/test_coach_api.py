"""Offline API tests for the WP-4 coach endpoints (FastAPI TestClient)."""

import asyncio

from fastapi.testclient import TestClient

from deepinterview_agent.app import create_app
from deepinterview_agent.core.adapters.mock import build_mock
from deepinterview_agent.core.deps import build_deps
from deepinterview_agent.shared_models import (
    GrowthItem,
    InterviewContext,
    LanguageMode,
    PrepRequest,
    ScoreCard,
)


def _client() -> TestClient:
    return TestClient(create_app())


def _scorecard_body(weak: list[str]) -> dict:
    comp = [
        {"competency": c, "score": 1.5, "evidence": f"struggled with {c}", "level": "weak"}
        for c in weak
    ]
    return {
        "overall_score": 1.5,
        "competency_scores": comp,
        "strengths": [],
        "weaknesses": list(weak),
        "weak_competencies": list(weak),
        "model_answers": [],
        "next_steps": [],
        "language_report": {
            "fluency_score": 3.0,
            "filler_word_count": 1,
            "clarity_score": 3.0,
            "code_switching_notes": "",
            "pronunciation_notes": "",
            "summary": "ok",
        },
        "summary": "test",
    }


def test_coach_plan_endpoint() -> None:
    resp = _client().post(
        "/api/coach/plan",
        json={"scorecard": _scorecard_body(["System Design", "Leadership"])},
    )
    assert resp.status_code == 200
    plan = resp.json()
    assert {m["competency"] for m in plan["modules"]} == {"System Design", "Leadership"}
    assert plan["total_min"] == sum(m["est_min"] for m in plan["modules"])


def _seed_bare_session() -> str:
    """Create a session row (no scorecard) so drill/evidence reads find it."""

    async def _run() -> str:
        return await build_deps().repo.create_session(
            PrepRequest(
                cv_url="https://example.com/cv.pdf",
                jd_text="Senior backend engineer.",
                company="Acme",
                language_mode=LanguageMode(primary="en", mixed=False),
            )
        )

    return asyncio.run(_run())


def test_coach_drill_endpoint_generates_then_caches() -> None:
    """First POST generates + stores drills (MockLLM); the second returns the
    SAME stored set (idempotent, no regeneration); unknown session 404s."""
    sid = _seed_bare_session()
    c = _client()
    assert c.post("/api/coach/drill", json={"session_id": sid, "competency": "Concurrency"}).status_code == 409
    ctx = build_mock(InterviewContext)
    ctx.session_id = sid
    ctx.plan.language_mode = LanguageMode(primary="en", mixed=False)
    score = ScoreCard.model_validate(_scorecard_body(["Concurrency"]))
    score.growth_items = [GrowthItem(competency="Concurrency", text="Concurrency")]
    asyncio.run(build_deps().repo.save_context(sid, ctx))
    asyncio.run(build_deps().repo.save_scorecard(sid, score))
    assert c.post("/api/coach/study/prepare", json={"session_id": sid}).status_code == 200
    r1 = c.post(
        "/api/coach/drill",
        json={"session_id": sid, "competency": "Concurrency", "language": "en"},
    )
    assert r1.status_code == 200
    items = r1.json()["items"]
    assert items and all(d["competency"] == "Concurrency" for d in items)
    assert items[0]["id"].startswith("drill_")
    first_id = items[0]["id"]

    r2 = c.post(
        "/api/coach/drill",
        json={"session_id": sid, "competency": "Concurrency", "language": "en"},
    )
    # Cache hit returns the identical stored drill (same id), not a fresh one.
    assert r2.json()["items"][0]["id"] == first_id

    assert (
        c.post("/api/coach/drill", json={"session_id": "sess_missing", "competency": "X"}).status_code
        == 404
    )


def _seed_session_with_practice(state: dict[str, str]) -> str:
    """Create a session row and persist per-competency mastery onto it."""

    async def _run() -> str:
        repo = build_deps().repo
        sid = await repo.create_session(
            PrepRequest(
                cv_url="https://example.com/cv.pdf",
                jd_text="Senior backend engineer.",
                company="Acme",
                language_mode=LanguageMode(primary="en", mixed=False),
            )
        )
        for comp, mastery in state.items():
            await repo.set_practice_state(sid, comp, mastery)
        return sid

    return asyncio.run(_run())


def test_coach_plan_merges_persisted_practice_state() -> None:
    """Passing session_id makes the endpoint override the matching module's
    status with the saved mastery; the rest keep their derived (weak -> shaky)."""
    sid = _seed_session_with_practice({"Leadership": "mastered"})
    resp = _client().post(
        "/api/coach/plan",
        json={
            "scorecard": _scorecard_body(["System Design", "Leadership"]),
            "session_id": sid,
        },
    )
    assert resp.status_code == 200
    by_comp = {m["competency"]: m["status"] for m in resp.json()["modules"]}
    assert by_comp["Leadership"] == "mastered"  # persisted override wins
    assert by_comp["System Design"] == "shaky"  # derived from the weak band


def test_coach_plan_without_session_has_no_override() -> None:
    """Omitting session_id leaves the plan purely scorecard-derived (legacy)."""
    resp = _client().post(
        "/api/coach/plan",
        json={"scorecard": _scorecard_body(["Leadership"])},
    )
    assert resp.status_code == 200
    assert resp.json()["modules"][0]["status"] == "shaky"


def test_coach_chat_endpoint() -> None:
    sid = _seed_bare_session()
    assert _client().post("/api/coach/chat", json={
        "session_id": "sess_missing", "query": "unknown session", "lang": "en",
    }).status_code == 404
    resp = _client().post(
        "/api/coach/chat",
        json={"session_id": sid, "query": "How do I structure a STAR answer?", "lang": "en"},
    )
    assert resp.status_code == 200
    reply = resp.json()
    assert isinstance(reply["answer"], str) and reply["answer"]
    # Ungrounded by default (no LIGHTRAG_URL) -> honest: no fabricated citations.
    assert reply["citations"] == []
    assert len(reply["follow_ups"]) <= 3


def _seed_coached_session(turns: list[dict]) -> str:
    """Create a real session row and attach a coaching transcript to it.

    Same repo instance the TestClient app serves from (build_deps is cached on
    the settings singleton), so the GET sees exactly what was saved.
    """

    async def _run() -> str:
        repo = build_deps().repo
        sid = await repo.create_session(
            PrepRequest(
                cv_url="https://example.com/cv.pdf",
                jd_text="Senior backend engineer, distributed systems.",
                company="Acme",
                language_mode=LanguageMode(primary="en", mixed=False),
            )
        )
        await repo.save_coach_transcript(sid, turns)
        return sid

    return asyncio.run(_run())


def test_coach_session_replay_roundtrip() -> None:
    sid = _seed_coached_session(
        [
            {"role": "assistant", "text": "What happens when the key is missing?"},
            {"role": "user", "text": "It falls through to the database."},
            {"role": "assistant", "text": "Say that back in your own words."},
        ]
    )
    resp = _client().get(f"/api/coach/session/{sid}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["session_id"] == sid
    assert len(body["turns"]) == 3
    assert body["turns"][-1]["role"] == "assistant"


def test_coach_session_replay_empty_when_never_coached() -> None:
    sid = _seed_coached_session([])
    body = _client().get(f"/api/coach/session/{sid}").json()
    assert body["turns"] == []


def test_coach_session_replay_unknown_session() -> None:
    assert _client().get("/api/coach/session/sess_missing").status_code == 404


def test_coach_progress_writes_practice_state() -> None:
    """The spoken coach's cross-process write-back: a valid mastery POST merges
    into the same per-session practice_state the plan endpoint reads."""
    sid = _seed_bare_session()
    resp = _client().post(
        "/api/coach/progress",
        json={"session_id": sid, "competency": "System Design", "mastery": "mastered"},
    )
    assert resp.status_code == 200
    assert resp.json() == {
        "session_id": sid,
        "competency": "System Design",
        "mastery": "mastered",
    }
    state = asyncio.run(build_deps().repo.get_practice_state(sid))
    assert state == {"System Design": "mastered"}


def test_coach_progress_unknown_session_404() -> None:
    resp = _client().post(
        "/api/coach/progress",
        json={"session_id": "sess_missing", "competency": "X", "mastery": "shaky"},
    )
    assert resp.status_code == 404


def test_coach_progress_rejects_illegal_mastery() -> None:
    # ``MasteryState`` is a Literal -> rejected with 422 before it can persist.
    sid = _seed_bare_session()
    resp = _client().post(
        "/api/coach/progress",
        json={"session_id": sid, "competency": "X", "mastery": "expert"},
    )
    assert resp.status_code == 422
    assert asyncio.run(build_deps().repo.get_practice_state(sid)) == {}


def test_coach_progress_closes_loop_into_plan() -> None:
    """End-to-end signal: a coached mastery recorded here shows up as the
    overriding status on the next plan build for the same session."""
    sid = _seed_bare_session()
    c = _client()
    c.post(
        "/api/coach/progress",
        json={"session_id": sid, "competency": "Leadership", "mastery": "mastered"},
    )
    resp = c.post(
        "/api/coach/plan",
        json={
            "scorecard": _scorecard_body(["System Design", "Leadership"]),
            "session_id": sid,
        },
    )
    by_comp = {m["competency"]: m["status"] for m in resp.json()["modules"]}
    assert by_comp["Leadership"] == "mastered"  # coached signal wins
    assert by_comp["System Design"] == "shaky"  # still scorecard-derived
