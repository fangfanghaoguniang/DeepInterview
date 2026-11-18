import Link from "next/link";
import { features } from "@deepinterview/ee";
import { Container } from "@/components/ui/container";
import { buttonClasses } from "@/components/ui/button";
import { MobileMenu } from "@/components/landing/mobile-menu";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";

/** Anchor links with dictionary keys; labels resolve per locale in `Nav`. */
export const NAV_LINKS = [
  { href: "#how", key: "landing.navHow" },
  { href: "#product", key: "landing.navProduct" },
  { href: "#faq", key: "landing.navFaq" },
] as const;

export async function Nav() {
  const m = await getServerMessages();
  const links = NAV_LINKS.map((link) => ({
    href: link.href,
    label: t(m, link.key),
  }));
  const signedInLinks = features.auth
    ? [...links, { href: "/login", label: t(m, "landing.navSignIn") }]
    : links;
  return (
    <nav className="sticky top-0 z-50 border-b border-line bg-paper/80 backdrop-blur-md">
      <Container className="flex h-[66px] items-center justify-between">
        <a href="#top" className="flex items-center gap-[9px]">
          {/* 风格 A 定稿：方块 DI 白字（brand-600 蓝）——与圆圈 Di 描边版本并存，
              后者仍用于 icon.svg / opengraph 等小尺寸场景。 */}
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-lg bg-accent-strong text-[13px] font-bold text-white"
          >
            DI
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.01em]">
            DeepInterview
          </span>
        </a>

        <div className="hidden gap-[30px] text-[14.5px] text-ink-soft min-[861px]:flex">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="hover:text-ink">
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3.5">
          {features.auth ? (
            <Link
              href="/login"
              className="hidden text-[14.5px] text-ink-soft hover:text-ink min-[861px]:inline"
            >
              {t(m, "landing.navSignIn")}
            </Link>
          ) : null}
          <Link href="/setup" className={buttonClasses({ variant: "brand" })}>
            {t(m, "landing.navStart")}
          </Link>
          <MobileMenu links={signedInLinks} />
        </div>
      </Container>
    </nav>
  );
}
