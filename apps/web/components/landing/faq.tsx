import { Plus } from "lucide-react";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Reveal } from "@/components/ui/reveal";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";

const ITEMS = [
  { q: "landing.faq.q1", a: "landing.faq.a1" },
  { q: "landing.faq.q2", a: "landing.faq.a2" },
  { q: "landing.faq.q3", a: "landing.faq.a3" },
] as const;

export async function Faq() {
  const m = await getServerMessages();
  return (
    <section id="faq" className="scroll-mt-24 border-t border-line py-[84px]">
      <Container>
        <Reveal className="mb-8 max-w-[680px]">
          <Eyebrow>{t(m, "landing.faq.eyebrow")}</Eyebrow>
          <h2 className="serif mt-3.5 text-[38px]">{t(m, "landing.faq.title")}</h2>
        </Reveal>
        {ITEMS.map((item) => (
          <details key={item.q} className="group border-b border-line py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between text-[17px] font-medium [&::-webkit-details-marker]:hidden">
              {t(m, item.q)}
              <Plus
                size={18}
                className="text-faint transition-transform duration-200 group-open:rotate-45"
              />
            </summary>
            <p className="mt-3 max-w-[760px] text-[15px] text-ink-soft">
              {t(m, item.a)}
            </p>
          </details>
        ))}
      </Container>
    </section>
  );
}
