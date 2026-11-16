import { describe, expect, it } from "vitest";
import {
  selectVisibleCards,
  buildStudyCards,
  type CardQuestionInput,
  type CardModelAnswerInput,
  type CardDrillInput,
} from "@/lib/prep-filter";
import type { Flashcard } from "@/lib/sample-mastery";

const DECK: Flashcard[] = [
  { id: "f1", front: "A", back: "a", competency: "System Design" },
  { id: "f2", front: "B", back: "b", competency: "Kafka" },
  { id: "f3", front: "C", back: "c", competency: "System Design" },
];

describe("selectVisibleCards — 'Start studying' deck filter", () => {
  it("returns the full deck when no module is selected", () => {
    expect(selectVisibleCards(DECK, null, false)).toEqual(DECK);
  });

  it("keeps only the module's cards when a filter is active", () => {
    const visible = selectVisibleCards(
      DECK,
      { title: "System Design basics", competency: "System Design" },
      false,
    );
    expect(visible.map((c) => c.id)).toEqual(["f1", "f3"]);
  });

  it("returns an empty slice for a module the deck never covers", () => {
    // The caller renders the "no cards for this module" fallback from this.
    const visible = selectVisibleCards(
      DECK,
      { title: "Leadership", competency: "Leadership" },
      false,
    );
    expect(visible).toEqual([]);
  });

  it("widens back to the full deck once the filter is dismissed", () => {
    expect(
      selectVisibleCards(
        DECK,
        { title: "Kafka", competency: "Kafka" },
        true,
      ),
    ).toEqual(DECK);
  });
});

describe("buildStudyCards — real deck assembly from the interview's own data", () => {
  const QUESTIONS: CardQuestionInput[] = [
    {
      id: "q1",
      text: { en: "Design a rate limiter", zh: "设计一个限流器" },
      target_competency: "System Design",
    },
    {
      id: "q2",
      text: { en: "Tell me about a conflict", zh: "讲一次冲突" },
      target_competency: "Communication",
    },
    {
      id: "q3",
      text: { en: "What is exactly-once?", zh: "exactly-once 是什么？" },
      target_competency: "Kafka",
    },
  ];
  const ANSWERS: CardModelAnswerInput[] = [
    { question_id: "q1", answer: "令牌桶 + 滑动窗口……" },
    { question_id: "q3", answer: "生产者幂等 + 事务消费……" },
  ];

  it("keeps only weak-competency questions that have a model answer", () => {
    const cards = buildStudyCards(
      QUESTIONS,
      ANSWERS,
      ["System Design", "Kafka"],
      "zh",
    );
    expect(cards.map((c) => c.id)).toEqual(["q1", "q3"]);
  });

  it("keys the card front to the interview language, falling back to en", () => {
    const zh = buildStudyCards(QUESTIONS, ANSWERS, ["Kafka"], "zh");
    expect(zh[0]?.front).toBe("exactly-once 是什么？");
    // A plan without the interview language written falls back to `en`.
    const fr = buildStudyCards(QUESTIONS, ANSWERS, ["Kafka"], "fr");
    expect(fr[0]?.front).toBe("What is exactly-once?");
  });

  it("drops a weak-competency question the model answers skipped", () => {
    // q2's competency is weak but no model answer exists → no card.
    const cards = buildStudyCards(QUESTIONS, ANSWERS, ["Communication"], "zh");
    expect(cards).toEqual([]);
  });

  it("carries the English competency key for the module filter join", () => {
    const cards = buildStudyCards(QUESTIONS, ANSWERS, ["System Design"], "zh");
    expect(cards[0]?.competency).toBe("System Design");
  });

  it("folds in targeted drills (self-contained answer) with no model answer", () => {
    // A drill is for an overflow competency the interview never asked about —
    // it becomes a card purely from its own text + answer.
    const drills = [
      {
        id: "drill_c1",
        competency: "Concurrency",
        text: { en: "Explain a deadlock", zh: "解释死锁" },
        answer: "四个必要条件……",
      },
    ];
    const cards = buildStudyCards(QUESTIONS, ANSWERS, ["System Design"], "zh", drills);
    const drill = cards.find((c) => c.id === "drill_c1");
    expect(drill?.competency).toBe("Concurrency");
    expect(drill?.front).toBe("解释死锁"); // interview language wins
    expect(drill?.back).toBe("四个必要条件……");
  });

  it("skips a drill with no front text or no answer", () => {
    const drills: CardDrillInput[] = [
      { id: "d_empty", competency: "X", text: {}, answer: "a" },
      { id: "d_noans", competency: "Y", text: { en: "q" }, answer: "" },
    ];
    const cards = buildStudyCards(QUESTIONS, ANSWERS, ["System Design"], "zh", drills);
    const ids = cards.map((c) => c.id);
    expect(ids).not.toContain("d_empty");
    expect(ids).not.toContain("d_noans");
  });
});
