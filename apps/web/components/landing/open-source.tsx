import { Star } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { buttonClasses } from "@/components/ui/button";
import { GITHUB_URL, DOCS_URL } from "@/lib/site";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";

export async function OpenSource() {
  const m = await getServerMessages();
  return (
    <section id="oss" className="scroll-mt-24 border-t border-line py-[84px]">
      <Container className="grid items-center gap-[54px] md:grid-cols-2">
        <Reveal>
          <Eyebrow>{t(m, "landing.oss.eyebrow")}</Eyebrow>
          <h2 className="serif my-3.5 text-[36px]">
            {t(m, "landing.oss.title")}
          </h2>
          <p className="mb-[22px] text-base text-muted">
            {t(m, "landing.oss.body")}
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className={buttonClasses()}
            >
              <Star size={16} /> {t(m, "landing.oss.star")}
            </a>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className={buttonClasses({ variant: "out" })}
            >
              {t(m, "landing.oss.docs")}
            </a>
          </div>
        </Reveal>

        <Reveal>
          <div className="overflow-hidden rounded-[13px] border border-[#26262B] bg-[#161619] shadow-[0_24px_50px_-30px_rgba(0,0,0,0.5)]">
            <div className="flex gap-[7px] border-b border-[#26262B] px-3.5 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-[#34343A]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#34343A]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#34343A]" />
            </div>
            <pre className="overflow-x-auto p-[18px] font-mono text-[13px] leading-[1.7] text-[#D6D4DE]">
              <span className="text-[#6B6B72]">
                {t(m, "landing.oss.termComment")}
              </span>
              {"\n"}
              <span className="text-[#7C84F2]">$</span> git clone
              github.com/ngoanpv/DeepInterview{"\n"}
              <span className="text-[#7C84F2]">$</span> cd DeepInterview{"\n"}
              <span className="text-[#7C84F2]">$</span> docker compose up{"\n"}
              <span className="text-[#5BBF8B]">
                {t(m, "landing.oss.termWeb")}
              </span>
              {"\n"}
              <span className="text-[#5BBF8B]">
                {t(m, "landing.oss.termAgent")}
              </span>
              {"\n"}
              <span className="text-[#5BBF8B]">
                {t(m, "landing.oss.termReady")}
              </span>
            </pre>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
