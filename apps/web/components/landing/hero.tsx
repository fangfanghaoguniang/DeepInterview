import Link from "next/link";
import { Check, ArrowUpRight } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { buttonClasses } from "@/components/ui/button";
import { HeroMock } from "@/components/landing/hero-mock";
import { GITHUB_URL } from "@/lib/site";
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
            {t(m, "landing.hero.titleLead")}{" "}
            <em className="italic text-accent">
              {t(m, "landing.hero.titleAccent")}
            </em>
            <br />
            {t(m, "landing.hero.titleTail")}
          </h1>
          <p className="mb-7 max-w-[520px] text-lg text-ink-soft">
            {t(m, "landing.hero.subtitle")}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/setup" className={buttonClasses()}>
              {t(m, "landing.hero.start")}
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className={buttonClasses({ variant: "out" })}
            >
              {t(m, "landing.hero.github")} <ArrowUpRight size={16} />
            </a>
          </div>
          <div className="mt-[18px] flex flex-wrap gap-3.5 text-[13px] text-faint">
            <span className="flex items-center gap-1.5">
              <Check size={14} className="text-ok" /> {t(m, "landing.hero.checkCard")}
            </span>
            <span className="flex items-center gap-1.5">
              <Check size={14} className="text-ok" /> {t(m, "landing.hero.checkKeys")}
            </span>
            <span className="flex items-center gap-1.5">
              <Check size={14} className="text-ok" /> {t(m, "landing.hero.checkLicense")}
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
