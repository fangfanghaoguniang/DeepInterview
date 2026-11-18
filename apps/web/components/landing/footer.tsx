import { Container } from "@/components/ui/container";
import { GITHUB_URL } from "@/lib/site";
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

const USE_LINKS: { href: string; key: string }[] = [
  { href: "/signup", key: "landing.foot.signup" },
  { href: "/login", key: "landing.foot.login" },
  { href: "/setup", key: "landing.foot.setup" },
];

const ABOUT_LINKS: { href: string; key: string }[] = [
  // 风格 A 定稿：关于列先开一个“隐私与数据”占位（真实路由尚未存在，暂指回页面顶部）；
  // 与上一版只有静默致谢不同，提供可见的数据主权入口。
  { href: "#top", key: "landing.foot.privacy" },
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
              {/* 风格 A 定稿：方块 DI 白字（brand-600 蓝），与导航栏同款。 */}
              <span
                aria-hidden
                className="grid h-7 w-7 place-items-center rounded-lg bg-accent-strong text-[11px] font-bold text-white"
              >
                DI
              </span>
              <span className="text-[17px] font-semibold tracking-[-0.01em]">
                DeepInterview
              </span>
            </div>
            <p className="max-w-[280px] text-sm text-muted">
              {t(m, "landing.foot.tagline")}
            </p>
          </div>
          <FooterCol title={t(m, "landing.foot.product")} links={withLabels(PRODUCT_LINKS)} />
          <FooterCol title={t(m, "landing.foot.use")} links={withLabels(USE_LINKS)} />
          <div>
            <h4 className="mb-3.5 font-mono text-[12px] uppercase tracking-[0.08em] text-faint">
              {t(m, "landing.foot.about")}
            </h4>
            {withLabels(ABOUT_LINKS).map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="mb-2.5 block text-sm text-ink-soft hover:text-ink"
              >
                {link.label}
              </a>
            ))}
            {/* Silent upstream credit — Apache-2.0 attribution, non-promotional. */}
            <p className="mt-3 text-[13px] leading-relaxed text-faint">
              {t(m, "landing.foot.attributionLead")}{" "}
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-line underline-offset-2 hover:text-ink"
              >
                DeepInterview
              </a>{" "}
              {t(m, "landing.foot.attributionTail")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-line pt-[22px] text-[13px] text-faint">
          <span>{t(m, "landing.foot.copy")}</span>
          <span className="font-mono">{t(m, "landing.foot.built")}</span>
        </div>
      </Container>
    </footer>
  );
}
