"""``POST /api/score`` — score a completed interview session."""

from __future__ import annotations

from fastapi import APIRouter

from ..core.deps import build_deps
from ..post import run_score
from ..shared_models import ScoreRequest, ScoreResponse

router = APIRouter()


@router.post("/api/score", response_model=ScoreResponse)
async def score(req: ScoreRequest, force: bool = False) -> ScoreResponse:
    # ``?force=true`` re-runs the paid pipeline even on an already-scored
    # session — the escape hatch for cards persisted in degraded form (report
    # stage timed out during provider congestion). Query param, NOT a body
    # field: ScoreRequest is a shared TS↔Pydantic wire contract and this knob
    # is internal tooling.
    scorecard = await run_score(req, build_deps(), force=force)
    return ScoreResponse(session_id=req.session_id, scorecard=scorecard)
