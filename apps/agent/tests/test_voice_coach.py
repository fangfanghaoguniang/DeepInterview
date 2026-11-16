"""Offline tests for the livekit-free spoken Study Coach helpers.

These exercise ONLY the livekit-free logic: the Socratic instructions builder
(``coach.prompts.coach_agent_instructions``) and the weak-areas summary helper
(``live.state.weak_areas_summary``). They deliberately do NOT import
``live.coach_agent`` or ``worker_coach`` (both require the livekit extra). The
CoachAgent persona + worker entrypoint are integration-tested manually.
"""

from __future__ import annotations

from deepinterview_agent.coach.prompts import (
    closing_instructions,
    coach_agent_instructions,
    coach_chat_prompts,
)
from deepinterview_agent.live.guard import wrap_up_line
from deepinterview_agent.live.state import coach_briefing, weak_areas_summary
from deepinterview_agent.shared_models import (
    CompetencyScore,
    GrowthItem,
    LanguageReport,
    ModelAnswer,
    PlannedQuestion,
    ScoreCard,
)


def _scorecard(weak: list[str]) -> ScoreCard:
    comp = [
        CompetencyScore(
            competency=c, score=1.5, evidence=f"Struggled with {c}.", level="weak"
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


def test_instructions_are_socratic_and_localized() -> None:
    text = coach_agent_instructions("Weak areas: System Design.", "vi")
    assert isinstance(text, str) and text
    # Mentions the injected weak-areas context verbatim and the language.
    assert "System Design" in text
    # Language rides as the provider-facing NAME, not the bare code — the one
    # spelling shared by every pipeline's output-language rule.
    assert "Vietnamese" in text
    assert "Primary language: vi" not in text
    # Socratic intent: never just lecture / hand over the answer.
    assert "question" in text.lower()


def test_weak_areas_summary_lists_weak_competencies() -> None:
    summary = weak_areas_summary(_scorecard(["System Design", "Leadership"]))
    assert "System Design" in summary
    assert "Leadership" in summary


def test_weak_areas_summary_handles_no_scorecard() -> None:
    # A session that hasn't been scored yet must still yield a usable, non-empty line.
    summary = weak_areas_summary(None)
    assert isinstance(summary, str) and summary


def test_weak_areas_summary_handles_no_weak() -> None:
    summary = weak_areas_summary(_scorecard([]))
    assert isinstance(summary, str) and summary


def test_weak_areas_summary_prefers_growth_items() -> None:
    # growth_items is the report's single truth source: once present it drives
    # the coach's focus, even surfacing a dimension the legacy weak band missed.
    card = _scorecard(["System Design", "Leadership"])
    card.growth_items = [
        GrowthItem(text="Go deeper on cache invalidation.", competency="System Design"),
        GrowthItem(text="Own the tradeoff story.", competency="Concurrency"),
    ]
    summary = weak_areas_summary(card)
    assert "Concurrency" in summary
    assert "System Design" in summary
    # Deduped and ordered by growth_items, not appended to the weak band.
    assert summary.index("System Design") < summary.index("Concurrency")


def test_coach_briefing_uses_growth_item_order_for_weakest() -> None:
    # The private answer reference must follow the SAME focus list, so the
    # briefing's "weakest" is the first growth item, not the first weak band.
    card = _scorecard(["Leadership"])
    card.growth_items = [
        GrowthItem(text="", competency="System Design"),
        GrowthItem(text="", competency="Leadership"),
    ]
    card.model_answers = [
        ModelAnswer(question_id="q1", answer="Token bucket at the edge."),
        ModelAnswer(question_id="q3", answer="STAR, own your part."),
    ]
    text = coach_briefing(_weak_questions(), card, "en")
    assert "Design a rate limiter." in text  # System Design is now weakest
    assert "Token bucket at the edge" in text
    assert "Tell me about" not in text  # Leadership reference excluded


def _weak_questions() -> list[PlannedQuestion]:
    """Two System Design questions + one unrelated Leadership question."""
    return [
        PlannedQuestion(
            id="q1",
            section="technical",
            text={"en": "Design a rate limiter.", "zh": "设计一个限流器。"},
            difficulty=3,
            rubric=[],
            followups=[],
            target_competency="System Design",
        ),
        PlannedQuestion(
            id="q2",
            section="technical",
            text={"en": "How would you shard the store?"},
            difficulty=2,
            rubric=[],
            followups=[],
            target_competency="System Design",
        ),
        PlannedQuestion(
            id="q3",
            section="behavioral",
            text={"en": "Tell me about a conflict."},
            difficulty=1,
            rubric=[],
            followups=[],
            target_competency="Leadership",
        ),
    ]


def test_coach_briefing_injects_private_answer_key() -> None:
    card = _scorecard(["System Design", "Leadership"])
    card.model_answers = [
        ModelAnswer(question_id="q1", answer="Token bucket at the edge, fail closed."),
        ModelAnswer(question_id="q2", answer="Shard by user id, hot shards split."),
        ModelAnswer(question_id="q3", answer="STAR, own your part."),
    ]
    text = coach_briefing(_weak_questions(), card, "en")
    # Weakness line still present (briefing builds on the summary).
    assert "System Design" in text
    # Only the WEAKEST competency's answered questions make the reference…
    assert "Design a rate limiter." in text
    assert "Token bucket at the edge" in text
    # …and it is capped at two, excluding the Leadership question entirely.
    assert "conflict" not in text
    assert "Tell me about" not in text
    # Marked private so the persona never recites it.
    assert "never read aloud" in text


def test_coach_briefing_follows_interview_language() -> None:
    card = _scorecard(["System Design"])
    card.model_answers = [
        ModelAnswer(question_id="q1", answer="令牌桶。"),
        ModelAnswer(question_id="q2", answer="按用户 id 分片。"),
    ]
    text = coach_briefing(_weak_questions(), card, "zh")
    # Question text resolves to the interview language when present.
    assert "设计一个限流器。" in text
    # English-only questions fall back to en rather than vanishing.
    assert "How would you shard the store?" in text


def test_coach_briefing_degrades_to_summary_without_answers() -> None:
    # No scorecard → the encouraging fallback, verbatim from the summary.
    assert coach_briefing(_weak_questions(), None, "en") == weak_areas_summary(None)
    # Scored but no model answers for the weak area → summary only, no header.
    card = _scorecard(["System Design"])
    assert coach_briefing(_weak_questions(), card, "en") == weak_areas_summary(card)


def test_instructions_require_the_wrap_up_exit() -> None:
    text = coach_agent_instructions("Weak areas: System Design.", "zh")
    # The persona must know its exit tool and the closing synthesis shape.
    assert "wrap_up" in text
    assert "closing synthesis" in text
    assert "in their own words" in text


def test_closing_instructions_pin_turn_cap_and_language() -> None:
    text = closing_instructions("zh")
    assert "turn limit" in text
    assert "Do NOT ask another question" in text
    # Language codes map to the provider-facing names (Chinese, not "zh").
    assert "Chinese" in text


def test_coach_chat_pins_language_name_not_code() -> None:
    # The written chat coach shares the one spelling every pipeline uses.
    system, _ = coach_chat_prompts("How do I STAR?", "", "zh")
    assert "Chinese" in system
    assert "(zh)" not in system


def test_guard_wrap_up_line_covers_zh() -> None:
    # A Chinese interview must not be closed with an English line (the guard
    # speaks this over TTS).
    assert wrap_up_line("zh") != wrap_up_line("en")
    assert "反馈" in wrap_up_line("zh")
