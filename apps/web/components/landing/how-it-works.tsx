import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
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
        <Reveal className="mb-12 max-w-[680px]">
          <Eyebrow>{t(m, "landing.how.eyebrow")}</Eyebrow>
          <h2 className="serif my-3.5 text-[38px]">
            {t(m, "landing.how.title")}
          </h2>
          <p className="text-[17px] text-ink-soft">
            {t(m, "landing.how.sub")}
          </p>
        </Reveal>
        <Reveal>
          <div className="grid overflow-hidden rounded-2xl border border-line bg-panel md:grid-cols-3">
            {STEPS.map((step) => (
              <div
                key={step.num}
                className="border-b border-line px-7 py-[30px] last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0"
              >
                <div className="mb-[18px] font-mono text-[12px] text-accent">
                  {t(m, step.num)}
                </div>
                <h3 className="mb-[9px] text-[19px] font-semibold">
                  {t(m, step.title)}
                </h3>
                <p className="text-[14.5px] text-muted">{t(m, step.body)}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
