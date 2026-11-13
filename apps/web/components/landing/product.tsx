import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { FeatureRow } from "@/components/landing/feature-row";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";

// Language names stay in their own script — they are the translation.
const LANGUAGES = [
  { label: "中文", active: true },
  { label: "English" },
];

const PLAN_ROWS: { labelKey: string; tagKey: string; strong: boolean }[] = [
  { labelKey: "landing.product.plan1", tagKey: "landing.product.tagProbe", strong: true },
  { labelKey: "landing.product.plan2", tagKey: "landing.product.tagGap", strong: true },
  { labelKey: "landing.product.plan3", tagKey: "landing.product.tagCore", strong: false },
  { labelKey: "landing.product.plan4", tagKey: "landing.product.tagCore", strong: false },
  { labelKey: "landing.product.plan5", tagKey: "landing.product.tagWarm", strong: false },
];

const LOOP_STEPS = [
  { badge: "1", labelKey: "landing.product.loop1" },
  { badge: "2", labelKey: "landing.product.loop2" },
  { badge: "3", labelKey: "landing.product.loop3" },
  { badge: "4", labelKey: "landing.product.loop4" },
  { badge: "↻", labelKey: "landing.product.loop5" },
];

async function LanguagesVisual() {
  const m = await getServerMessages();
  return (
    <div>
      <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.06em] text-faint">
        {t(m, "landing.product.langLabel")}
      </div>
      <div className="flex flex-wrap gap-2">
        {LANGUAGES.map((lang) => (
          <span
            key={lang.label}
            className={
              lang.active
                ? "rounded-lg border border-ink px-[11px] py-1.5 text-[13px] font-medium text-ink"
                : "rounded-lg border border-line bg-[#FCFBF9] px-[11px] py-1.5 text-[13px] text-ink-soft"
            }
          >
            {lang.label}
          </span>
        ))}
        <span className="rounded-lg border border-line bg-[#FCFBF9] px-[11px] py-1.5 text-[13px] text-ink-soft">
          {t(m, "landing.product.langMore")}
        </span>
      </div>
      <div className="mt-[18px] text-[13.5px] text-muted">
        {t(m, "landing.product.langNote")}
      </div>
    </div>
  );
}

async function PlanVisual() {
  const m = await getServerMessages();
  return (
    <div>
      <div className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-faint">
        {t(m, "landing.product.planLabel")}
      </div>
      {PLAN_ROWS.map((row) => (
        <div
          key={row.labelKey}
          className="flex justify-between border-b border-dashed border-line-2 py-2.5 text-[13.5px] last:border-b-0"
        >
          <span>{t(m, row.labelKey)}</span>
          <span className={row.strong ? "font-semibold text-ok" : "text-muted"}>
            {t(m, row.tagKey)}
          </span>
        </div>
      ))}
    </div>
  );
}

async function LoopVisual() {
  const m = await getServerMessages();
  return (
    <div className="flex flex-col gap-2.5">
      {LOOP_STEPS.map((step) => (
        <div
          key={step.badge}
          className="flex items-center gap-[11px] text-[13.5px] text-ink-soft"
        >
          <span className="grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-line font-mono text-[11px] text-accent">
            {step.badge}
          </span>
          {t(m, step.labelKey)}
        </div>
      ))}
    </div>
  );
}

export async function Product() {
  const m = await getServerMessages();
  return (
    <section id="product" className="scroll-mt-24 py-[84px] pt-0">
      <Container>
        <Reveal className="mb-12 max-w-[680px]">
          <Eyebrow>{t(m, "landing.product.eyebrow")}</Eyebrow>
          <h2 className="serif my-3.5 text-[38px]">
            {t(m, "landing.product.title")}
          </h2>
        </Reveal>

        <FeatureRow
          first
          eyebrow={t(m, "landing.product.f1eyebrow")}
          title={t(m, "landing.product.f1title")}
          body={t(m, "landing.product.f1body")}
          bullets={[
            t(m, "landing.product.f1b1"),
            t(m, "landing.product.f1b2"),
            t(m, "landing.product.f1b3"),
          ]}
          visual={<LanguagesVisual />}
        />

        <FeatureRow
          flip
          eyebrow={t(m, "landing.product.f2eyebrow")}
          title={t(m, "landing.product.f2title")}
          body={t(m, "landing.product.f2body")}
          bullets={[
            t(m, "landing.product.f2b1"),
            t(m, "landing.product.f2b2"),
            t(m, "landing.product.f2b3"),
          ]}
          visual={<PlanVisual />}
        />

        <FeatureRow
          eyebrow={t(m, "landing.product.f3eyebrow")}
          title={t(m, "landing.product.f3title")}
          body={t(m, "landing.product.f3body")}
          bullets={[
            t(m, "landing.product.f3b1"),
            t(m, "landing.product.f3b2"),
            t(m, "landing.product.f3b3"),
          ]}
          visual={<LoopVisual />}
        />
      </Container>
    </section>
  );
}
