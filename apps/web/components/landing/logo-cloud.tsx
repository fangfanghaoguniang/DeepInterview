import { Container } from "@/components/ui/container";
import { t } from "@/lib/i18n";
import { getServerMessages } from "@/lib/i18n/server";

const COMPANIES = [
  "Google",
  "Amazon",
  "Stripe",
  "Grab",
  "Atlassian",
  "Datadog",
];

export async function LogoCloud() {
  const m = await getServerMessages();
  return (
    <div className="border-b border-line py-[34px]">
      <Container>
        <p className="mb-[18px] text-center font-mono text-[12.5px] uppercase tracking-[0.06em] text-faint">
          {t(m, "landing.logoLine")}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-[46px] gap-y-4">
          {COMPANIES.map((name) => (
            <span
              key={name}
              className="text-lg font-semibold tracking-[-0.01em] text-[#B9B6AE]"
            >
              {name}
            </span>
          ))}
        </div>
      </Container>
    </div>
  );
}
