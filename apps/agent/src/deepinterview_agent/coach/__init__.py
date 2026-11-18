"""WP-4 Study Coach: scorecard -> study plan, and grounded tutoring chat.

Sequential async (no LangGraph), mirrors ``post/``. ``run_coach_plan`` turns a
``ScoreCard``'s structured ``growth_items`` into a ``StudyPlan`` (one module per
growth area, weakest-first — form Y, no score-band filter; falls back to the
score-banded ``weak_competencies`` when a card carries no ``growth_items``),
``run_coach_chat`` answers a learner question
grounded in ``deps.knowledge`` then synthesized by the LLM. Every LLM/retrieval
call is guarded with a timeout + fallback so the Prep Coach UI always gets a
valid response.

``run_coach_plan`` takes the ``ScoreCard`` directly (the client already holds it
from the report) rather than a ``session_id`` — the coach plan is a pure function
of the scorecard, so it needs no repo/storage lookup.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from hashlib import sha256
from typing import TYPE_CHECKING
from uuid import uuid4

from pydantic import BaseModel, ConfigDict

from ..core.logging import get_logger
from ..shared_models import CoachReply, DrillItem, StudyModule, StudyPlan
from .prompts import coach_chat_prompts, drill_prompts, study_module_prompts

if TYPE_CHECKING:
    from ..core.deps import Deps
    from ..shared_models import CoachChatRequest, MasteryState, ScoreCard

log = get_logger(__name__)

__all__ = ["run_coach_chat", "run_coach_plan", "run_generate_drills"]

_DEFAULT_EST_MIN = 25
_STAGE_TIMEOUT = 60.0


class _ModuleDraft(BaseModel):
    """LLM-authored fields for one study module; the rest is pinned deterministically."""

    model_config = ConfigDict(extra="forbid")
    title: str
    rationale: str
    est_min: int


class _ChatDraft(BaseModel):
    """LLM-authored fields for a coach reply; citations come from retrieval."""

    model_config = ConfigDict(extra="forbid")
    answer: str
    follow_ups: list[str]


class _DrillQuestion(BaseModel):
    """One LLM-authored drill: the question (target + English) and its answer."""

    model_config = ConfigDict(extra="forbid")
    question_en: str
    question: str
    answer: str


class _DrillDraft(BaseModel):
    """LLM output for a drill batch — a list of self-contained Q&A items."""

    model_config = ConfigDict(extra="forbid")
    questions: list[_DrillQuestion]


def _status_for_level(level: str) -> MasteryState:
    """Map a scoring band onto a study-module mastery state."""
    return "learning" if level == "developing" else "shaky"


def study_module_id(competency: str) -> str:
    return "goal_" + sha256(competency.strip().encode()).hexdigest()[:16]


def _clamp_min(value: int) -> int:
    """Keep a module's estimated minutes in a sane 5-90 range."""
    return max(5, min(90, int(value)))


async def _guarded(coro, *, label: str, timeout: float = _STAGE_TIMEOUT):
    """Await ``coro`` with a timeout; on ANY error return ``None`` (caller falls back)."""
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except Exception:
        log.exception("coach: stage %r failed; degrading", label)
        return None


def _empty_plan(summary: str) -> StudyPlan:
    return StudyPlan(modules=[], summary=summary, total_min=0)


async def run_coach_plan(
    scorecard: ScoreCard,
    deps: Deps,
    language: str = "en",
    practice_state: Mapping[str, MasteryState] | None = None,
) -> StudyPlan:
    """Build a ``StudyPlan`` from a scorecard's structured growth items.

    One module per ``growth_items`` entry (form Y: every reported growth area
    becomes a module, no score-band filter), ordered weakest-first; the LLM
    drafts the title/rationale/est_min while ``competency`` and ``status`` are
    pinned deterministically so the plan maps cleanly back onto the loop's
    shared competency space. Falls back to the score-banded ``weak_competencies``
    when a scorecard carries no ``growth_items`` (older cards, or an LLM that
    omitted the field). ``language`` (default "en") sets the output language of
    the LLM-drafted free text. ``practice_state`` (a competency -> mastery map
    persisted on the session) OVERRIDES the derived ``status`` for any competency
    it names, so previously-practiced areas resurface at their saved mastery
    rather than the score-band default.
    """
    # Plan from the STRUCTURED growth items so the report page and the coach
    # page share a single source. Old scorecards (or an LLM that omitted the
    # field) fall back to the score-banded weak_competencies.
    grouped: dict[str, list[str]] = {}
    for gi in scorecard.growth_items:
        grouped.setdefault(gi.competency, []).extend([gi.text, *gi.actions])
    items = [(comp, "\n".join(dict.fromkeys(texts))) for comp, texts in grouped.items()]
    if not items:
        items = [(c, "") for c in dict.fromkeys(scorecard.weak_competencies)]
    if not items:
        return _empty_plan(
            "No weak areas from your last interview — nice work. Run another mock to stay sharp."
        )

    score_by_comp = {cs.competency: cs for cs in scorecard.competency_scores}
    # Weakest (lowest score) first; overflow competencies absent from the scores
    # (a JD gap the interview never asked about) sort last.
    items.sort(key=lambda it: score_by_comp[it[0]].score if it[0] in score_by_comp else 99.0)

    modules: list[StudyModule] = []
    for comp, growth_text in items:
        cs = score_by_comp.get(comp)
        evidence = "\n".join(filter(None, [growth_text, cs.evidence if cs else ""]))
        level = cs.level if cs is not None else "weak"
        derived_status: MasteryState = (
            _status_for_level(level) if cs is not None else "learning"
        )
        # A persisted mastery state wins over the score-band default so the plan
        # reflects practice already done on THIS session.
        status: MasteryState = (
            practice_state.get(comp, derived_status) if practice_state else derived_status
        )
        system, user = study_module_prompts(comp, evidence, level, language)
        draft = await _guarded(
            deps.llm.complete_json(system=system, user=user, schema=_ModuleDraft),
            label=f"module:{comp}",
        )
        if draft is None:
            draft = _ModuleDraft(
                title=f"Strengthen {comp}",
                rationale="A focus area flagged by your last interview.",
                est_min=_DEFAULT_EST_MIN,
            )
        modules.append(
            StudyModule(
                id=study_module_id(comp),
                title=draft.title,
                competency=comp,
                status=status,
                est_min=_clamp_min(draft.est_min),
                rationale=draft.rationale,
            )
        )

    total = sum(m.est_min for m in modules)
    plural = "s" if len(modules) != 1 else ""
    summary = f"{len(modules)} focus area{plural} from your last interview, about {total} min."
    return StudyPlan(modules=modules, summary=summary, total_min=total)


async def run_generate_drills(
    competency: str,
    evidence: str,
    language: str,
    deps: Deps,
    count: int = 3,
) -> list[DrillItem]:
    """Author targeted drill questions for one growth competency.

    Used for a competency the interview never scored (an overflow growth item
    with no rubric question and no model answer), so the flashcard deck has
    something to study. Each item is self-contained (question + reference
    answer). On ANY LLM failure returns ``[]`` — an honest empty deck beats
    fabricated filler, and the caller treats empty as "nothing to add".
    """
    system, user = drill_prompts(competency, evidence, language, count)
    draft = await _guarded(
        deps.llm.complete_json(system=system, user=user, schema=_DrillDraft),
        label=f"drill:{competency}",
    )
    if draft is None:
        return []
    items: list[DrillItem] = []
    for q in draft.questions[: max(1, count)]:
        en = (q.question_en or q.question).strip()
        primary = (q.question or q.question_en).strip()
        answer = q.answer.strip()
        if not en or not answer:
            continue
        text: dict[str, str] = {"en": en}
        if language != "en":
            text[language] = primary
        items.append(
            DrillItem(
                id=f"drill_{uuid4().hex[:10]}",
                competency=competency,
                text=text,
                answer=answer,
            )
        )
    return items


async def run_coach_chat(req: CoachChatRequest, deps: Deps) -> CoachReply:
    """Answer a learner question; ground + cite ONLY when a real KB is configured.

    Grounding (and therefore citations) is opt-in via ``LIGHTRAG_URL``. With no
    real retrieval backend (the default), we answer with the LLM and return NO
    citations rather than fabricating sources over an ungrounded answer.
    """
    if deps.settings.lightrag_url:
        grounded = await _guarded(
            deps.knowledge.search(req.session_id, req.query, req.lang),
            label="knowledge",
        )
        context, citations = grounded if grounded is not None else ("", [])
    else:
        context, citations = "", []

    system, user = coach_chat_prompts(req.query, context, req.lang)
    draft = await _guarded(
        deps.llm.complete_json(system=system, user=user, schema=_ChatDraft),
        label="chat",
    )
    if draft is None:
        return CoachReply(
            answer="I couldn't put together a coached answer just now — try asking again in a moment.",
            citations=citations,
            follow_ups=[],
        )
    return CoachReply(answer=draft.answer, citations=citations, follow_ups=draft.follow_ups[:3])
