"""Tests for local-first tracing (WP-12): spans, LLM wrapper, pipeline hooks.

Tracing is OFF by default in this suite (``tests/conftest.py`` sets
``TRACE_ENABLED=0``). Each test opts back in with
``tracing.init_tracing(enabled=True, trace_dir=tmp_path)`` and resets
afterwards, so no test writes into the repo checkout.
"""

from __future__ import annotations

import asyncio
import contextvars
import json

import pytest
from fastapi.testclient import TestClient

from deepinterview_agent.app import create_app
from deepinterview_agent.core import tracing
from deepinterview_agent.core.adapters.mock import MockLLM
from deepinterview_agent.core.deps import build_deps
from deepinterview_agent.shared_models import LanguageMode, PrepRequest


@pytest.fixture
def tracedir(tmp_path, monkeypatch):
    monkeypatch.setenv("TRACE_ENABLED", "1")
    tracing.init_tracing(enabled=True, trace_dir=tmp_path, include_prompts=False)
    yield tmp_path
    tracing.reset_tracing()
    monkeypatch.setenv("TRACE_ENABLED", "0")


def _events(tracedir, trace_id):
    path = tracedir / f"{trace_id}.jsonl"
    assert path.exists(), f"expected trace file for {trace_id}"
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _request() -> PrepRequest:
    return PrepRequest(
        cv_url="https://example.com/cv.pdf",
        jd_text="Senior Backend Engineer building distributed payment systems in Python.",
        company="ExampleCorp",
        language_mode=LanguageMode(primary="en", mixed=False),
    )


class _UsageLLM:
    """Minimal adapter that reports token usage through the adapters' ContextVar.

    Mirrors what OpenAILLM/GeminiLLM do on a real call: stash usage before
    returning text, so TracedLLM can pull it back out for the span + JSONL.
    """

    _model = "fake-model"

    async def complete_text(self, *, system: str, user: str) -> str:
        from deepinterview_agent.core.adapters.llm import _call_usage

        _call_usage.set({"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18})
        return "the answer"


def test_start_trace_and_nested_spans(tracedir) -> None:
    with tracing.start_trace("demo", session_id="sess_x", metadata={"k": "v"}) as tid:
        assert tid.startswith("tr_")
        with tracing.start_span("outer", step=1):
            tracing.add_event("note", {"a": 1})
            with tracing.start_span("inner"):
                pass
    events = _events(tracedir, tid)
    types = [e["type"] for e in events]
    assert types[0] == "trace_start"
    assert types[-1] == "trace_end"
    assert events[0]["session_id"] == "sess_x"
    assert events[-1]["status"] == "ok"
    span_starts = [e for e in events if e["type"] == "span_start"]
    assert [s["name"] for s in span_starts] == ["outer", "inner"]
    # Nesting: inner's parent is outer.
    assert span_starts[1]["parent_id"] == span_starts[0]["span_id"]
    assert any(e["type"] == "event" and e["name"] == "note" for e in events)


def test_trace_can_close_from_a_different_context(tracedir) -> None:
    """LiveKit opens a live trace in entrypoint and closes it in shutdown.

    Those callbacks run in different asyncio Contexts, where resetting the
    entrypoint's ContextVar token raises ValueError unless tracing treats the
    close as detached. The trace must still end cleanly because persistence and
    scoring run immediately afterwards in the same shutdown callback.
    """
    trace = tracing.start_trace("live", session_id="sess_cross_context")
    tid = trace.__enter__()

    contextvars.Context().run(trace.__exit__, None, None, None)

    events = _events(tracedir, tid)
    assert [e["type"] for e in events].count("trace_end") == 1
    assert events[-1]["status"] == "ok"


def test_add_event_pinned_trace_id_survives_foreign_context(tracedir) -> None:
    """``trace_id=`` lands an event even where the trace's ContextVar is invisible.

    LiveKit fires conversation/shutdown callbacks from SDK-owned asyncio
    contexts; an unpinned add_event there silently no-ops (the symptom: live
    traces holding only the opening turn). Pinning must repair exactly that.
    """
    trace = tracing.start_trace("live")
    tid = trace.__enter__()
    try:
        contextvars.Context().run(  # a truly empty context: no active trace
            tracing.add_event, "turn", {"role": "user", "chars": 42}, 
        )
        tracing.add_event("turn", {"role": "assistant", "chars": 7}, trace_id=tid)
        contextvars.Context().run(
            tracing.add_event, "turn", {"role": "user", "chars": 99}, trace_id=tid,
        )
    finally:
        trace.__exit__(None, None, None)
    events = [
        json.loads(line)
        for line in (tracedir / f"{tid}.jsonl").read_text().splitlines()
    ]
    turns = [e for e in events if e.get("name") == "turn"]
    # The unpinned call from the empty context is dropped (pre-fix behaviour,
    # still correct when no id is passed); both pinned calls land.
    assert [t["attrs"]["chars"] for t in turns] == [7, 99]


def _memory_tracer(monkeypatch):
    """Swap in an in-memory OTel tracer so parenting can be asserted offline."""
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
        InMemorySpanExporter,
    )

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    monkeypatch.setattr(tracing, "_otel_tracer", provider.get_tracer("test"))
    return exporter


def test_otel_spans_form_one_tree_under_root(tracedir, monkeypatch) -> None:
    """Langfuse must see ONE trace per run, not scattered one-row-per-call.

    Every span and event started inside a start_trace block must share the
    root's trace id and nest under it — the fix for the dashboard showing
    prep.fetch_cv / prep.jd_analysis as unrelated standalone traces.
    """
    exporter = _memory_tracer(monkeypatch)
    with tracing.start_trace("live", session_id="sess_tree"):
        with tracing.start_span("turn"):
            tracing.add_event("note", {"a": 1})
        tracing.add_event("pipe.transcript", {"chars": 5})
    spans = {s.name: s for s in exporter.get_finished_spans()}
    assert set(spans) >= {"live", "turn", "note", "pipe.transcript"}
    root = spans["live"]
    assert root.parent is None
    assert root.attributes.get("session.id") == "sess_tree"
    for name in ("turn", "note", "pipe.transcript"):
        assert spans[name].parent is not None
        assert spans[name].context.trace_id == root.context.trace_id
    # Events inside an open span nest under that span, not the bare root.
    assert spans["turn"].parent.span_id == root.context.span_id
    assert spans["note"].parent.span_id == spans["turn"].context.span_id
    assert spans["pipe.transcript"].parent.span_id == root.context.span_id


def test_pinned_event_from_foreign_context_joins_tree(tracedir, monkeypatch) -> None:
    """A pinned event emitted where the ContextVar is invisible still trees.

    The registry (not the ContextVar) must supply the OTel root for SDK
    callback tasks, so LiveKit-side turn/pipe.* events land inside the same
    hosted trace instead of being dropped or standing alone.
    """
    exporter = _memory_tracer(monkeypatch)
    trace = tracing.start_trace("live")
    tid = trace.__enter__()
    try:
        contextvars.Context().run(tracing.add_event, "turn", {"chars": 9}, trace_id=tid)
    finally:
        trace.__exit__(None, None, None)
    spans = {s.name: s for s in exporter.get_finished_spans()}
    assert spans["turn"].parent.span_id == spans["live"].context.span_id
    assert spans["turn"].context.trace_id == spans["live"].context.trace_id


def test_span_error_is_recorded_not_raised_past_trace(tracedir) -> None:
    with (
        tracing.start_trace("boom") as tid,
        pytest.raises(ValueError, match="nope"),
        tracing.start_span("risky"),
    ):
        raise ValueError("nope")
    events = _events(tracedir, tid)
    span_end = next(e for e in events if e["type"] == "span_end")
    assert span_end["status"] == "error"
    assert "ValueError" in span_end["error"]
    assert next(e for e in events if e["type"] == "trace_end")["status"] == "ok"


def test_traced_decorator_names_span(tracedir) -> None:
    @tracing.traced("custom.name")
    async def work() -> str:
        return "done"

    assert asyncio.run(work()) == "done"
    files = list(tracedir.glob("tr_*.jsonl"))
    assert len(files) == 1  # auto-trace: decorator outside a trace still records
    events = [json.loads(line) for line in files[0].read_text().splitlines()]
    assert events[0]["type"] == "trace_start"
    assert events[0]["name"] == "auto"
    assert any(e["type"] == "span_start" and e["name"] == "custom.name" for e in events)


def test_traced_llm_records_calls(tracedir) -> None:
    from deepinterview_agent.shared_models import JobSpec

    llm = tracing.TracedLLM(MockLLM(), provider="mock")
    with tracing.start_trace("llm-demo") as tid:
        asyncio.run(llm.complete_text(system="sys", user="hello"))
        asyncio.run(llm.complete_json(system="sys", user="{}", schema=JobSpec))
    events = _events(tracedir, tid)
    calls = [e for e in events if e["type"] == "llm_call"]
    assert len(calls) == 2
    assert calls[0]["method"] == "complete_text"
    assert calls[1]["schema"] == "JobSpec"
    assert all(c["ok"] for c in calls)
    # No prompt text by default (lengths only).
    assert "prompt_preview" not in calls[0]


def test_traced_llm_stashes_usage_and_output(tmp_path, monkeypatch) -> None:
    """With prompts opted in, the JSONL llm_call carries token usage + I/O text."""
    monkeypatch.setenv("TRACE_ENABLED", "1")
    tracing.init_tracing(enabled=True, trace_dir=tmp_path, include_prompts=True)
    try:
        llm = tracing.TracedLLM(_UsageLLM(), provider="fake")
        with tracing.start_trace("llm-usage") as tid:
            asyncio.run(llm.complete_text(system="sys", user="hello"))
        call = next(e for e in _events(tmp_path, tid) if e["type"] == "llm_call")
        assert call["usage"] == {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}
        assert call["output_preview"] == "the answer"
        assert call["prompt_preview"] == "sys\nhello"
    finally:
        tracing.reset_tracing()
        monkeypatch.setenv("TRACE_ENABLED", "0")


def test_traced_llm_tags_langfuse_generation_span(tmp_path, monkeypatch) -> None:
    """The active OTel span must be tagged as a Langfuse generation.

    Asserts the exact attribute keys the Langfuse SDK reads (verified against the
    installed package), so the dashboard renders model + token usage + full I/O
    instead of a bare span. Bypasses _otel_start's 500-char truncation by design.
    """
    monkeypatch.setenv("TRACE_ENABLED", "1")
    tracing.init_tracing(enabled=True, trace_dir=tmp_path, include_prompts=True)
    try:
        exporter = _memory_tracer(monkeypatch)
        llm = tracing.TracedLLM(_UsageLLM(), provider="fake")
        with tracing.start_trace("llm-gen"):
            asyncio.run(llm.complete_text(system="sys", user="hello"))
        spans = {s.name: s for s in exporter.get_finished_spans()}
        attrs = spans["llm.complete_text"].attributes
        assert attrs["langfuse.observation.type"] == "generation"
        assert attrs["langfuse.observation.model.name"] == "fake-model"
        assert json.loads(attrs["langfuse.observation.usage_details"])["total_tokens"] == 18
        assert attrs["langfuse.observation.input"] == "sys\nhello"
        assert attrs["langfuse.observation.output"] == "the answer"
    finally:
        tracing.reset_tracing()
        monkeypatch.setenv("TRACE_ENABLED", "0")


def test_traced_node_annotates_io(tmp_path, monkeypatch) -> None:
    """A @traced pipeline node auto-tags its span with input manifest + output.

    This is the phase-2 fix for prep nodes showing no I/O: the decorator reads
    the leading ``state`` arg (long strings collapse to a marker so a full CV is
    never re-dumped) and serializes the returned partial-state dict as output.
    """
    monkeypatch.setenv("TRACE_ENABLED", "1")
    tracing.init_tracing(enabled=True, trace_dir=tmp_path, include_prompts=True)
    try:
        exporter = _memory_tracer(monkeypatch)

        @tracing.traced("node.demo")
        async def node(state, deps):
            return {"candidate": {"name": "Ada", "years": 5}}

        with tracing.start_trace("t"):
            asyncio.run(node({"cv_text": "x" * 500, "req": object()}, None))

        spans = {s.name: s for s in exporter.get_finished_spans()}
        attrs = spans["node.demo"].attributes
        assert json.loads(attrs["langfuse.observation.output"])["candidate"]["name"] == "Ada"
        # A long input string collapses to a size marker, not its content.
        assert json.loads(attrs["langfuse.observation.input"])["cv_text"] == "<str 500>"
    finally:
        tracing.reset_tracing()
        monkeypatch.setenv("TRACE_ENABLED", "0")


def test_traced_node_io_gated_when_prompts_off(tracedir, monkeypatch) -> None:
    """With TRACE_INCLUDE_PROMPTS off, nodes carry no observation I/O."""
    exporter = _memory_tracer(monkeypatch)

    @tracing.traced("node.demo")
    async def node(state, deps):
        return {"candidate": {"name": "Ada"}}

    with tracing.start_trace("t"):
        asyncio.run(node({"cv_text": "hello"}, None))
    spans = {s.name: s for s in exporter.get_finished_spans()}
    assert "langfuse.observation.output" not in spans["node.demo"].attributes


def test_annotate_trace_io_sets_root_attributes(tmp_path, monkeypatch) -> None:
    """The trace root gets langfuse.trace.input/output so Sessions isn't blank."""
    monkeypatch.setenv("TRACE_ENABLED", "1")
    tracing.init_tracing(enabled=True, trace_dir=tmp_path, include_prompts=True)
    try:
        exporter = _memory_tracer(monkeypatch)
        with tracing.start_trace("prep", session_id="s"):
            tracing.annotate_trace_io(
                input_obj={"company": "ACME"}, output_obj={"questions": 5}
            )
        spans = {s.name: s for s in exporter.get_finished_spans()}
        attrs = spans["prep"].attributes
        assert json.loads(attrs["langfuse.trace.input"])["company"] == "ACME"
        assert json.loads(attrs["langfuse.trace.output"])["questions"] == 5
    finally:
        tracing.reset_tracing()
        monkeypatch.setenv("TRACE_ENABLED", "0")


def test_annotate_trace_io_pinned_foreign_context(tmp_path, monkeypatch) -> None:
    """A pinned trace_id resolves the root via the registry, not the ContextVar.

    Mirrors the worker shutdown path: the live trace root is annotated from an
    SDK-owned asyncio Context where ``_current_trace`` is invisible.
    """
    monkeypatch.setenv("TRACE_ENABLED", "1")
    tracing.init_tracing(enabled=True, trace_dir=tmp_path, include_prompts=True)
    try:
        exporter = _memory_tracer(monkeypatch)
        trace = tracing.start_trace("live")
        tid = trace.__enter__()
        try:
            contextvars.Context().run(
                tracing.annotate_trace_io, output_obj={"turns": 3}, trace_id=tid
            )
        finally:
            trace.__exit__(None, None, None)
        spans = {s.name: s for s in exporter.get_finished_spans()}
        assert json.loads(spans["live"].attributes["langfuse.trace.output"])["turns"] == 3
    finally:
        tracing.reset_tracing()
        monkeypatch.setenv("TRACE_ENABLED", "0")


def test_disabled_tracing_writes_nothing(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("TRACE_ENABLED", "0")
    tracing.reset_tracing()
    with tracing.start_trace("nope") as tid:
        assert tid == "tr_disabled"
        with tracing.start_span("x") as sid:
            assert sid == "sp_disabled"
            tracing.add_event("y")
    assert list(tmp_path.glob("*.jsonl")) == []
    tracing.reset_tracing()


def test_prep_run_emits_trace(tracedir) -> None:
    from deepinterview_agent.core.config import Settings

    settings = Settings(
        llm_provider="mock",
        search_provider="mock",
        trace_enabled=True,
        trace_dir=str(tracedir),
    )
    deps = build_deps(settings)
    from deepinterview_agent.prep import run_prep

    session_id = asyncio.run(run_prep(_request(), deps))
    files = list(tracedir.glob("tr_*.jsonl"))
    assert len(files) == 1
    events = [json.loads(line) for line in files[0].read_text().splitlines()]
    assert events[0]["name"] == "prep"
    assert events[0]["session_id"] == session_id
    span_names = {e["name"] for e in events if e["type"] == "span_start"}
    assert {"prep.cv_analysis", "prep.question_planner", "llm.complete_json"} <= span_names
    assert any(e["type"] == "event" and e["name"] == "prep.ready" for e in events)


def test_score_run_emits_trace(tracedir) -> None:
    from deepinterview_agent.core.config import Settings
    from deepinterview_agent.post import run_score
    from deepinterview_agent.prep import run_prep
    from deepinterview_agent.shared_models import ScoreRequest

    settings = Settings(llm_provider="mock", search_provider="mock")
    deps = build_deps(settings)
    session_id = asyncio.run(run_prep(_request(), deps))
    # Give the interview an answer so scoring has something to score.
    ctx = asyncio.run(deps.repo.load_context(session_id))
    assert ctx is not None
    from deepinterview_agent.shared_models import AnswerRecord

    ctx.answers.append(
        AnswerRecord(
            question_id=ctx.plan.questions[0].id,
            transcript="We migrated the checkout service to an event-driven design.",
            started_at="",
            ended_at="",
        )
    )
    asyncio.run(deps.repo.save_context(session_id, ctx))

    tracing.reset_tracing()
    tracing.init_tracing(enabled=True, trace_dir=tracedir)
    card = asyncio.run(run_score(ScoreRequest(session_id=session_id), deps))
    assert card.overall_score >= 0

    files = list(tracedir.glob("tr_*.jsonl"))
    score_traces = [
        f for f in files if json.loads(f.read_text().splitlines()[0])["name"] == "score"
    ]
    assert score_traces, "expected a score trace"
    events = [json.loads(line) for line in score_traces[0].read_text().splitlines()]
    span_names = {e["name"] for e in events if e["type"] == "span_start"}
    assert {"post.evaluate", "post.coach", "post.report"} <= span_names


def test_traces_api_lists_and_shows(tracedir, monkeypatch) -> None:
    with tracing.start_trace("api-demo", session_id="sess_api") as tid, tracing.start_span("work"):
        pass
    monkeypatch.setenv("TRACE_DIR", str(tracedir))
    from deepinterview_agent.core.config import get_settings

    get_settings.cache_clear()
    try:
        client = TestClient(create_app())
        resp = client.get("/api/traces")
        assert resp.status_code == 200
        traces = resp.json()["traces"]
        assert any(t["trace_id"] == tid for t in traces)

        detail = client.get(f"/api/traces/{tid}")
        assert detail.status_code == 200
        assert detail.json()["trace_id"] == tid
        assert detail.json()["spans"]

        assert client.get("/api/traces/tr_nope").status_code == 404
    finally:
        get_settings.cache_clear()


def test_list_traces_filters_by_session(tracedir) -> None:
    with tracing.start_trace("a", session_id="sess_1"):
        pass
    with tracing.start_trace("b", session_id="sess_2"):
        pass
    all_traces = tracing.list_traces(directory=tracedir)
    assert len(all_traces) == 2
    only_one = tracing.list_traces(directory=tracedir, session_id="sess_1")
    assert [t["session_id"] for t in only_one] == ["sess_1"]
