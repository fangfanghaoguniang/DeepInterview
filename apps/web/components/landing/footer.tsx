import { Container } from "@/components/ui/container";
import { BrandMark } from "@/components/ui/brand-mark";
import { GITHUB_URL, DOCS_URL } from "@/lib/site";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";

type FooterLink = { href: string; label: string; external?: boolean };

function FooterCol({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <h4 className="mb-3.5 font-mono text-[12px] uppercase tracking-[0.08em] text-faint">
        {title}
      </h4>
      {links.map((link) =>
        link.external ? (
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="mb-2.5 block text-sm text-ink-soft hover:text-ink"
          >
            {link.label}
          </a>
        ) : (
          <a
            key={link.label}
            href={link.href}
            className="mb-2.5 block text-sm text-ink-soft hover:text-ink"
          >
            {link.label}
          </a>
        ),
      )}
    </div>
  );
}

/** Hrefs stay static; labels resolve from these dictionary keys per locale. */
const PRODUCT_LINKS: { href: string; key: string }[] = [
  { href: "#how", key: "landing.foot.how" },
  { href: "#product", key: "landing.foot.features" },
  { href: "#faq", key: "landing.foot.faq" },
];

const DEVELOPER_LINKS: { href: string; key: string; external?: boolean }[] = [
  { href: GITHUB_URL, key: "landing.foot.github", external: true },
  { href: DOCS_URL, key: "landing.foot.docs", external: true },
  { href: DOCS_URL, key: "landing.foot.selfhost", external: true },
  { href: GITHUB_URL, key: "landing.foot.packs", external: true },
];

const COMMUNITY_LINKS: { href: string; key: string; external?: boolean }[] = [
  { href: `${GITHUB_URL}/discussions`, key: "landing.foot.discussions", external: true },
  { href: `${GITHUB_URL}/issues`, key: "landing.foot.issues", external: true },
  { href: GITHUB_URL, key: "landing.foot.contributing", external: true },
];

export async function Footer() {
  const m = await getServerMessages();
  const withLabels = (links: { href: string; key: string; external?: boolean }[]) =>
    links.map((l) => ({ ...l, label: t(m, l.key) }));
  return (
    <footer className="mt-[30px] border-t border-line pt-[54px] pb-10">
      <Container>
        <div className="mb-9 grid grid-cols-2 gap-[30px] md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <div className="mb-3 flex items-center gap-[9px]">
              <BrandMark size={22} />
              <span className="text-[17px] font-semibold tracking-[-0.01em]">
                DeepInterview
              </span>
            </div>
            <p className="max-w-[280px] text-sm text-muted">
              {t(m, "landing.foot.tagline")}
            </p>
          </div>
          <FooterCol title={t(m, "landing.foot.product")} links={withLabels(PRODUCT_LINKS)} />
          <FooterCol title={t(m, "landing.foot.developers")} links={withLabels(DEVELOPER_LINKS)} />
          <FooterCol title={t(m, "landing.foot.community")} links={withLabels(COMMUNITY_LINKS)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-line pt-[22px] text-[13px] text-faint">
          <span>{t(m, "landing.foot.copy")}</span>
          <span className="font-mono">{t(m, "landing.foot.built")}</span>
        </div>
      </Container>
    </footer>
  );
}
