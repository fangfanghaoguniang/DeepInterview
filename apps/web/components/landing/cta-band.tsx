import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { buttonClasses } from "@/components/ui/button";
import { GITHUB_URL } from "@/lib/site";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";

export async function CtaBand() {
  const m = await getServerMessages();
  return (
    <section className="pb-[84px]">
      <Container>
        <Reveal>
          <div className="rounded-[18px] border border-line bg-panel p-[54px] text-center">
            <Eyebrow>{t(m, "landing.cta.eyebrow")}</Eyebrow>
            <h2 className="serif mt-3 mb-3.5 text-[38px]">
              {t(m, "landing.cta.title")}
            </h2>
            <p className="mb-[26px] text-[17px] text-ink-soft">
              {t(m, "landing.cta.body")}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/setup" className={buttonClasses()}>
                {t(m, "landing.cta.start")}
              </Link>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className={buttonClasses({ variant: "out" })}
              >
                {t(m, "landing.cta.github")}
              </a>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
