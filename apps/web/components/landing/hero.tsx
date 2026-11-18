import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { buttonClasses } from "@/components/ui/button";
import { HeroMock } from "@/components/landing/hero-mock";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";

export async function Hero() {
  const m = await getServerMessages();
  return (
    <header id="top" className="border-b border-line">
      <Container className="grid items-center gap-11 pt-[84px] pb-16 min-[920px]:grid-cols-[1.04fr_0.96fr] min-[920px]:gap-14">
        <div>
          <Eyebrow>{t(m, "landing.hero.eyebrow")}</Eyebrow>
          <h1 className="serif mt-[18px] mb-[22px] text-[44px] text-ink min-[920px]:text-[60px]">
            {t(m, "landing.hero.titleLead")}
            <br />
            {t(m, "landing.hero.titleTail")}
          </h1>
          <p className="mb-7 max-w-[520px] text-lg text-ink-soft">
            {t(m, "landing.hero.subtitle")}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/setup"
              className={buttonClasses({ variant: "brand", size: "lg" })}
            >
              {t(m, "landing.hero.start")}
            </Link>
            <a
              href="#product"
              className={buttonClasses({ variant: "out", size: "lg" })}
            >
              {t(m, "landing.hero.sampleReport")} <ArrowUpRight size={16} />
            </a>
          </div>
          {/* 风格 A 定稿：数字统计条（技能包 / 评分维度 / 双语）——与上一版
              的“无需信用卡 / 数据自持 / 自带 Key”三勾选同位替换，信息量更高。 */}
          <div className="mt-[26px] flex flex-wrap items-center gap-6 text-[13.5px] text-muted">
            <span>
              <span className="mr-1.5 font-serif text-[22px] font-semibold text-ink">
                32
              </span>
              {t(m, "landing.hero.statPacks")}
            </span>
            <span aria-hidden className="h-4 w-px bg-line" />
            <span>
              <span className="mr-1.5 font-serif text-[22px] font-semibold text-ink">
                7
              </span>
              {t(m, "landing.hero.statDims")}
            </span>
            <span aria-hidden className="h-4 w-px bg-line" />
            <span>
              <span className="mr-1.5 font-serif text-[22px] font-semibold text-ink">
                {t(m, "landing.hero.statLangsValue")}
              </span>
              {t(m, "landing.hero.statLangs")}
            </span>
          </div>
        </div>

        <Reveal>
          <HeroMock />
        </Reveal>
      </Container>
    </header>
  );
}
