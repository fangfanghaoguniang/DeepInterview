"""``/api/coach`` — Study Coach plan + grounded chat (WP-4).

``POST /api/coach/plan`` takes a ``ScoreCard`` (the client already holds it from
the report) and returns a ``StudyPlan``. ``POST /api/coach/chat`` answers a
learner question, grounded in the knowledge base.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from ..coach import run_coach_chat, run_coach_plan
from ..core.deps import build_deps
from ..shared_models import (
    CoachChatRequest,
    CoachReply,
    Language,
    ScoreCard,
    StudyPlan,
)

router = APIRouter()


class CoachPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scorecard: ScoreCard
    # Output language of the LLM-drafted module text. Defaults keep legacy
    # (English) callers byte-identical; the web prep page passes the interview
    # language, or the UI locale when there is no real session yet.
    language: Language = "en"


@router.post("/api/coach/plan", response_model=StudyPlan)
async def coach_plan(req: CoachPlanRequest) -> StudyPlan:
    return await run_coach_plan(req.scorecard, build_deps(), req.language)


@router.post("/api/coach/chat", response_model=CoachReply)
async def coach_chat(req: CoachChatRequest) -> CoachReply:
    return await run_coach_chat(req, build_deps())
