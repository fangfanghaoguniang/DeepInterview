import { Container } from "@/components/ui/container";
import { GITHUB_URL } from "@/lib/site";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";

export async function AnnouncementBar() {
  const m = await getServerMessages();
  return (
    <div className="border-b border-line bg-panel">
      <Container className="flex h-[38px] items-center justify-center gap-2.5 text-[13px] text-muted">
        <span
          aria-hidden="true"
          className="inline-block h-[5px] w-[5px] rounded-full bg-accent"
        />
        <b className="font-semibold text-ink">
          {t(m, "landing.announceTag")}
        </b>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="text-muted hover:text-ink"
        >
          {t(m, "landing.announceStar")}
        </a>
      </Container>
    </div>
  );
}
