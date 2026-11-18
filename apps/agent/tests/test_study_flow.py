"""学习闭环离线回归：原文、材料、并发、反馈、重点来源及独立新面试。"""
from __future__ import annotations

import asyncio
from dataclasses import replace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from deepinterview_agent.app import create_app
from deepinterview_agent.coach.runs import end_run, run_context, start_run
from deepinterview_agent.coach.study import (
    claim_prepare,
    normalize_growth,
    prepare_materials,
    read_study,
    targets_from_growth,
)
from deepinterview_agent.core.adapters.mock import build_mock
from deepinterview_agent.core.deps import build_deps
from deepinterview_agent.core.persistence.repository import MemoryRepository
from deepinterview_agent.prep import run_prep
from deepinterview_agent.prep.focus import (
    generate_focus_plan,
    read_prep_source,
    resolve_focus,
    validate_focus_plan,
)
from deepinterview_agent.shared_models import (
    AnswerRecord,
    CoachFeedback,
    CompetencyScore,
    DrillItem,
    FocusSource,
    GrowthItem,
    InterviewContext,
    ModelAnswer,
    PlannedQuestion,
    PrepRequest,
    QuestionPlan,
    ScoreCard,
)


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def seeded():
    deps = replace(build_deps(), repo=MemoryRepository())
    req = PrepRequest(cv_url="原始简历，五年后端开发经验，负责支付与库存系统，设计恢复方案并指导工程师排查线上故障。",
                      jd_text="后端开发工程师，设计高可用分布式系统并参与跨团队协作，负责容量规划、技术评审和性能调优。",
                      company="测试公司", language_mode={"primary": "zh", "mixed": False},
                      user_id="owner")
    sid = run(deps.repo.create_session(req))
    ctx = build_mock(InterviewContext)
    ctx.session_id = sid
    ctx.plan.language_mode = req.language_mode
    ctx.plan.questions = [build_mock(PlannedQuestion).model_copy(update={
        "id": "original", "section": "technical", "target_competency": "系统设计",
        "text": {"en": "How does the inventory ledger recover?", "zh": "库存账本如何恢复？"},
    })]
    ctx.answers = [AnswerRecord(question_id="original", transcript="先记录操作日志再做恢复。",
                               started_at="2026-01-01T00:00:00Z", ended_at="2026-01-01T00:01:00Z")]
    sc = build_mock(ScoreCard)
    sc.growth_items = [
        GrowthItem(competency="系统设计", text="缺少容量估算", actions=["练习峰值计算"]),
        GrowthItem(competency="团队协作", text="未展示跨团队影响", actions=["准备冲突案例"]),
    ]
    sc.weaknesses = [g.text for g in sc.growth_items]
    sc.next_steps = [a for g in sc.growth_items for a in g.actions]
    sc.competency_scores = [
        CompetencyScore(competency="系统设计", score=3.5, level="solid", evidence="恢复思路合理"),
    ]
    sc.model_answers = [ModelAnswer(question_id="original", answer="先定义恢复目标，再验证日志回放。")]
    run(deps.repo.save_context(sid, ctx))
    run(deps.repo.save_scorecard(sid, sc))
    return deps, sid, req, ctx, sc


async def prepared(deps, sid):
    claimed = await claim_prepare(sid, deps)
    assert claimed
    await prepare_materials(sid, *claimed, deps)
    return await read_study(sid, deps)


def test_structured_growth_keeps_solid_and_unscored_targets(seeded):
    deps, _, _, _, sc = seeded
    llm = AsyncMock()
    items = run(normalize_growth(sc, replace(deps, llm=llm)))
    targets = targets_from_growth(items, sc, {})
    assert [t.module.competency for t in targets] == ["系统设计", "团队协作"]
    assert targets[0].growth == ["缺少容量估算"]
    assert targets[0].actions == ["练习峰值计算"]
    llm.complete_json.assert_not_called()
    duplicated = targets_from_growth(items + items, sc, {})
    assert [t.module.id for t in duplicated] == [t.module.id for t in targets]
    assert duplicated[0].growth == targets[0].growth


@pytest.mark.parametrize("weak_ids,action_ids", [([0], [0, 1]), ([0, 0], [0, 1]),
                                                  ([0, 2], [0, 1]), ([0, 1], [0, 0])])
def test_legacy_linking_rejects_missing_duplicate_or_invalid_indices(seeded, weak_ids, action_ids):
    deps, _, _, _, sc = seeded
    sc.growth_items = []

    async def complete_json(**kwargs):
        return kwargs["schema"].model_validate({"links": [{"competency": "系统设计",
            "weakness_ids": weak_ids, "action_ids": action_ids}], "general_action_ids": []})

    with pytest.raises(ValueError):
        run(normalize_growth(sc, replace(deps, llm=AsyncMock(complete_json=complete_json))))


def test_legacy_linking_preserves_every_original_sentence(seeded):
    deps, _, _, _, sc = seeded
    sc.growth_items = []

    async def complete_json(**kwargs):
        return kwargs["schema"].model_validate({"links": [{"competency": "系统设计",
            "weakness_ids": [0, 1], "action_ids": [0]}], "general_action_ids": [1]})

    items = run(normalize_growth(sc, replace(deps, llm=AsyncMock(complete_json=complete_json))))
    assert [g.text for g in items] == sc.weaknesses
    assert all(g.actions == [sc.next_steps[0]] for g in items)


def test_original_material_precedes_drills_and_does_not_mutate_report(seeded):
    deps, sid, _, ctx, sc = seeded
    before = run(deps.repo.get_learning_data(sid))
    assert run(read_study(sid, deps)).status == "idle"
    assert run(deps.repo.get_learning_data(sid)) == before
    view = run(prepared(deps, sid))
    assert view.status == "ready"
    assert view.targets[0].cards[0].source == "interview"
    assert view.targets[1].cards[0].source == "drill"
    assert {d["competency"] for d in run(deps.repo.get_drill_items(sid))} == {"团队协作"}
    assert run(deps.repo.load_context(sid)) == ctx
    assert run(deps.repo.get_session_view(sid)).scorecard == sc
    revision = run(deps.repo.get_learning_data(sid))["study_revision"]
    assert run(claim_prepare(sid, deps)) is None
    assert run(deps.repo.get_learning_data(sid))["study_revision"] == revision


def test_concurrent_prepare_claim_has_only_one_winner(seeded):
    deps, sid, *_ = seeded

    async def race():
        return await asyncio.gather(*(claim_prepare(sid, deps) for _ in range(12)))

    winners = [c for c in run(race()) if c]
    assert len(winners) == 1
    run(prepare_materials(sid, *winners[0], deps))
    assert run(read_study(sid, deps)).status == "ready"


def test_legacy_drills_are_adopted_once_without_generation(seeded):
    deps, sid, *_ = seeded
    old = DrillItem(id="legacy", competency="团队协作", text={"en": "Conflict?", "zh": "怎样处理冲突？"},
                    answer="先澄清共同目标。")
    run(deps.repo.add_drill_items(sid, [old.model_dump()]))
    llm = AsyncMock()
    view = run(prepared(replace(deps, llm=llm), sid))
    assert view.targets[1].cards[0].id == "legacy"
    assert run(deps.repo.get_drill_items(sid))[0]["source_version"] == view.version
    llm.complete_json.assert_not_called()


def test_failure_is_per_module_and_explicit_retry_recovers(seeded, monkeypatch):
    deps, sid, *_ = seeded
    generate = AsyncMock(side_effect=RuntimeError("故障注入"))
    monkeypatch.setattr("deepinterview_agent.coach.study.run_generate_drills", generate)
    view = run(prepared(deps, sid))
    assert [t.material_status for t in view.targets] == ["ready", "failed"]
    assert run(claim_prepare(sid, deps)) is None
    generate.side_effect = None
    generate.return_value = [DrillItem(id="recovered", competency="团队协作",
        text={"en": "Resolve conflict", "zh": "解决争议"}, answer="对齐决策标准")]
    claim = run(claim_prepare(sid, deps, view.targets[1].module.id, retry=True))
    run(prepare_materials(sid, *claim, deps))
    assert all(t.material_status == "ready" for t in run(read_study(sid, deps)).targets)
    assert generate.await_count == 2


def test_missing_ready_materials_can_be_explicitly_regenerated(seeded, monkeypatch):
    deps, sid, *_ = seeded
    view = run(prepared(deps, sid))
    target = view.targets[1]
    deps.repo._rows[sid].drill_items = []
    assert run(read_study(sid, deps)).targets[1].material_status == "failed"
    generate = AsyncMock(return_value=[DrillItem(id="replacement", competency="团队协作",
        text={"en": "Resolve a conflict", "zh": "如何解决协作争议？"}, answer="对齐决策标准")])
    monkeypatch.setattr("deepinterview_agent.coach.study.run_generate_drills", generate)
    claim = run(claim_prepare(sid, deps, target.module.id, retry=True))
    assert claim
    run(prepare_materials(sid, *claim, deps))
    recovered = run(read_study(sid, deps))
    assert recovered.targets[1].material_status == "ready"
    assert recovered.targets[1].cards[0].id == "replacement"
    assert recovered.targets[0].cards == view.targets[0].cards
    generate.assert_awaited_once()


def test_generation_is_bounded_and_coach_feedback_survives_material_writes(seeded, monkeypatch):
    deps, sid, _, _, sc = seeded
    for i in range(4):
        sc.growth_items.append(GrowthItem(competency=f"补充能力{i}", text=f"补充建议{i}", actions=["演练"]))
    sc.weaknesses = [g.text for g in sc.growth_items]
    run(deps.repo.save_scorecard(sid, sc))

    async def scenario():
        active = peak = 0
        entered, release = asyncio.Event(), asyncio.Event()

        async def generate(comp, evidence, lang, deps):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            entered.set()
            await release.wait()
            await asyncio.sleep(0)
            active -= 1
            return [DrillItem(id=f"drill_{comp}", competency=comp,
                text={"en": f"Question {comp}", "zh": f"如何处理{comp}？"}, answer="参考思路")]

        monkeypatch.setattr("deepinterview_agent.coach.study.run_generate_drills", generate)
        claim = await claim_prepare(sid, deps)
        task = asyncio.create_task(prepare_materials(sid, *claim, deps))
        await entered.wait()
        view = await read_study(sid, deps)
        target = view.targets[0].module.id
        await start_run(sid, view.version, "concurrent-run-0001", target, deps)
        await end_run(sid, view.version, "concurrent-run-0001", deps,
            feedback=[CoachFeedback(module_id=target, mastery="shaky", note="需要继续验证")],
            turns=[{"module_id": target, "role": "user", "text": "先估计峰值"}])
        release.set()
        await task
        assert peak == 2
        final = await read_study(sid, deps)
        assert final.coach_run.status == "ready"
        assert final.targets[0].module.status == "shaky"
        assert all(t.cards for t in final.targets)

    run(scenario())


def test_expired_lease_and_old_version_cannot_replace_current_materials(seeded):
    deps, sid, _, _, sc = seeded
    old = run(claim_prepare(sid, deps))
    row = deps.repo._rows[sid]
    row.study_state["lease_until"] = 0
    sc.summary += "新版"
    run(deps.repo.save_scorecard(sid, sc))
    new = run(claim_prepare(sid, deps))
    assert old[0] != new[0]
    run(prepare_materials(sid, *old, deps))
    assert run(deps.repo.get_learning_data(sid))["study_state"]["lease"] == new[1]
    run(prepare_materials(sid, *new, deps))
    assert run(read_study(sid, deps)).version == new[0]


def test_no_growth_is_honest_empty_and_normalization_failure_is_retryable(seeded):
    deps, sid, _, _, sc = seeded
    sc.growth_items = []
    broken = replace(deps, llm=AsyncMock(complete_json=AsyncMock(side_effect=ValueError("格式错误"))))
    run(deps.repo.save_scorecard(sid, sc))
    assert run(prepared(broken, sid)).status == "failed"
    assert run(claim_prepare(sid, broken)) is None
    assert run(claim_prepare(sid, broken, retry=True))
    deps.repo._rows[sid].study_state["lease_until"] = 0
    sc.weaknesses, sc.next_steps, sc.weak_competencies = [], [], []
    run(deps.repo.save_scorecard(sid, sc))
    view = run(prepared(broken, sid))
    assert view.status == "empty" and not view.targets


def test_run_entry_keeps_all_goals_and_unanswered_goals_are_not_graded(seeded):
    deps, sid, *_ = seeded
    view = run(prepared(deps, sid))
    entry = view.targets[1].module.id
    args = (sid, view.version, "coach-run-00000001")
    first = run(start_run(*args, entry, deps))
    assert run(start_run(*args, entry, deps)) == first
    context = run(run_context(*args, deps))
    assert len(context.targets) == 2 and context.targets[0].module.id == entry
    run(end_run(*args, deps))
    assert run(read_study(sid, deps)).coach_run.status == "pending"
    result = run(end_run(*args, deps, feedback=[], turns=[
        {"module_id": entry, "role": "assistant", "text": "问题"},
        {"module_id": view.targets[0].module.id, "role": "user", "text": " "},
        {"module_id": entry, "role": "user", "text": "先澄清冲突"},
    ]))
    assert [f.module_id for f in result.feedback] == [entry]
    assert result.feedback[0].mastery is None
    assert run(deps.repo.get_practice_state(sid)) == {}
    assert run(end_run(*args, deps)) == result


@pytest.mark.parametrize("kind", ["unanswered", "duplicate", "unseen", "old_run", "old_version"])
def test_invalid_or_late_feedback_cannot_write_mastery(seeded, kind):
    deps, sid, _, _, sc = seeded
    view = run(prepared(deps, sid))
    target = view.targets[0].module.id
    args = (sid, view.version, "coach-run-00000002")
    run(start_run(*args, None, deps))
    feedback = [CoachFeedback(module_id=target, mastery="mastered", note="有证据")]
    turns = [{"module_id": target, "role": "user", "text": "回答"}]
    if kind == "unanswered":
        turns = []
    elif kind == "duplicate":
        feedback *= 2
    elif kind == "unseen":
        feedback[0].mastery = "unseen"
    elif kind == "old_run":
        run(start_run(sid, view.version, "coach-run-00000003", None, deps))
    else:
        sc.summary += "重新评分"
        run(deps.repo.save_scorecard(sid, sc))
    with pytest.raises(ValueError):
        run(end_run(*args, deps, feedback=feedback, turns=turns))
    assert run(deps.repo.get_practice_state(sid)) == {}


def test_source_authorization_original_inputs_and_real_baseline(seeded):
    deps, sid, req, ctx, _ = seeded
    view = run(prepared(deps, sid))
    with pytest.raises(PermissionError):
        run(read_prep_source(sid, "系统设计", "other", deps))
    source = run(read_prep_source(sid, "系统设计", "owner", deps))
    assert source.input.cv_url == req.cv_url and source.input.jd_text == req.jd_text
    assert source.input.user_id is None
    assert source.focus.baseline.score == 3.5
    assert source.focus.version == view.version
    assert run(read_prep_source(sid, "团队协作", "owner", deps)).focus.baseline is None
    ctx.answers = []
    run(deps.repo.save_context(sid, ctx))
    assert run(read_prep_source(sid, "系统设计", "owner", deps)).focus.baseline is None
    request = req.model_copy(update={"source_session_id": sid, "focus_competency": "系统设计"})
    _, avoid = run(resolve_focus(request, deps))
    assert "库存账本如何恢复？" in avoid
    assert all(c.front in avoid for c in view.targets[1].cards)
    with pytest.raises(ValueError):
        run(resolve_focus(request.model_copy(update={"focus_competency": "未知目标"}), deps))
    with pytest.raises(ValueError):
        run(resolve_focus(req.model_copy(update={"source_session_id": sid}), deps))


def focus_plan():
    questions = []
    specs = [
        ("intro", "沟通", "Introduce your recent project", "介绍最近的项目"),
        ("technical", "系统设计", "Design regional ticket reservations", "设计跨区域余票预订服务"),
        ("technical", "系统设计", "Handle a warehouse losing network access", "仓库断网后如何维持出库能力"),
        ("technical", "可观测性", "Diagnose a sudden heap memory spike", "怎样排查堆内存突增"),
        ("technical", "团队协作", "Negotiate a disagreement with product owners", "如何与产品负责人协商需求争议"),
        ("wrap", "沟通", "What would you like to ask", "有什么想了解的"),
    ]
    for i, (section, comp, en, zh) in enumerate(specs):
        questions.append(build_mock(PlannedQuestion).model_copy(update={
            "id": f"new_{i}", "section": section, "target_competency": comp,
            "text": {"en": en, "zh": zh},
        }))
    return QuestionPlan(questions=questions, sections_order=["intro", "technical", "wrap"],
                        time_budget_min=15, language_mode={"primary": "zh", "mixed": False})


@pytest.mark.parametrize("kind", ["ratio", "other", "duplicate", "near_duplicate", "language",
                                  "order", "time", "empty_id", "difficulty", "rubric", "weight"])
def test_focus_plan_rejects_invalid_complete_interviews(kind):
    source = FocusSource(session_id="source", version="v", module_id="m", competency="系统设计",
                         growth=["容量不足"], actions=["练习估算"])
    plan = focus_plan()
    assert validate_focus_plan(plan, source, [], "zh") == []
    avoid = []
    if kind == "ratio":
        plan.questions[1].target_competency = "其他"
    elif kind == "other":
        plan.questions[3].target_competency = "系统设计"
    elif kind == "duplicate":
        plan.questions[2].id = plan.questions[1].id
    elif kind == "near_duplicate":
        avoid = ["DESIGN regional ticket reservations!"]
    elif kind == "language":
        plan.questions[2].text.pop("zh")
    elif kind == "order":
        plan.questions[1], plan.questions[-1] = plan.questions[-1], plan.questions[1]
    elif kind == "empty_id":
        plan.questions[1].id = " "
    elif kind == "difficulty":
        plan.questions[1].difficulty = 6
    elif kind == "rubric":
        plan.questions[1].rubric = []
    elif kind == "weight":
        plan.questions[1].rubric[0].weight = 1.1
    else:
        plan.time_budget_min = 3
    assert validate_focus_plan(plan, source, avoid, "zh")


def test_focus_generator_repairs_once_and_never_silently_falls_back(seeded):
    deps, sid, req, *_ = seeded
    run(prepared(deps, sid))
    request = req.model_copy(update={"source_session_id": sid, "focus_competency": "系统设计"})
    source, avoid = run(resolve_focus(request, deps))
    invalid, valid = focus_plan(), focus_plan()
    invalid.time_budget_min = 3
    llm = AsyncMock(complete_json=AsyncMock(side_effect=[invalid, valid]))
    result = run(generate_focus_plan("规则", "岗位", source, avoid, request, replace(deps, llm=llm)))
    assert result == valid and llm.complete_json.await_count == 2
    assert "修正要求" in llm.complete_json.call_args.kwargs["user"]
    assert source.baseline.evidence not in llm.complete_json.call_args.kwargs["user"]
    llm.complete_json.side_effect = [invalid, invalid]
    with pytest.raises(ValueError, match="重点面试出题失败"):
        run(generate_focus_plan("规则", "岗位", source, avoid, request, replace(deps, llm=llm)))


def test_focused_prep_creates_independent_session_and_failure_stays_explicit(seeded):
    deps, sid, req, ctx, sc = seeded
    run(prepared(deps, sid))
    request = req.model_copy(update={"source_session_id": sid, "focus_competency": "系统设计"})

    class Planner:
        def __init__(self, valid):
            self.valid = valid

        async def complete_json(self, **kwargs):
            return focus_plan() if self.valid and kwargs["schema"] is QuestionPlan else build_mock(kwargs["schema"])

    new = run(run_prep(request, replace(deps, llm=Planner(True))))
    assert new != sid
    saved = run(deps.repo.load_context(new))
    assert saved and saved.focus_source.session_id == sid
    assert saved.answers == [] and saved.scorecard is None
    assert deps.repo.get_status(new) == "ready"
    failed = run(run_prep(request, replace(deps, llm=Planner(False))))
    assert deps.repo.get_status(failed) == "error"
    assert run(deps.repo.load_context(failed)) is None
    assert run(deps.repo.get_session_view(failed)).prep_warnings
    assert run(deps.repo.load_context(sid)) == ctx
    assert run(deps.repo.get_session_view(sid)).scorecard == sc
    assert run(deps.repo.get_practice_state(sid)) == {}


@pytest.mark.parametrize("pointer", ["https://example.com/expired.pdf", "data:application/pdf;base64,broken"])
@pytest.mark.parametrize("fetched", ["", "same", "missing"])
def test_focused_prep_stops_when_original_cv_cannot_be_read(seeded, monkeypatch, pointer, fetched):
    deps, sid, req, *_ = seeded
    run(prepared(deps, sid))
    request = req.model_copy(update={"source_session_id": sid, "focus_competency": "系统设计",
                                     "cv_url": pointer})
    result = {} if fetched == "missing" else {"cv_text": pointer if fetched == "same" else fetched}
    monkeypatch.setattr("deepinterview_agent.prep.fetch_cv", AsyncMock(return_value=result))
    llm = AsyncMock()
    new = run(run_prep(request, replace(deps, llm=llm)))
    assert new != sid and deps.repo.get_status(new) == "error"
    assert run(deps.repo.load_context(new)) is None
    assert any("重新上传" in warning for warning in run(deps.repo.get_session_view(new)).prep_warnings)
    llm.complete_json.assert_not_called()


def test_versioned_study_rejects_legacy_progress_and_missing_runs_are_404(seeded, monkeypatch):
    deps, sid, *_ = seeded
    run(prepared(deps, sid))
    monkeypatch.setattr("deepinterview_agent.api.coach.build_deps", lambda: deps)
    client = TestClient(create_app())
    before = run(deps.repo.get_learning_data(sid))
    response = client.post("/api/coach/progress", json={"session_id": sid,
        "competency": "系统设计", "mastery": "mastered"})
    assert response.status_code == 409
    assert run(deps.repo.get_learning_data(sid)) == before
    for endpoint in ("context", "result"):
        assert client.post(f"/api/coach/run/{endpoint}", json={"session_id": "missing",
            "version": "v", "run_id": "missing-run-00001"}).status_code == 404


def test_internal_secret_protects_study_and_worker_feedback(seeded, monkeypatch):
    deps, sid, *_ = seeded
    view = run(prepared(deps, sid))
    run_id = "protected-run-0001"
    run(start_run(sid, view.version, run_id, None, deps))
    monkeypatch.setattr("deepinterview_agent.api.coach.build_deps", lambda: deps)
    monkeypatch.setattr("deepinterview_agent.api.prep.build_deps", lambda: deps)
    monkeypatch.setattr("deepinterview_agent.api.auth.get_settings",
                        lambda: deps.settings.model_copy(update={"internal_api_secret": "test-only"}))
    client = TestClient(create_app())
    payload = {"session_id": sid, "version": view.version, "run_id": run_id}
    endpoints = [
        ("GET", f"/api/coach/study/{sid}", None),
        ("GET", f"/api/prep/source/{sid}?focus=系统设计", None),
        ("POST", "/api/coach/run/context", payload),
        ("POST", "/api/coach/run/result", payload),
    ]
    before = run(deps.repo.get_learning_data(sid))
    for secret in (None, "wrong"):
        for method, url, body in endpoints:
            headers = {"x-user-id": "owner"}
            if secret:
                headers["x-internal-secret"] = secret
            assert client.request(method, url, json=body, headers=headers).status_code == 401
    assert run(deps.repo.get_learning_data(sid)) == before
    for method, url, body in endpoints:
        assert client.request(method, url, json=body,
            headers={"x-user-id": "owner", "x-internal-secret": "test-only"}).status_code == 200


def test_study_and_source_apis_enforce_owner_without_side_effects(seeded, monkeypatch):
    deps, sid, *_ = seeded
    monkeypatch.setattr("deepinterview_agent.api.coach.build_deps", lambda: deps)
    monkeypatch.setattr("deepinterview_agent.api.prep.build_deps", lambda: deps)
    client = TestClient(create_app())
    for headers in ({}, {"x-user-id": "other"}):
        assert client.get(f"/api/coach/study/{sid}", headers=headers).status_code == 403
        assert client.get(f"/api/prep/source/{sid}?focus=系统设计", headers=headers).status_code == 403
    assert client.get("/api/coach/study/missing").status_code == 404
    before = run(deps.repo.get_learning_data(sid))
    assert client.get(f"/api/coach/study/{sid}", headers={"x-user-id": "owner"}).status_code == 200
    assert run(deps.repo.get_learning_data(sid)) == before
    view = run(prepared(deps, sid))
    source = client.get(f"/api/prep/source/{sid}?focus=系统设计", headers={"x-user-id": "owner"})
    assert source.status_code == 200
    assert "user_id" not in source.json()["input"]
    body = {"session_id": sid, "version": view.version, "run_id": "api-run-00000001"}
    assert client.post("/api/coach/run/start", json=body).status_code == 403
    assert client.post("/api/coach/run/start", json=body, headers={"x-user-id": "owner"}).status_code == 200
    assert client.post("/api/coach/run/start", json={**body, "version": "old"},
                       headers={"x-user-id": "owner"}).status_code == 409


def test_live_coach_can_switch_and_assess_the_actual_answered_goal(seeded):
    pytest.importorskip("livekit.agents")
    from deepinterview_agent.live.coach_agent import CoachAgent

    deps, sid, *_ = seeded
    view = run(prepared(deps, sid))
    coach = CoachAgent(briefing="", lang="zh", targets=view.targets)
    first, second = [t.module.id for t in view.targets]
    assert "默认包含全部目标" in coach.goal_instructions()
    assert "不能评价" in coach.assess_goal(second, "mastered", "未练过")
    coach.record_answer()
    run(coach.choose_goal(second))
    coach.assess_goal(first, "shaky", "回答缺少估算步骤")
    assert first in coach.feedback and second not in coach.feedback
    assert not coach.wrapping
    assert coach.active_goal == second
    coach.wrap_up(note="未作答不可评估", mastery="mastered")
    assert second not in coach.feedback
