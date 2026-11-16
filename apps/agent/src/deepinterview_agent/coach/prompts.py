"""Prompt builders for the WP-4 Study Coach (kept separate from logic, like post/)."""

from __future__ import annotations

from ..prep.prompts import language_name


def study_module_prompts(
    competency: str, evidence: str, level: str, language: str = "en"
) -> tuple[str, str]:
    """Prompt to design ONE study module that closes a weak-competency gap.

    ``language`` (BCP-ish code, default "en") controls the output language of
    the free-text fields — legacy English-only callers keep the same behavior
    since the rule then simply pins English explicitly. A Chinese interview
    produces a Chinese study plan — same rule shape as the post pipeline's
    ``_output_language_rule``.
    """
    system = (
        "You are an expert interview-prep coach. Given a competency the candidate "
        "was weak on and the evidence from their interview, design ONE focused, "
        "actionable study module to close the gap. Return JSON with: title (short, "
        "concrete), rationale (one sentence tying it to the observed gap), and "
        "est_min (focused minutes to complete, between 10 and 45). "
        f"Write the title and rationale in {language_name(language)}. Keep JSON "
        "keys, numbers, and the competency name exactly as specified."
    )
    user = (
        f"Competency: {competency}\n"
        f"Observed level: {level}\n"
        f"Evidence from the interview: {evidence or '(no specific evidence captured)'}\n"
    )
    return system, user


def drill_prompts(
    competency: str, evidence: str, language: str = "en", count: int = 3
) -> tuple[str, str]:
    """Prompt to author a few FRESH drill questions for one growth competency.

    Used when a reported growth area has NO scored interview question (an
    overflow dimension the mock never probed): the deck would otherwise be empty
    for it. Each drill carries its own reference answer so it renders as a
    flashcard. ``language`` sets the question/answer language; ``question_en``
    always carries an English gloss so the card has a stable fallback key.
    """
    system = (
        "You are an expert interview-prep coach. The candidate flagged a growth "
        f"area with no matching interview question. Write {count} concise, "
        "original practice questions that drill it, each with a short reference "
        "answer (3-6 sentences) a candidate can study from. Return JSON with key "
        "`questions`, a list of objects each having: question_en (the question in "
        "English), question (the question in the target language), answer (the "
        "reference answer in the target language). "
        f"Write `question` and `answer` in {language_name(language)}. "
        "Keep questions specific and answerable, not generic trivia."
    )
    user = (
        f"Growth competency: {competency}\n"
        f"Evidence / context from the report: {evidence or '(no specific evidence captured)'}\n"
    )
    return system, user


def coach_chat_prompts(query: str, grounded_context: str, lang: str) -> tuple[str, str]:
    """Prompt to TEACH an answer to a learner question, grounded where possible."""
    system = (
        "You are a supportive, precise interview-prep coach. Answer the candidate's "
        "question by TEACHING: give a clear, structured explanation with one concrete "
        "example, grounded in the provided context when it is relevant. Reply in the "
        f"candidate's language ({language_name(lang)}). Return JSON with: answer (the taught "
        "explanation) and follow_ups (1-3 short suggested next questions)."
    )
    user = (
        f"Question: {query}\n\n"
        "Grounded context from the knowledge base "
        f"(use if relevant, ignore if not):\n{grounded_context or '(no grounded notes found)'}\n"
    )
    return system, user


def coach_agent_instructions(briefing: str, lang: str) -> str:
    """Lean system prompt for the SPOKEN Study Coach persona (live voice loop).

    Kept livekit-free here (like the other prompt builders) so the persona text
    is unit-testable without the ``livekit`` extra; ``live/coach_agent.py`` wraps
    it into a :class:`~livekit.agents.Agent`. The compact ``briefing`` is
    injected verbatim — build it with :func:`live.state.coach_briefing` (weak
    areas + the private model-answer reference), never the full scorecard.
    """
    return (
        "You are a warm, supportive interview-prep coach running a real-time "
        "SPOKEN coaching session. Speak naturally and concisely.\n\n"
        f"{briefing}\n\n"
        f"Primary language: {language_name(lang)}. Coach in this language.\n\n"
        "Coach Socratically: ask one focused question at a time to draw out the "
        "candidate's thinking before you explain. Give a hint or a worked example "
        "only after they have tried, and never lecture at length. Keep momentum: "
        "pick the weakest area first, confirm "
        "understanding, then move on. Never read a rubric or score aloud.\n\n"
        "End the session with the wrap_up tool: call it as soon as the learner "
        "can explain the target idea in their own words, or asks to stop. When "
        "you call it, pass the competency you focused on and an INFORMAL mastery "
        "self-assessment for it — your read of how well the learner arrived, one "
        "of unseen, learning, shaky or mastered (a practice-loop signal, not a "
        "graded score). After calling it, deliver a short closing synthesis — "
        "restate the chain of understanding the LEARNER built (in their words, "
        "not yours), name the one step that is still shaky, suggest the next "
        "practice — then stop without opening a new thread."
    )


def closing_instructions(lang: str) -> str:
    """One-shot instructions for the turn-cap backstop (worker_coach).

    When a coaching session runs past its soft turn cap without the persona
    calling ``wrap_up``, the worker injects this via ``generate_reply`` so the
    MODEL synthesizes a graceful close from the actual conversation — the
    SessionGuard's canned shutdown line stays the last resort, not the norm.
    """
    return (
        "This coaching session has reached its turn limit. Do NOT ask another "
        "question. Deliver your closing synthesis now: restate the chain of "
        "understanding the learner built in their own words, name the step that "
        "is still shaky, and suggest one next practice. Speak in "
        f"{language_name(lang)}."
    )
