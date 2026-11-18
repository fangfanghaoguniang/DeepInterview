"""``/api/coach`` — Study Coach plan + grounded chat + session replay (WP-4).

``POST /api/coach/plan`` takes a ``ScoreCard`` (the client already holds it from
the report) and returns a ``StudyPlan``. ``POST /api/coach/chat`` answers a
learner question, grounded in the knowledge base. ``GET
/api/coach/session/{id}`` replays the persisted SPOKEN coaching transcript
(captured by ``worker_coach``) so the prep page can show what was practiced.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ..coach import run_coach_chat, run_coach_plan
from ..coach.runs import end_run, run_context, start_run
from ..coach.study import claim_prepare, prepare_materials, read_study
from ..core.deps import build_deps
from ..shared_models import (
    CoachChatRequest,
    CoachFeedback,
    CoachReply,
    CoachRun,
    DrillItem,
    Language,
    MasteryState,
    ScoreCard,
    StudyPlan,
    StudyView,
)
from .auth import require_internal_secret

router = APIRouter()


async def owned_learning_data(session_id: str, deps, user_id: str | None) -> dict:
    data = await deps.repo.get_learning_data(session_id)
    if data is None:
        raise HTTPException(404, "会话不存在")
    if data.get("user_id") and data["user_id"] != user_id:
        raise HTTPException(403, "无权访问此面试")
    return data


class StudyPrepareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str
    retry: bool = False
    module_id: str | None = None


@router.get("/api/coach/study/{session_id}", response_model=StudyView,
            dependencies=[Depends(require_internal_secret)])
async def study_read(session_id: str, x_user_id: str | None = Header(default=None)) -> StudyView:
    deps = build_deps()
    await owned_learning_data(session_id, deps, x_user_id)
    try:
        return await read_study(session_id, deps)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/api/coach/study/prepare", response_model=StudyView,
             dependencies=[Depends(require_internal_secret)])
async def study_prepare(req: StudyPrepareRequest, tasks: BackgroundTasks,
                        x_user_id: str | None = Header(default=None)) -> StudyView:
    deps = build_deps()
    await owned_learning_data(req.session_id, deps, x_user_id)
    try:
        claimed = await claim_prepare(req.session_id, deps, req.module_id, req.retry)
        if claimed:
            tasks.add_task(prepare_materials, req.session_id, *claimed, deps)
        return await read_study(req.session_id, deps)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


class CoachRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str
    version: str
    run_id: str = Field(pattern=r"^[a-zA-Z0-9-]{16,64}$")
    entry_module: str | None = None


class CoachRunResult(CoachRunRequest):
    feedback: list[CoachFeedback] = Field(default_factory=list, max_length=100)
    turns: list[dict[str, str]] = Field(default_factory=list, max_length=200)


@router.post("/api/coach/run/start", response_model=CoachRun,
             dependencies=[Depends(require_internal_secret)])
async def coach_start(req: CoachRunRequest, x_user_id: str | None = Header(default=None)):
    deps = build_deps()
    await owned_learning_data(req.session_id, deps, x_user_id)
    try:
        return await start_run(req.session_id, req.version, req.run_id, req.entry_module, deps)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/api/coach/run/end", response_model=CoachRun,
             dependencies=[Depends(require_internal_secret)])
async def coach_end(req: CoachRunRequest, x_user_id: str | None = Header(default=None)):
    deps = build_deps()
    await owned_learning_data(req.session_id, deps, x_user_id)
    try:
        return await end_run(req.session_id, req.version, req.run_id, deps)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/api/coach/run/result", response_model=CoachRun,
             dependencies=[Depends(require_internal_secret)])
async def coach_result(req: CoachRunResult):
    try:
        return await end_run(req.session_id, req.version, req.run_id, build_deps(),
                             feedback=req.feedback, turns=req.turns)
    except LookupError as exc:
        raise HTTPException(404, "会话不存在") from exc
    except (ValueError, TypeError) as exc:
        raise HTTPException(409, "本轮反馈已过期或内容不合法") from exc


@router.post("/api/coach/run/context", response_model=StudyView,
             dependencies=[Depends(require_internal_secret)])
async def coach_context(req: CoachRunRequest):
    try:
        return await run_context(req.session_id, req.version, req.run_id, build_deps())
    except LookupError as exc:
        raise HTTPException(404, "会话不存在") from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


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


@router.post("/api/coach/plan", response_model=StudyPlan,
             dependencies=[Depends(require_internal_secret)])
async def coach_plan(req: CoachPlanRequest, x_user_id: str | None = Header(default=None)) -> StudyPlan:
    deps = build_deps()
    practice_state = None
    if req.session_id:
        await owned_learning_data(req.session_id, deps, x_user_id)
        # Unknown session -> None -> no override; treated the same as "nothing
        # practiced yet". Best-effort read never blocks plan generation.
        practice_state = await deps.repo.get_practice_state(req.session_id)
    return await run_coach_plan(req.scorecard, deps, req.language, practice_state)


@router.post("/api/coach/chat", response_model=CoachReply,
             dependencies=[Depends(require_internal_secret)])
async def coach_chat(req: CoachChatRequest, x_user_id: str | None = Header(default=None)) -> CoachReply:
    deps = build_deps()
    await owned_learning_data(req.session_id, deps, x_user_id)
    return await run_coach_chat(req, deps)


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


@router.post("/api/coach/drill", response_model=DrillList,
             dependencies=[Depends(require_internal_secret)])
async def coach_drill(req: CoachDrillRequest,
                      x_user_id: str | None = Header(default=None)) -> DrillList:
    """Generate (once) + return targeted drills for one growth competency.

    Idempotent per competency: if the session already carries drills for it, the
    stored set comes back untouched (no LLM call). These are coach-side study
    artifacts and NEVER write into the sealed interview plan.
    """
    deps = build_deps()
    await owned_learning_data(req.session_id, deps, x_user_id)
    try:
        study = await read_study(req.session_id, deps)
        if study.language != req.language:
            raise HTTPException(409, "练习语言必须与当前材料版本一致")
        target = next((t for t in study.targets if t.module.competency == req.competency), None)
        if target is None:
            raise HTTPException(409, "请先准备本场面试的学习目标")
        claimed = await claim_prepare(req.session_id, deps, target.module.id,
                                      target.material_status == "failed")
        if claimed:
            await prepare_materials(req.session_id, *claimed, deps)
        data = await deps.repo.get_learning_data(req.session_id)
        mine = [DrillItem.model_validate(d) for d in data["drill_items"]
                if d.get("competency") == req.competency
                and d.get("source_version") == study.version]
        return DrillList(session_id=req.session_id, competency=req.competency, items=mine)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


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
    for _ in range(16):
        data = await deps.repo.get_learning_data(req.session_id)
        if not data:
            raise HTTPException(404, "会话不存在")
        if data["study_state"].get("version"):
            raise HTTPException(409, "当前学习任务必须提交带版本与轮次的分目标反馈")
        if await deps.repo.compare_and_set_study(req.session_id, data["study_revision"],
                                                 data["study_state"],
                                                 practice={req.competency: req.mastery}):
            break
    else:
        raise HTTPException(409, "练习反馈写入繁忙，请重试")
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


@router.get("/api/coach/session/{session_id}", response_model=CoachSessionTranscript,
            dependencies=[Depends(require_internal_secret)])
async def coach_session(session_id: str, x_user_id: str | None = Header(default=None)) -> CoachSessionTranscript:
    deps = build_deps()
    await owned_learning_data(session_id, deps, x_user_id)
    turns = await deps.repo.get_coach_transcript(session_id)
    if turns is None:
        raise HTTPException(status_code=404, detail="Unknown session_id")
    return CoachSessionTranscript(session_id=session_id, turns=turns)
