"""版本化学习材料：只读投影、原文关联、原子租约和可恢复的有界生成。"""
from __future__ import annotations

import asyncio
import json
import time
from hashlib import sha256
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from ..core.deps import Deps
from ..core.logging import get_logger
from ..shared_models import (
    DrillItem,
    GrowthItem,
    ScoreCard,
    StudyCard,
    StudyModule,
    StudyTarget,
    StudyView,
)
from . import run_generate_drills, study_module_id

log = get_logger(__name__)
LEASE_SECONDS = 150


class _Link(BaseModel):
    model_config = ConfigDict(extra="forbid")
    competency: str = Field(min_length=1, max_length=120)
    weakness_ids: list[int]
    action_ids: list[int]


class _Links(BaseModel):
    model_config = ConfigDict(extra="forbid")
    links: list[_Link]
    general_action_ids: list[int]


def source_version(view) -> str:
    payload = {
        "format": 1,
        "scorecard": view.scorecard.model_dump(),
        "questions": [q.model_dump() for q in view.context.plan.questions],
        "language": view.context.plan.language_mode.primary,
    }
    return sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:24]


def _structured(sc: ScoreCard) -> bool:
    return bool(sc.growth_items) and (
        all(g.competency.strip() and g.text.strip() for g in sc.growth_items)
        and set(sc.weaknesses) == {g.text for g in sc.growth_items}
        and (not sc.next_steps or any(g.actions for g in sc.growth_items))
    )


async def normalize_growth(sc: ScoreCard, deps: Deps) -> list[GrowthItem]:
    if _structured(sc):
        return sc.growth_items
    if not sc.weaknesses and not sc.next_steps:
        return sc.growth_items or [GrowthItem(text=c, competency=c) for c in sc.weak_competencies]
    # 模型只分配原句编号，禁止重写报告内容或分数。
    system = (
        "将面试报告的原句关联为学习目标。仅输出编号，不重写原文。"
        "每个 weakness_ids 和 action_ids 都是对应输入数组的零基索引。"
        "所有成长建议必须归属一个能力；所有行动必须分到一个能力或 general_action_ids。"
        "只有与能力提升无关的一般建议才能归入 general_action_ids。"
        "能力名优先逐字使用已知能力，可为新增成长方向给出简短能力名。"
        "一个原句只能分配一次；不能发明编号。"
    )
    payload = {
        "weaknesses": sc.weaknesses, "actions": sc.next_steps,
        "known_competencies": list(dict.fromkeys([
            *[c.competency for c in sc.competency_scores],
            *[g.competency for g in sc.growth_items],
        ])),
    }
    links = await asyncio.wait_for(deps.llm.complete_json(
        system=system, user=json.dumps(payload, ensure_ascii=False), schema=_Links,
    ), timeout=60)
    weak_ids = [i for link in links.links for i in link.weakness_ids]
    action_ids = [i for link in links.links for i in link.action_ids] + links.general_action_ids
    if sorted(weak_ids) != list(range(len(sc.weaknesses))):
        raise ValueError("成长建议的关联不完整或重复")
    if sorted(action_ids) != list(range(len(sc.next_steps))):
        raise ValueError("下一步行动的关联不完整或重复")
    result = []
    for link in links.links:
        actions = [sc.next_steps[i] for i in link.action_ids]
        texts = [sc.weaknesses[i] for i in link.weakness_ids]
        if not texts and actions:
            texts = actions
        result.extend(GrowthItem(text=text, competency=link.competency.strip(), actions=actions)
                      for text in texts)
    return result


def targets_from_growth(items: list[GrowthItem], sc: ScoreCard, practice: dict) -> list[StudyTarget]:
    groups: dict[str, list[GrowthItem]] = {}
    for item in items:
        groups.setdefault(item.competency.strip(), []).append(item)
    scores = {c.competency: c.score for c in sc.competency_scores}
    targets = []
    for comp in sorted(groups, key=lambda c: scores.get(c, 99)):
        growth = list(dict.fromkeys(g.text for g in groups[comp]))
        actions = list(dict.fromkeys(a for g in groups[comp] for a in g.actions))
        targets.append(StudyTarget(
            module=StudyModule(id=study_module_id(comp), title=comp, competency=comp,
                               status=practice.get(comp, "learning"), est_min=25,
                               rationale="\n".join(growth)),
            growth=growth, actions=actions, material_status="pending",
        ))
    return targets


def material_cards(view, target: StudyTarget, drills: list[dict], version: str) -> list[StudyCard]:
    comp = target.module.competency
    language = view.context.plan.language_mode.primary
    answers = {a.question_id: a.answer.strip() for a in view.scorecard.model_answers}
    cards = []
    for question in view.context.plan.questions:
        front = question.text.get(language) or question.text.get("en", "")
        if question.target_competency == comp and front.strip() and answers.get(question.id):
            cards.append(StudyCard(id=question.id, competency=comp, front=front.strip(),
                                   back=answers[question.id], source="interview"))
    for raw in drills:
        try:
            d = DrillItem.model_validate(raw)
        except ValueError:
            continue
        if d.competency != comp or d.source_version != version or d.language != language:
            continue
        front = d.text.get(language) or d.text.get("en", "")
        if front.strip() and d.answer.strip():
            cards.append(StudyCard(id=d.id, competency=comp, front=front.strip(),
                                   back=d.answer.strip(), source="drill"))
    return cards


async def read_study(session_id: str, deps: Deps) -> StudyView:
    view = await deps.repo.get_session_view(session_id)
    if view is None:
        raise LookupError("会话不存在")
    if not view.scorecard or not view.context:
        raise ValueError("面试报告尚未就绪")
    data = await deps.repo.get_learning_data(session_id)
    if data is None:
        raise LookupError("会话不存在")
    version = source_version(view)
    state = data["study_state"]
    if state.get("version") != version:
        return StudyView(session_id=session_id, version=version,
                         role=view.context.job.title, company=view.context.job.company_name,
                         language=view.context.plan.language_mode.primary, status="idle", targets=[])
    result = StudyView.model_validate(state["view"])
    result.role, result.company = view.context.job.title, view.context.job.company_name
    if result.coach_run:
        ended = state.get("coach_ended_at")
        if ((result.coach_run.status == "pending" and ended and time.time() - ended > 90)
                or (result.coach_run.status == "running"
                    and time.time() - result.coach_run.started_at > deps.settings.max_interview_duration_sec + 90)):
            result.coach_run.status = "failed"
    for target in result.targets:
        target.cards = material_cards(view, target, data["drill_items"], version)
        if target.material_status == "ready" and not target.cards:
            target.material_status = "failed"
            target.error = "练习材料不可用，请重试"
        target.module.status = data["practice_state"].get(target.module.competency, "learning")
    return result


async def claim_prepare(session_id: str, deps: Deps, retry_module: str | None = None,
                        retry: bool = False) -> tuple[str, str] | None:
    for _ in range(16):
        view = await deps.repo.get_session_view(session_id)
        if not view or not view.scorecard or not view.context:
            raise ValueError("面试报告尚未就绪")
        version = source_version(view)
        data = await deps.repo.get_learning_data(session_id)
        if data is None:
            raise LookupError("会话不存在")
        state = data["study_state"]
        # 跨版本仍等待旧租约释放，避免同一会话同时运行两批模型任务。
        if state.get("lease_until", 0) > time.time():
            return None
        if state.get("version") != version:
            state = {"version": version, "view": StudyView(
                session_id=session_id, version=version,
                language=view.context.plan.language_mode.primary,
                status="preparing", targets=[],
            ).model_dump()}
        result = StudyView.model_validate(state["view"])
        if retry_module and not any(t.module.id == retry_module for t in result.targets):
            raise ValueError("学习目标不属于当前材料版本")
        if result.status == "failed" and not retry:
            return None
        if (result.status in ("ready", "empty") and not retry
                and not any(t.material_status == "pending" for t in result.targets)):
            return None
        if retry:
            for t in result.targets:
                missing = t.material_status == "ready" and not material_cards(view, t, data["drill_items"], version)
                if (t.material_status == "failed" or missing) and (not retry_module or t.module.id == retry_module):
                    t.material_status, t.error = "pending", None
        result.status, result.error = "preparing", None
        lease = uuid4().hex
        state.update(view=result.model_dump(), lease=lease, lease_until=time.time() + LEASE_SECONDS)
        if await deps.repo.compare_and_set_study(session_id, data["study_revision"], state):
            return version, lease
    raise RuntimeError("学习状态繁忙，请稍后重试")


async def _change(session_id: str, version: str, lease: str, deps: Deps,
                  change, drills: list[dict] | None = None) -> bool:
    for _ in range(24):
        data = await deps.repo.get_learning_data(session_id)
        if not data:
            return False
        state = data["study_state"]
        if state.get("version") != version or state.get("lease") != lease:
            return False
        change(state)
        if await deps.repo.compare_and_set_study(session_id, data["study_revision"], state, drills):
            return True
        await asyncio.sleep(0)
    raise RuntimeError("学习状态并发写入失败")


async def prepare_materials(session_id: str, version: str, lease: str, deps: Deps) -> None:
    try:
        view = await deps.repo.get_session_view(session_id)
        if not view or source_version(view) != version:
            return
        data = await deps.repo.get_learning_data(session_id)
        targets = [StudyTarget.model_validate(t) for t in data["study_state"]["view"]["targets"]]
        if not targets:
            items = await normalize_growth(view.scorecard, deps)
            targets = targets_from_growth(items, view.scorecard, data["practice_state"])
            def publish(state):
                state["view"]["targets"] = [t.model_dump() for t in targets]
                state["lease_until"] = time.time() + LEASE_SECONDS
            if not await _change(session_id, version, lease, deps, publish):
                return
        semaphore = asyncio.Semaphore(2)

        async def prepare(target: StudyTarget):
            if target.material_status != "pending":
                return
            async with semaphore:
                latest = await deps.repo.get_learning_data(session_id)
                if latest["study_state"].get("lease") != lease:
                    return
                if not await _change(session_id, version, lease, deps,
                                     lambda s: s.update(lease_until=time.time() + LEASE_SECONDS)):
                    return
                language = view.context.plan.language_mode.primary
                cards = material_cards(view, target, latest["drill_items"], version)
                additions = []
                if not cards:
                    # 旧补题首次复用需校验内容和语言；不采用其他已标记版本的题。
                    for raw in latest["drill_items"]:
                        try:
                            d = DrillItem.model_validate(raw)
                        except ValueError:
                            continue
                        if (d.competency == target.module.competency and not d.source_version
                                and d.text.get(language, "").strip() and d.answer.strip()):
                            additions.append(d.model_copy(update={
                                "source_version": version, "language": language,
                            }).model_dump())
                    if not additions:
                        evidence = "\n".join([*target.growth, *target.actions])
                        generated = await run_generate_drills(target.module.competency, evidence,
                                                              language, deps)
                        additions = [d.model_copy(update={"source_version": version,
                                                          "language": language}).model_dump()
                                     for d in generated]
                    cards = material_cards(view, target, additions, version)
                def finish(state):
                    for stored in state["view"]["targets"]:
                        if stored["module"]["id"] == target.module.id:
                            stored["material_status"] = "ready" if cards else "failed"
                            stored["error"] = None if cards else "练习题准备失败，请重试此项"
                    state["lease_until"] = time.time() + LEASE_SECONDS
                await _change(session_id, version, lease, deps, finish, additions)
        outcomes = await asyncio.gather(*(prepare(t) for t in targets), return_exceptions=True)
        for target, outcome in zip(targets, outcomes, strict=True):
            if isinstance(outcome, BaseException):
                def failed_module(state, target_id=target.module.id):
                    for stored in state["view"]["targets"]:
                        if stored["module"]["id"] == target_id:
                            stored.update(material_status="failed", error="练习题准备失败，请重试此项")
                await _change(session_id, version, lease, deps, failed_module)
        def complete(state):
            state["view"]["status"] = "ready" if targets else "empty"
            state["lease_until"] = 0
        await _change(session_id, version, lease, deps, complete)
    except Exception:
        log.exception("学习材料准备失败: %s", session_id)
        def fail(state):
            state["view"]["status"] = "failed"
            state["view"]["error"] = "学习目标或材料暂未整理完成，请重试；原报告未改变"
            state["lease_until"] = 0
        await _change(session_id, version, lease, deps, fail)
    finally:
        # 重新评分导致来源过期时也释放租约，后续准备会建立新版本。
        await _change(session_id, version, lease, deps, lambda s: s.update(lease_until=0))
