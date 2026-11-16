"""LiveKit Agents worker entrypoint for the spoken Study Coach (voice sub-phase).

REQUIRES the optional ``livekit`` extra and live keys to RUN:

    uv sync --extra livekit
    # plus LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET and an STT/TTS/LLM
    # provider + key (Deepgram / Cartesia / OpenAI / Gemini); falls back to the
    # most basic available component when a provider/key is missing.

    python -m deepinterview_agent.worker_coach dev   # or: start / connect

This is the SPOKEN counterpart to ``worker.py``: instead of running the
interview, it runs a post-interview coaching conversation. It imports
``livekit.agents`` at load time, so it is NEVER imported by the offline test
path. It REUSES ``worker.py``'s component factories and context-loading helpers
verbatim (no duplicated provider wiring), loads the precomputed
``InterviewContext`` (which carries the ``ScoreCard`` once scoring has run), and
starts a lean :class:`~deepinterview_agent.live.coach_agent.CoachAgent` session.

The heavy planning (``run_coach_plan`` / ``run_coach_chat``) stays OFFLINE in the
``coach/`` module and over the ``/api/coach`` routes; this worker only carries the
spoken turn loop and wires no retrieval tool onto it — grounded coaching lives in
the latency-tolerant ``/api/coach/chat`` route, not the live loop.

This module is integration-tested MANUALLY (it needs the livekit extra + live
keys); there is no offline unit test for the worker itself. The livekit-free
logic it relies on (instructions + weak-areas summary) IS unit-tested in
``tests/test_voice_coach.py``.
"""

from __future__ import annotations

from livekit.agents import (
    AgentSession,
    JobContext,
    WorkerOptions,
    cli,
)

from .coach.prompts import closing_instructions
from .core.config import get_settings
from .core.deps import build_deps
from .core.logging import get_logger
from .core.observability import init_observability
from .core.tracing import add_event, start_trace
from .live.coach_agent import CoachAgent
from .live.guard import SessionGuard
from .live.state import InterviewUserdata, coach_briefing

# Reuse the interview worker's provider factories + context loaders verbatim so
# the coach worker and interview worker stay in lockstep (single source of truth).
from .worker import (
    _api_base,
    _internal_headers,
    _load_context_via_api,
    _session_id_from_room,
    build_conn_options,
    build_llm,
    build_room_options,
    build_stt,
    build_tts,
    build_turn_handling,
    build_vad,
    wire_transcript_capture,
)

log = get_logger(__name__)

# The mastery vocabulary the coach may self-assess into (mirrors the server's
# ``MasteryState`` Literal). Any other value (including the empty string the
# persona leaves when it cannot judge) is dropped rather than persisted.
_VALID_MASTERY = {"unseen", "learning", "shaky", "mastered"}

# Soft ceiling on LEARNER turns before the worker force-closes the session via
# generate_reply (the model synthesizes a real wrap-up from the conversation).
# Sits BELOW SessionGuard's hard ``max_interview_turns`` shutdown so the graceful
# close is the norm and the canned guard line is the last resort.
_COACH_SOFT_TURN_CAP = 20


async def _post_progress(
    settings, session_id: str, competency: str, mastery: str
) -> None:
    """Best-effort POST of the coach's mastery self-assessment to the API.

    Same cross-process rationale as ``worker._persist_via_api``: in memory mode
    the API owns the canonical repo, so the coach worker must not write its own.
    Any failure is logged and swallowed — a lost mastery signal must never
    break session teardown.
    """
    import httpx

    payload = {
        "session_id": session_id,
        "competency": competency,
        "mastery": mastery,
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{_api_base(settings)}/api/coach/progress",
                json=payload,
                headers=_internal_headers(settings),
            )
        if resp.status_code != 200:
            log.warning(
                "worker_coach: progress POST for %s -> %s", session_id, resp.status_code
            )
    except Exception:
        log.exception("worker_coach: progress POST failed for %s", session_id)


async def entrypoint(ctx: JobContext) -> None:
    settings = get_settings()
    init_observability(settings)
    deps = build_deps(settings)

    await ctx.connect()
    session_id = _session_id_from_room(ctx)

    interview_ctx = await _load_context_via_api(session_id, settings)
    if interview_ctx is None:
        log.error("worker_coach: no InterviewContext for session %s; aborting", session_id)
        return

    primary = interview_ctx.plan.language_mode.primary
    # Weak areas + the private model-answer reference for the weakest one —
    # the coach's judging context, never recited (see coach_briefing).
    summary = coach_briefing(
        interview_ctx.plan.questions, interview_ctx.scorecard, primary
    )

    # Carry the same per-session userdata shape as the interview worker. The
    # coach reuses the INTERVIEW's session row, so its conversation is persisted
    # under the separate coach_transcript column — writing to save_transcript
    # here would overwrite the interview record with the coach chat (or, before
    # turns were captured at all, with an empty list).
    userdata = InterviewUserdata(ctx=interview_ctx, session_id=session_id)

    # Trace the coach session (turn events land here). Closed in shutdown.
    # The id is captured because LiveKit delivers conversation/shutdown
    # callbacks from SDK-owned asyncio contexts where the entrypoint's trace
    # ContextVar is invisible — unpinned add_event calls silently no-op there.
    _coach_trace = start_trace("coach", session_id=session_id, metadata={"language": primary})
    _coach_trace_id = _coach_trace.__enter__()
    add_event("coach.start", {}, trace_id=_coach_trace_id)

    # Shared with build_stt: the local Whisper path segments the mic with it.
    vad = build_vad()
    conn_options = build_conn_options(settings)
    session: AgentSession[InterviewUserdata] = AgentSession(
        userdata=userdata,
        stt=build_stt(settings, primary, vad=vad),
        llm=build_llm(settings),
        tts=build_tts(settings, primary),
        vad=vad,
        # Same noisy-environment defenses as the interview worker (semantic
        # end-of-turn + word-gated interruptions); preemptive generation is on
        # by default in 1.5.x.
        turn_handling=build_turn_handling(primary),
        # Local providers need a longer per-request ceiling; None = SDK default.
        **({"conn_options": conn_options} if conn_options else {}),
    )

    # Capture the real coach conversation (CoachAgent's only tool is the
    # wrap_up exit signal, so nothing else ever fills the transcript log).
    # tag_questions=False: the coach chat is not answering the interview plan,
    # so turns must not carry its (possibly mid-plan) question ids.
    wire_transcript_capture(session, userdata, tag_questions=False,
                            trace_id=_coach_trace_id)

    coach = CoachAgent(briefing=summary, lang=primary)

    # Turn-cap backstop: count committed LEARNER turns; at the soft cap, inject
    # a one-shot closing synthesis (skipped when the persona already called
    # wrap_up — the graceful path wins). Second listener on the same event is
    # fine; wire_transcript_capture's handler keeps doing its own job.
    _turn_state = {"user": 0, "closing_sent": False}

    @session.on("conversation_item_added")
    def _count_user_turn(ev) -> None:
        item = ev.item
        if getattr(item, "role", None) != "user":
            return
        if not (getattr(item, "text_content", None) or "").strip():
            return
        _turn_state["user"] += 1
        if (
            _turn_state["user"] >= _COACH_SOFT_TURN_CAP
            and not _turn_state["closing_sent"]
            and not coach.wrapping
        ):
            _turn_state["closing_sent"] = True
            add_event("coach.soft_cap", {"user_turns": _turn_state["user"]},
                      trace_id=_coach_trace_id)
            session.generate_reply(instructions=closing_instructions(primary))

    # Same hard cost/duration backstop as the interview (Golden Rule #5): a
    # coaching chat is also a metered voice session and must never run unbounded.
    guard = SessionGuard(
        session,
        userdata,
        max_duration_sec=settings.max_interview_duration_sec,
        max_turns=settings.max_interview_turns,
    )

    async def _on_shutdown() -> None:
        try:
            add_event("coach.end", {"turns": len(userdata.transcript)},
                      trace_id=_coach_trace_id)
        finally:
            _coach_trace.__exit__(None, None, None)
        await guard.aclose()

        # Mastery write-back: the spoken coach runs in a SEPARATE process, so
        # (memory mode) a direct deps.repo write would land in a repo the API
        # never reads. POST the self-assessment to /api/coach/progress instead,
        # which merges into the same per-session practice_state the plan reads.
        assessment = coach.assessment or {}
        mastery = assessment.get("mastery")
        competency = (assessment.get("competency") or "").strip()
        if mastery in _VALID_MASTERY and competency:
            await _post_progress(settings, session_id, competency, mastery)

        if not userdata.transcript:
            return
        try:
            await deps.repo.save_coach_transcript(session_id, userdata.transcript)
        except Exception:
            log.exception("worker_coach: save_coach_transcript failed for %s", session_id)

    ctx.add_shutdown_callback(_on_shutdown)

    room_options = build_room_options(settings)
    start_kwargs = {"room_options": room_options} if room_options is not None else {}
    await session.start(
        agent=coach,
        room=ctx.room,
        **start_kwargs,
    )

    guard.start()


def main() -> None:
    # livekit-agents reads LIVEKIT_URL/API_KEY/API_SECRET from os.environ; we keep
    # them in Settings (.env), so pass them through explicitly to WorkerOptions.
    settings = get_settings()
    init_observability(settings)
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            ws_url=settings.livekit_url,
            api_key=settings.livekit_api_key,
            api_secret=settings.livekit_api_secret,
            # Explicit dispatch under its OWN name (mirrors worker.py's
            # issue-#67 mechanism): the coach token requests this exact name,
            # so interview jobs never land here and coach jobs never land in
            # the interviewer worker — the two voice workers can run at once.
            agent_name=settings.livekit_coach_agent_name,
        )
    )


if __name__ == "__main__":
    main()
