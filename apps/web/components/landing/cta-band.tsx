import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Reveal } from "@/components/ui/reveal";
import { buttonClasses } from "@/components/ui/button";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";

export async function CtaBand() {
  const m = await getServerMessages();
  return (
    <section className="pb-20">
      <Container>
        <Reveal>
          {/* 风格 A 定稿：不再挂 Eyebrow“随时可以开始”，标题直接顶到卡片上方；
              主按钮从 ink 黑换为 brand-600 蓝，与导航栏/hero 主 CTA 统一。 */}
          <div className="mx-auto max-w-4xl rounded-2xl border border-line bg-panel p-12 text-center shadow-[0_1px_2px_rgba(28,27,26,0.05),0_8px_24px_rgba(28,27,26,0.06)]">
            <h2 className="serif mb-3 text-[30px] leading-tight text-ink min-[920px]:text-[34px]">
              {t(m, "landing.cta.title")}
            </h2>
            <p className="mb-8 text-[15.5px] text-muted">
              {t(m, "landing.cta.body")}
            </p>
            <Link
              href="/setup"
              className={buttonClasses({ variant: "brand", size: "lg" })}
            >
              {t(m, "landing.cta.start")}
            </Link>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
