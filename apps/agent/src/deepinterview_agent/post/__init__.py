"""WP-7 post / scoring pipeline.

Turns a completed interview (a persisted ``InterviewContext`` with answers) into
a ``ScoreCard`` and persists it. The post phase is latency-tolerant, so this is a
plain sequential pipeline (no LangGraph): evaluate competencies → assess spoken
language → assemble the report.

Public entry point — the stable contract the API layer and tests depend on::

    async def run_score(req: ScoreRequest, deps: Deps) -> ScoreCard

``run_score`` loads the context, scores it, persists the scorecard, marks the
session ``complete``, and returns the card. If the context is missing it returns
a well-formed *error* ``ScoreCard`` (without persisting and without raising) so
the API can always respond with a valid body and an errored session keeps its
status.

The loop contract: each ``CompetencyScore.competency`` equals some planned
question's ``target_competency``, and ``weak_competencies`` (the weak/developing
subset) is what the Prep Coach consumes to choose what to teach next.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from ..core.logging import get_logger
from ..core.tracing import add_event, annotate_io, annotate_trace_io, start_span, start_trace
from ..shared_models import LanguageReport, ScoreCard
from .evaluator import evaluate
from .language_coach import coach
from .report import (
    _coverage_pct,
    _overall_score,
    _weak_competencies,
    generate_report,
)
from .verifier import verify_scores

if TYPE_CHECKING:
    from ..core.deps import Deps
    from ..shared_models import CompetencyScore, InterviewContext, ScoreRequest

log = get_logger(__name__)

__all__ = ["coach", "evaluate", "generate_report", "run_score", "verify_scores"]


def _missing_context_scorecard(session_id: str) -> ScoreCard:
    """A valid, empty scorecard for a session whose context cannot be loaded."""
    return ScoreCard(
        overall_score=0.0,
        competency_scores=[],
        strengths=[],
        weaknesses=[],
        weak_competencies=[],
        model_answers=[],
        next_steps=[],
        language_report=LanguageReport(
            fluency_score=0.0,
            filler_word_count=0,
            clarity_score=0.0,
            code_switching_notes="",
            pronunciation_notes="",
            summary="No interview context was found for this session.",
        ),
        summary=f"No interview context was found for session {session_id}; nothing to score.",
        coverage_pct=0.0,
    )


def _no_answers_scorecard(session_id: str) -> ScoreCard:
    """A valid, empty scorecard for a session that has a context but NO answers.

    Returned (not persisted) so a direct ``/api/score`` caller always gets a
    well-formed body. The session is flagged ``no_answers`` instead of
    ``complete`` so the report can show an honest empty state rather than a
    misleading all-zeros card.
    """
    return ScoreCard(
        overall_score=0.0,
        competency_scores=[],
        strengths=[],
        weaknesses=[],
        weak_competencies=[],
        model_answers=[],
        next_steps=[],
        language_report=LanguageReport(
            fluency_score=0.0,
            filler_word_count=0,
            clarity_score=0.0,
            code_switching_notes="",
            pronunciation_notes="",
            summary="No answers were recorded for this interview.",
        ),
        summary=(
            f"No answers were recorded for session {session_id}; "
            "the interview ended before any question was answered."
        ),
        coverage_pct=0.0,
    )


def _fallback_language_report() -> LanguageReport:
    """Neutral, well-formed language report used when the coach stage fails."""
    return LanguageReport(
        fluency_score=0.0,
        filler_word_count=0,
        clarity_score=0.0,
        code_switching_notes="",
        pronunciation_notes="",
        summary="Spoken-language assessment was unavailable for this interview.",
    )


# Degraded-card copy lives in code (it by-passes the LLM output-language rule,
# which only governs model-generated text), so it must be localized here or a
# Chinese interview gets English placeholders on its partial report.
_DEGRADED_COPY: dict[str, tuple[str, str]] = {
    # (next_steps, summary)
    "zh": (
        "重新运行评分以生成完整书面报告。",
        (
            "部分评分卡：详细报告生成暂时不可用。能力评分已保留，"
            "重新运行评分即可获得完整点评与参考回答。"
        ),
    ),
}
_DEFAULT_DEGRADED_COPY = (
    "Re-run scoring to generate the full written report.",
    (
        "Partial scorecard: detailed report generation was temporarily "
        "unavailable. Competency scores are preserved; re-run scoring for "
        "the full narrative and model answers."
    ),
)


def _degraded_scorecard(
    ctx: InterviewContext,
    comp_scores: list[CompetencyScore],
    lang_report: LanguageReport,
) -> ScoreCard:
    """A valid ScoreCard assembled WITHOUT the LLM narrative.

    Used when report generation (the narrative + model-answer LLM calls) fails
    but competency scoring and/or the language report succeeded. Preserves the
    numbers already computed so a transient model error never discards a
    completed interview's work. Placeholder copy follows the interview's
    primary language (English fallback for un-translated locales).
    """
    try:
        primary = ctx.plan.language_mode.primary
    except AttributeError:  # defensive: legacy/incomplete plans keep English
        primary = "en"
    next_step, summary = _DEGRADED_COPY.get(primary, _DEFAULT_DEGRADED_COPY)
    return ScoreCard(
        overall_score=_overall_score(comp_scores),
        competency_scores=comp_scores,
        strengths=[],
        weaknesses=[],
        weak_competencies=_weak_competencies(comp_scores),
        model_answers=[],
        next_steps=[next_step],
        language_report=lang_report,
        summary=summary,
        coverage_pct=_coverage_pct(ctx),
    )


async def _guarded(
    factory,
    *,
    label: str,
    timeout: float,
    attempts: int = 1,
    backoff_sec: float = 5.0,
):
    """Await ``factory()`` with a timeout; retry TIMEOUTS, fall back on anything else.

    The scoring pipeline is latency-tolerant but must never let one transient
    provider error or hang destroy a completed interview's scorecard. A hard
    timeout on a CONGESTED provider is not a permanent failure — queued calls
    clear within a minute — so on timeout the stage is re-invoked (up to
    ``attempts`` tries, sleeping ``backoff_sec`` in between). Non-timeout errors
    are assumed deterministic and degrade immediately, exactly once.
    """
    for attempt in range(1, max(1, attempts) + 1):
        try:
            return await asyncio.wait_for(factory(), timeout=timeout)
        except TimeoutError:
            if attempt >= attempts:
                log.warning(
                    "post: scoring stage %r timed out after %d attempt(s); degrading",
                    label,
                    attempt,
                )
                return None
            log.warning(
                "post: scoring stage %r timed out (attempt %d/%d); retrying",
                label,
                attempt,
                attempts,
            )
            await asyncio.sleep(backoff_sec)
        except Exception:
            log.exception("post: scoring stage %r failed; degrading", label)
            return None


async def _maybe_distill_skill(session_id: str, deps: Deps) -> None:
    """Best-effort closed-loop step (WP-10): propose a reusable playbook delta.

    Gated behind ``settings.enable_skill_distiller`` (OFF by default). Writes a
    draft into the review queue only — never the live library, never the score
    response. Any failure is logged and swallowed.
    """
    if not deps.settings.enable_skill_distiller:
        return
    try:
        from ..skilllib.distiller import (
            propose_skill,
        )

        draft = await propose_skill(session_id, deps)
        log.info("post: skill distiller proposed draft %s for session %s", draft.id, session_id)
    except Exception:
        log.exception("post: skill distiller failed for session %s", session_id)


# Per-session scoring locks. Scoring is triggered from the API process (both the
# worker's shutdown POST /api/score and a report page opening land here), so an
# in-process lock serializes the common concurrent case and prevents two runs of
# the paid LLM pipeline racing to overwrite the same scorecard. Keyed by session
# id; created lazily.
_scoring_locks: dict[str, asyncio.Lock] = {}


def _scoring_lock(session_id: str) -> asyncio.Lock:
    lock = _scoring_locks.get(session_id)
    if lock is None:
        lock = asyncio.Lock()
        _scoring_locks[session_id] = lock
    return lock


async def run_score(req: ScoreRequest, deps: Deps, *, force: bool = False) -> ScoreCard:
    """Score an interview session and return (and persist) its ``ScoreCard``.

    Each stage (evaluate / coach / report) is individually guarded with a
    timeout, timeout retries, and a structured fallback, so a transient
    provider failure degrades the scorecard rather than raising (which would
    500 the API and leave the session stuck mid-scoring). Whenever a context
    exists the resulting card is persisted and the session is marked
    ``complete``.

    ``force=True`` re-runs the pipeline even on an already-scored session —
    the real door behind the degraded card's "re-run scoring" advice.
    """
    # Serialize concurrent scorings of the same session (see _scoring_locks): the
    # loser waits and then hits the idempotency short-circuit below instead of
    # re-running the pipeline.
    async with _scoring_lock(req.session_id):
        return await _run_score_locked(req, deps, force=force)


async def _run_score_locked(req: ScoreRequest, deps: Deps, *, force: bool = False) -> ScoreCard:
    # Idempotency: scoring re-runs the full paid LLM pipeline, so a retry /
    # double-click against an already-scored session returns the persisted card
    # instead of re-billing and overwriting it. EXCEPT with force: a degraded
    # card is persisted as "complete", so without this door its own "re-run
    # scoring" advice would be unactionable.
    view = await deps.repo.get_session_view(req.session_id)
    if (
        not force
        and view is not None
        and view.status == "complete"
        and view.scorecard is not None
    ):
        log.info("post: session %s already scored; returning persisted card", req.session_id)
        return view.scorecard

    ctx = await deps.repo.load_context(req.session_id)
    if ctx is None:
        # No context to score. Returning (rather than persisting) is correct for
        # both an unknown session (nothing to write) and a prep-errored session
        # (don't overwrite its "error" status with "complete").
        return _missing_context_scorecard(req.session_id)

    # An answer only counts if it carries a non-empty transcript: the live
    # save_answer tool can record empty or unmatched answers that would pass a
    # bare list-truthiness check yet be unscorable (-> blank "complete" card).
    if not any((a.transcript or "").strip() for a in ctx.answers):
        # A context exists but no answers were captured (interview ended before
        # any question was answered, or answers never persisted). Do NOT run the
        # LLM scoring stages or mark the session "complete" with a blank card —
        # that yields a misleading all-zeros report. Flag it "no_answers" so the
        # UI shows an honest empty state, and persist NO scorecard.
        log.info("post: session %s has no answers; skipping scoring (no_answers)", req.session_id)
        await deps.repo.update_status(req.session_id, "no_answers")
        return _no_answers_scorecard(req.session_id)

    timeout = deps.settings.score_stage_timeout_sec
    attempts = deps.settings.score_stage_attempts
    backoff = deps.settings.score_stage_retry_backoff_sec

    # Trace the scoring work so `deepinterview traces` and GET /api/traces show
    # per-stage spans + LLM calls for this session. No-op when disabled.
    with start_trace("score", session_id=req.session_id):
        with start_span("post.evaluate"):
            comp_scores = await _guarded(
                lambda: evaluate(ctx, deps),
                label="evaluate",
                timeout=timeout,
                attempts=attempts,
                backoff_sec=backoff,
            )
            annotate_io(input_obj={"answers": len(ctx.answers)}, output_obj=comp_scores)
        if comp_scores is None:
            # The WHOLE evaluate stage failed for an interview that HAS answers
            # (per-question failures are isolated inside evaluate; None means the
            # stage itself died). Persisting a zero-score card as "complete" would
            # misreport an answered interview as scoring 0 — mark the session
            # errored (retriable: a later /api/score re-runs from the same context)
            # and return a well-formed card without persisting it.
            log.error("post: evaluate stage failed for %s; marking error (no card persisted)", req.session_id)
            await deps.repo.update_status(req.session_id, "error")
            return _degraded_scorecard(ctx, [], _fallback_language_report())

        # Optional adversarial calibration pass (gated, OFF by default). Guarded so a
        # verifier failure leaves the evaluated scores untouched rather than degrading.
        if deps.settings.enable_score_verifier:
            with start_span("post.verify"):
                verified = await _guarded(
                    lambda: verify_scores(ctx, comp_scores, deps),
                    label="verify",
                    timeout=timeout,
                    attempts=attempts,
                    backoff_sec=backoff,
                )
                annotate_io(
                    input_obj={"competencies": len(comp_scores)}, output_obj=verified
                )
            if verified is not None:
                comp_scores = verified

        with start_span("post.coach"):
            lang_report = await _guarded(
                lambda: coach(ctx, deps),
                label="coach",
                timeout=timeout,
                attempts=attempts,
                backoff_sec=backoff,
            )
            annotate_io(input_obj={"answers": len(ctx.answers)}, output_obj=lang_report)
        if lang_report is None:
            lang_report = _fallback_language_report()

        with start_span("post.report"):
            scorecard = await _guarded(
                lambda: generate_report(ctx, comp_scores, lang_report, deps),
                label="generate_report",
                timeout=timeout,
                attempts=attempts,
                backoff_sec=backoff,
            )
            annotate_io(
                input_obj={"competencies": len(comp_scores)}, output_obj=scorecard
            )
        if scorecard is None:
            scorecard = _degraded_scorecard(ctx, comp_scores, lang_report)

        await deps.repo.save_scorecard(req.session_id, scorecard)
        await deps.repo.update_status(req.session_id, "complete")
        add_event(
            "score.complete",
            {"overall": scorecard.overall_score, "competencies": len(scorecard.competency_scores)},
        )
        annotate_trace_io(
            input_obj={"questions": len(ctx.plan.questions), "answers": len(ctx.answers)},
            output_obj={
                "overall_score": scorecard.overall_score,
                "competency_scores": scorecard.competency_scores,
            },
        )

        # Closed-loop (WP-10): propose a reusable playbook delta. Off by default,
        # best-effort, and fully guarded so it can never affect the returned card.
        await _maybe_distill_skill(req.session_id, deps)

        return scorecard
