"""``/api/coach`` — Study Coach plan + grounded chat + session replay (WP-4).

``POST /api/coach/plan`` takes a ``ScoreCard`` (the client already holds it from
the report) and returns a ``StudyPlan``. ``POST /api/coach/chat`` answers a
learner question, grounded in the knowledge base. ``GET
/api/coach/session/{id}`` replays the persisted SPOKEN coaching transcript
(captured by ``worker_coach``) so the prep page can show what was practiced.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ..coach import run_coach_chat, run_coach_plan, run_generate_drills
from ..core.deps import build_deps
from ..shared_models import (
    CoachChatRequest,
    CoachReply,
    DrillItem,
    Language,
    MasteryState,
    ScoreCard,
    StudyPlan,
)
from .auth import require_internal_secret

router = APIRouter()


class CoachPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scorecard: ScoreCard
    # Output language of the LLM-drafted module text. Defaults keep legacy
    # (English) callers byte-identical; the web prep page passes the interview
    # language, or the UI locale when there is no real session yet.
    language: Language = "en"
    # When present, the endpoint merges this session's persisted practice
    # mastery into the plan (a practiced competency shows its saved state, not
    # the score-band default). Omitted -> pure scorecard plan (legacy).
    session_id: str | None = None


@router.post("/api/coach/plan", response_model=StudyPlan)
async def coach_plan(req: CoachPlanRequest) -> StudyPlan:
    deps = build_deps()
    practice_state = None
    if req.session_id:
        # Unknown session -> None -> no override; treated the same as "nothing
        # practiced yet". Best-effort read never blocks plan generation.
        practice_state = await deps.repo.get_practice_state(req.session_id)
    return await run_coach_plan(req.scorecard, deps, req.language, practice_state)


@router.post("/api/coach/chat", response_model=CoachReply)
async def coach_chat(req: CoachChatRequest) -> CoachReply:
    return await run_coach_chat(req, build_deps())


class CoachDrillRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str
    competency: str
    language: Language = "en"


class DrillList(BaseModel):
    """The drill set for ONE competency on ONE session (empty when generation
    failed or the LLM offered nothing). Deliberately NOT on ``SessionView`` —
    like the coach transcript, it is a narrow study surface, not scoring state."""

    model_config = ConfigDict(extra="forbid")
    session_id: str
    competency: str
    items: list[DrillItem] = Field(default_factory=list)


@router.post("/api/coach/drill", response_model=DrillList)
async def coach_drill(req: CoachDrillRequest) -> DrillList:
    """Generate (once) + return targeted drills for one growth competency.

    Idempotent per competency: if the session already carries drills for it, the
    stored set comes back untouched (no LLM call). These are coach-side study
    artifacts and NEVER write into the sealed interview plan.
    """
    deps = build_deps()
    existing = await deps.repo.get_drill_items(req.session_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Unknown session_id")

    cached = [d for d in existing if d.get("competency") == req.competency]
    if cached:
        return DrillList(
            session_id=req.session_id,
            competency=req.competency,
            items=[DrillItem.model_validate(d) for d in cached],
        )

    # Evidence: prefer this competency's scored evidence, else its growth-item
    # prose; an empty string is fine (the drill prompt has a fallback clause).
    evidence = ""
    view = await deps.repo.get_session_view(req.session_id)
    sc = view.scorecard if view is not None else None
    if sc is not None:
        for cs in sc.competency_scores:
            if cs.competency == req.competency:
                evidence = cs.evidence
                break
        else:
            for gi in sc.growth_items:
                if gi.competency == req.competency:
                    evidence = gi.text
                    break

    drills = await run_generate_drills(req.competency, evidence, req.language, deps)
    stored = await deps.repo.add_drill_items(
        req.session_id, [d.model_dump() for d in drills]
    )
    mine = [DrillItem.model_validate(d) for d in stored if d.get("competency") == req.competency]
    return DrillList(session_id=req.session_id, competency=req.competency, items=mine)


class CoachProgressRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str
    competency: str
    # ``MasteryState`` is a Literal — an illegal value is rejected with 422
    # before it can pollute the persisted practice state.
    mastery: MasteryState


class CoachProgressResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str
    competency: str
    mastery: MasteryState


@router.post(
    "/api/coach/progress",
    response_model=CoachProgressResponse,
    dependencies=[Depends(require_internal_secret)],
)
async def coach_progress(req: CoachProgressRequest) -> CoachProgressResponse:
    """Record the spoken coach's informal mastery self-assessment.

    Write-back path for ``worker_coach``: the voice worker runs in a SEPARATE
    process from this API, so (memory mode) it cannot touch the repo directly —
    it POSTs here instead. Merges into the same per-session ``practice_state``
    the plan endpoint reads, closing the loop: a coached competency comes back
    showing its saved mastery on the next plan build.
    """
    deps = build_deps()
    state = await deps.repo.get_practice_state(req.session_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Unknown session_id")
    await deps.repo.set_practice_state(req.session_id, req.competency, req.mastery)
    return CoachProgressResponse(
        session_id=req.session_id, competency=req.competency, mastery=req.mastery
    )


class CoachSessionTranscript(BaseModel):
    """Replay of the spoken coaching session for one interview session.

    ``turns`` is the raw ``worker_coach`` capture log — flat ``{role, text}``
    dicts (``role`` ∈ user/assistant), mirroring the free-form transcript
    shape elsewhere in persistence. Deliberately NOT added to ``SessionView``:
    the view is the scoring/status read model; this is a narrow, read-only
    surface for the prep page's "last coaching session" block.
    """

    model_config = ConfigDict(extra="forbid")

    session_id: str
    turns: list[dict[str, str]] = Field(default_factory=list)


@router.get("/api/coach/session/{session_id}", response_model=CoachSessionTranscript)
async def coach_session(session_id: str) -> CoachSessionTranscript:
    turns = await build_deps().repo.get_coach_transcript(session_id)
    if turns is None:
        raise HTTPException(status_code=404, detail="Unknown session_id")
    return CoachSessionTranscript(session_id=session_id, turns=turns)
