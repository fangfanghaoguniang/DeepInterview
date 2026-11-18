"""教练运行与按目标反馈；所有写入都绑定会话、材料版本和本轮编号。"""
from __future__ import annotations

import time

from ..shared_models import CoachFeedback, CoachRun
from .study import read_study


async def start_run(session_id, version, run_id, entry_module, deps):
    study = await read_study(session_id, deps)
    if study.version != version or not any(t.cards for t in study.targets):
        raise ValueError("练习材料版本已变化或尚未就绪，请返回备考页")
    if entry_module and not any(t.module.id == entry_module and t.cards for t in study.targets):
        raise ValueError("起始目标不属于本场面试或材料尚未就绪")
    for _ in range(16):
        data = await deps.repo.get_learning_data(session_id)
        if not data:
            raise ValueError("面试会话不存在")
        state = data["study_state"]
        if state.get("version") != version:
            raise ValueError("材料版本已变化")
        existing = state["view"].get("coach_run")
        if existing and existing["id"] == run_id:
            if existing["entry_module"] != entry_module or existing["status"] != "running":
                raise ValueError("本轮练习已经结束，请重新进入")
            return CoachRun.model_validate(existing)
        run = CoachRun(id=run_id, version=version, entry_module=entry_module,
                       started_at=time.time(), status="running")
        state["view"]["coach_run"] = run.model_dump()
        state["coach_ended_at"] = None
        state["coach_transcript"] = []
        if await deps.repo.compare_and_set_study(session_id, data["study_revision"], state):
            return run
    raise ValueError("练习状态繁忙，请重试")


async def run_context(session_id, version, run_id, deps):
    study = await read_study(session_id, deps)
    run = study.coach_run
    if (study.version != version or not run or run.id != run_id
            or run.status != "running"):
        raise ValueError("本轮练习已过期或结束")
    if run.entry_module:
        study.targets.sort(key=lambda t: t.module.id != run.entry_module)
    return study


async def end_run(session_id, version, run_id, deps, *, feedback=None, turns=None):
    study = await read_study(session_id, deps)
    if study.version != version:
        raise ValueError("原报告已变化，本轮反馈不再写入当前学习版本")
    for _ in range(16):
        data = await deps.repo.get_learning_data(session_id)
        if not data:
            raise ValueError("面试会话不存在")
        state = data["study_state"]
        run = state.get("view", {}).get("coach_run")
        if state.get("version") != version or not run or run["id"] != run_id:
            raise ValueError("本轮练习已过期，旧反馈未写入新一轮")
        if run["status"] == "ready":
            return CoachRun.model_validate(run)
        practice = {}
        if feedback is None:
            run["status"] = "pending"
            state["coach_ended_at"] = state.get("coach_ended_at") or time.time()
        else:
            allowed = {t["module"]["id"]: t["module"]["competency"]
                       for t in state["view"]["targets"] if t["material_status"] == "ready"}
            answered = {t.get("module_id") for t in turns or []
                        if t.get("role") == "user" and t.get("text", "").strip()}
            supplied = {f.module_id: f for f in feedback}
            if len(supplied) != len(feedback) or any(f.mastery == "unseen" for f in feedback):
                raise ValueError("反馈目标重复或掌握度无效")
            if any(key not in allowed or key not in answered for key in supplied):
                raise ValueError("反馈包含未实际练习的目标")
            result = []
            for key, competency in allowed.items():
                if key not in answered:
                    continue
                f = supplied.get(key) or CoachFeedback(
                    module_id=key, note="本次已进行练习，未形成可靠的掌握度判断。")
                result.append(f.model_dump())
                if f.mastery:
                    practice[competency] = f.mastery
            run["feedback"] = result
            run["status"] = "ready"
            state["coach_transcript"] = (turns or [])[-200:]
            state["coach_ended_at"] = time.time()
        if await deps.repo.compare_and_set_study(session_id, data["study_revision"], state,
                                                 practice=practice):
            return CoachRun.model_validate(run)
    raise ValueError("反馈写入繁忙，请重试")
