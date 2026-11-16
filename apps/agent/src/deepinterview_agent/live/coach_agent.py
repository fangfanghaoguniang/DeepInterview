"""Spoken Study Coach persona for the live voice stack (voice sub-phase of WP-4).

REQUIRES the optional ``livekit-agents`` extra (``uv sync --extra livekit``);
this module imports ``livekit.agents`` at load time and must NOT be imported by
``live/__init__.py`` (keep the offline ``import ...live.state`` path clean). It is
imported lazily by ``worker_coach.py``.

The :class:`CoachAgent` is a lean :class:`~livekit.agents.Agent` that runs a
Socratic, spoken coaching session. The heavy planning (scorecard -> StudyPlan,
grounded chat synthesis) stays in the OFFLINE ``coach/`` module; this persona only
carries the live turn loop. Its ONE tool is ``wrap_up`` — an exit signal that
feeds the closing instruction back to the model AND records an informal
mastery self-assessment for the competency just coached (mutating nothing but
this in-memory field — no network / DB on the turn path). ``worker_coach``
reads ``assessment`` on shutdown and POSTs it back over HTTP. Grounded
coaching stays the latency-tolerant offline ``/api/coach/chat`` route's job,
not the live loop's.

The instructions string is built by the livekit-free
:func:`deepinterview_agent.coach.prompts.coach_agent_instructions`, so the persona
text is unit-testable without the livekit extra.
"""

from __future__ import annotations

from livekit.agents import Agent, function_tool

from ..coach.prompts import coach_agent_instructions


class CoachAgent(Agent):
    """A spoken, Socratic interview-prep coach persona.

    Args:
        briefing: The lean opening context — weak areas + the private
            model-answer reference (see
            :func:`deepinterview_agent.live.state.coach_briefing`). Injected
            verbatim into the instructions so the live prompt stays lean.
        lang: Primary language to coach in.
    """

    def __init__(self, *, briefing: str, lang: str = "en") -> None:
        super().__init__(
            instructions=coach_agent_instructions(briefing, lang),
        )
        # Set once the persona has been told to close; worker_coach's turn-cap
        # backstop skips its forced closing nudge when the coach is already
        # wrapping (the graceful path wins over the injected one).
        self.wrapping = False
        # Informal mastery self-assessment captured on the graceful exit
        # (``{"competency", "mastery", "note"}``), or ``None`` when the session
        # ended without ``wrap_up`` (turn cap / hard guard). ``worker_coach``
        # reads this on shutdown to write practice_state back over HTTP.
        self.assessment: dict[str, str] | None = None

    @function_tool
    def wrap_up(
        self,
        competency: str = "",
        mastery: str = "",
        note: str = "",
    ) -> str:
        """Call when the learner can explain the target idea in their own
        words, or asks to stop. Marks the session complete so the closing
        synthesis becomes the last agent turn.

        Also record an INFORMAL self-assessment of the coaching you just did:
        ``competency`` is the focus area you worked on; ``mastery`` is your read
        of where the learner landed — one of ``unseen``, ``learning``, ``shaky``
        or ``mastered`` (a practice-loop signal, NOT a graded score); ``note``
        is an optional one-line remark. Leave them blank only if you truly
        cannot judge."""
        self.wrapping = True
        self.assessment = {
            "competency": competency,
            "mastery": mastery,
            "note": note,
        }
        return (
            "Session marked complete. Deliver your closing synthesis now: "
            "restate the chain the learner built in their own words, name the "
            "step that is still shaky, suggest one next practice — then stop "
            "asking questions."
        )
