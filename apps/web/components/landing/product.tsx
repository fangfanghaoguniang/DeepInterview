import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";

/**
 * 风格 A 定稿：4 条功能卡（连续追问 / 七维评分 / 短板变计划 / 数据主权）。
 *
 * 上一版是 3 大 FeatureRow（LanguagesVisual / PlanVisual / LoopVisual 各带一张视觉），
 * 排版沉重、叙事发散；按稿收窄到 4 列图标卡，一眼扫完。`components/landing/feature-row.tsx`
 * 与 `landing.product.*` 一整套旧 i18n 键仍保留在仓库，只是本组件不再引用；
 * 后续若确认不再走该结构再统一清理。
 */
const FEATURES = [
  { icon: "🎙", title: "landing.product.feat1Title", body: "landing.product.feat1Body" },
  { icon: "📊", title: "landing.product.feat2Title", body: "landing.product.feat2Body" },
  { icon: "🗂", title: "landing.product.feat3Title", body: "landing.product.feat3Body" },
  { icon: "🔒", title: "landing.product.feat4Title", body: "landing.product.feat4Body" },
] as const;

export async function Product() {
  const m = await getServerMessages();
  return (
    <section id="product" className="scroll-mt-24 py-16">
      <Container>
        <Reveal className="mb-9">
          <h2 className="serif text-[30px] text-ink min-[920px]:text-[34px]">
            {t(m, "landing.product.title")}
          </h2>
        </Reveal>
        <Reveal>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-accent-soft text-[20px] text-accent-strong">
                  <span aria-hidden>{f.icon}</span>
                </div>
                <h3 className="mb-1.5 text-[15.5px] font-semibold text-ink">
                  {t(m, f.title)}
                </h3>
                <p className="text-[13.5px] leading-relaxed text-muted">
                  {t(m, f.body)}
                </p>
              </div>
            ))}
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
