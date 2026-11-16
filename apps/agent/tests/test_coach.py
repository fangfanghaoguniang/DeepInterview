"""Offline tests for the WP-4 Study Coach (MockLLM / MockKnowledge).

run_coach_plan is a pure function of a ScoreCard; run_coach_chat grounds via the
default MockKnowledge client. No keys, no network.
"""

from __future__ import annotations

import asyncio

from deepinterview_agent.coach import run_coach_chat, run_coach_plan, run_generate_drills
from deepinterview_agent.core.deps import build_deps
from deepinterview_agent.shared_models import (
    Citation,
    CoachChatRequest,
    CompetencyScore,
    GrowthItem,
    LanguageReport,
    ScoreCard,
    StudyPlan,
)


def _scorecard(weak: list[str]) -> ScoreCard:
    comp = [
        CompetencyScore(
            competency=c, score=1.5, evidence=f"Struggled with {c} under follow-up.", level="weak"
        )
        for c in weak
    ]
    return ScoreCard(
        overall_score=1.5,
        competency_scores=comp,
        strengths=[],
        weaknesses=list(weak),
        weak_competencies=list(weak),
        model_answers=[],
        next_steps=[],
        language_report=LanguageReport(
            fluency_score=3.0,
            filler_word_count=2,
            clarity_score=3.0,
            code_switching_notes="",
            pronunciation_notes="",
            summary="ok",
        ),
        summary="test scorecard",
    )


def test_coach_plan_covers_weak_competencies() -> None:
    deps = build_deps()
    sc = _scorecard(["System Design", "Leadership"])

    plan = asyncio.run(run_coach_plan(sc, deps))

    # One module per weak competency, mapping back onto the loop's competency space.
    assert {m.competency for m in plan.modules} == {"System Design", "Leadership"}
    assert plan.total_min == sum(m.est_min for m in plan.modules)
    for m in plan.modules:
        assert m.est_min >= 5
        assert m.status in {"unseen", "learning", "shaky", "mastered"}
    # Round-trips through validation.
    assert StudyPlan.model_validate(plan.model_dump()) == plan


def test_coach_plan_empty_when_no_weak() -> None:
    deps = build_deps()
    plan = asyncio.run(run_coach_plan(_scorecard([]), deps))
    assert plan.modules == []
    assert plan.total_min == 0
    assert plan.summary  # a non-empty, encouraging message


def _growth_scorecard(
    growth: list[tuple[str, str]], scores: list[CompetencyScore]
) -> ScoreCard:
    """ScoreCard carrying structured ``growth_items`` (the single source the
    report page shows) plus the underlying ``competency_scores``."""
    return ScoreCard(
        overall_score=2.5,
        competency_scores=scores,
        strengths=[],
        weaknesses=[g[1] for g in growth],
        weak_competencies=[s.competency for s in scores if s.level in {"weak", "developing"}],
        growth_items=[GrowthItem(competency=c, text=txt) for c, txt in growth],
        model_answers=[],
        next_steps=[],
        language_report=LanguageReport(
            fluency_score=3.0,
            filler_word_count=2,
            clarity_score=3.0,
            code_switching_notes="",
            pronunciation_notes="",
            summary="ok",
        ),
        summary="test scorecard",
    )


def test_coach_plan_builds_from_growth_items_no_score_band() -> None:
    """Form Y: EVERY growth item becomes a module — a "solid" 3.3 competency is
    not filtered out the way score-banded ``weak_competencies`` would drop it.
    Modules order weakest-first by the competency's score."""
    deps = build_deps()
    scores = [
        CompetencyScore(competency="System Design", score=3.3, evidence="thin", level="solid"),
        CompetencyScore(competency="Leadership", score=2.4, evidence="narrow", level="developing"),
        CompetencyScore(competency="Behavioral", score=1.8, evidence="skips STAR", level="weak"),
    ]
    # Report lists all three, in an arbitrary source order.
    growth = [
        ("System Design", "glossed capacity"),
        ("Behavioral", "skipped situation"),
        ("Leadership", "team-only scope"),
    ]
    sc = _growth_scorecard(growth, scores)
    # Sanity: the score-band list the OLD code used would have kept only two.
    assert sc.weak_competencies == ["Leadership", "Behavioral"]

    plan = asyncio.run(run_coach_plan(sc, deps))

    # All three modules survive the (now-removed) band filter, weakest-first.
    assert [m.competency for m in plan.modules] == ["Behavioral", "Leadership", "System Design"]
    assert plan.total_min == sum(m.est_min for m in plan.modules)


def test_coach_plan_growth_item_overflow_sorts_last() -> None:
    """A growth item naming a competency the interview never scored (a JD gap)
    still becomes a module and sorts after every scored competency."""
    deps = build_deps()
    scores = [
        CompetencyScore(competency="Behavioral", score=1.8, evidence="skips STAR", level="weak"),
    ]
    growth = [("Concurrency", "never probed"), ("Behavioral", "skipped situation")]
    sc = _growth_scorecard(growth, scores)

    plan = asyncio.run(run_coach_plan(sc, deps))

    assert [m.competency for m in plan.modules] == ["Behavioral", "Concurrency"]
    # The unscored overflow competency defaults to the "learning" mastery state.
    concurrency = next(m for m in plan.modules if m.competency == "Concurrency")
    assert concurrency.status == "learning"


def test_coach_plan_practice_state_overrides_status() -> None:
    """A persisted mastery state wins over the score-band default for the
    competency it names; every other module keeps its derived status."""
    deps = build_deps()
    scores = [
        CompetencyScore(competency="Behavioral", score=1.8, evidence="x", level="weak"),
        CompetencyScore(competency="Leadership", score=2.4, evidence="y", level="developing"),
    ]
    growth = [("Behavioral", "skips STAR"), ("Leadership", "team-only scope")]
    sc = _growth_scorecard(growth, scores)

    # Behavioral was drilled to mastery on this session; Leadership untouched.
    plan = asyncio.run(run_coach_plan(sc, deps, practice_state={"Behavioral": "mastered"}))
    by_comp = {m.competency: m.status for m in plan.modules}
    assert by_comp["Behavioral"] == "mastered"  # persisted override wins
    assert by_comp["Leadership"] == "learning"  # developing -> derived "learning"


def test_generate_drills_returns_self_contained_items() -> None:
    """The drill generator yields items with an English-guaranteed text blob and
    a reference answer (so the frontend can render a card without a model
    answer); a non-English target also carries the primary-language key."""
    deps = build_deps()
    drills = asyncio.run(run_generate_drills("Concurrency", "never probed", "en", deps))
    assert drills, "MockLLM yields at least one drill question"
    d = drills[0]
    assert d.competency == "Concurrency"
    assert d.text.get("en")  # LocalizedText always carries a non-empty "en"
    assert d.answer
    assert d.id.startswith("drill_")

    # Chinese target: both the English gloss and the primary key are present.
    drills_zh = asyncio.run(run_generate_drills("Concurrency", "", "zh", deps))
    assert drills_zh[0].text.get("zh")
    assert drills_zh[0].text.get("en")


def test_study_module_prompts_output_language_rule() -> None:
    """Module text follows the requested language; default stays English."""
    from deepinterview_agent.coach.prompts import study_module_prompts

    system, _ = study_module_prompts("Kafka", "evidence", "weak")
    assert "Write the title and rationale in English" in system
    system_zh, _ = study_module_prompts("Kafka", "evidence", "weak", "zh")
    assert "Write the title and rationale in Chinese" in system_zh
    # The join key the frontend module filter relies on stays untouched.
    assert "competency name exactly as specified" in system_zh


def test_coach_chat_returns_grounded_reply() -> None:
    deps = build_deps()
    req = CoachChatRequest(
        session_id="sess_x", query="How do I structure a STAR answer?", lang="en"
    )

    reply = asyncio.run(run_coach_chat(req, deps))

    assert isinstance(reply.answer, str) and reply.answer
    # No real KB configured (default) -> ungrounded + honest: NO fabricated sources.
    assert reply.citations == []
    assert len(reply.follow_ups) <= 3


def test_coach_chat_grounds_when_backend_configured() -> None:
    """With a real KB configured (LIGHTRAG_URL) the coach grounds + returns citations."""
    deps = build_deps()
    original = deps.settings.lightrag_url

    class _FakeKnowledge:
        async def search(self, user_id: str, query: str, lang: str):
            return ("Grounded context.", [Citation(title="Prep notes", url="kb://x", snippet="s")])

    deps.settings.lightrag_url = "http://localhost:9621"
    original_knowledge = deps.knowledge
    deps.knowledge = _FakeKnowledge()
    try:
        req = CoachChatRequest(session_id="sess_x", query="What is exactly-once?", lang="en")
        reply = asyncio.run(run_coach_chat(req, deps))
        assert len(reply.citations) >= 1
    finally:
        # Restore BOTH mutated fields on the shared cached deps — leaving the
        # _FakeKnowledge in place pollutes later tests (e.g. /api/kb/ingest now
        # calls deps.knowledge.ingest, which this double doesn't implement).
        deps.settings.lightrag_url = original
        deps.knowledge = original_knowledge
