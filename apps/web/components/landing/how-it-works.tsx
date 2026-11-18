import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";

/** Dictionary-key triples per step; labels resolve per locale in `HowItWorks`. */
const STEPS = [
  { num: "landing.how.s1num", title: "landing.how.s1title", body: "landing.how.s1body" },
  { num: "landing.how.s2num", title: "landing.how.s2title", body: "landing.how.s2body" },
  { num: "landing.how.s3num", title: "landing.how.s3title", body: "landing.how.s3body" },
] as const;

export async function HowItWorks() {
  const m = await getServerMessages();
  return (
    <section id="how" className="scroll-mt-24 py-[84px]">
      <Container>
        {/* 风格 A 定稿：上顶直接接 H2，不再挂 Eyebrow 与 sub行；与上一版不同，
            3 列也不再用卡片描边，回归到“纸上一块区域”的编辑排版节奏。 */}
        <Reveal className="mb-10">
          <h2 className="serif text-[34px] text-ink min-[920px]:text-[38px]">
            {t(m, "landing.how.title")}
          </h2>
        </Reveal>
        <Reveal>
          <div className="grid gap-8 md:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.num}>
                <div className="mb-3 font-mono text-[11.5px] uppercase tracking-[0.08em] text-accent-strong">
                  {t(m, step.num)}
                </div>
                <h3 className="mb-2 text-[17px] font-semibold text-ink">
                  {t(m, step.title)}
                </h3>
                <p className="text-[14.5px] leading-relaxed text-muted">
                  {t(m, step.body)}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
