import {
  Armchair,
  ArrowRight,
  BadgeCheck,
  Building2,
  CircleHelp,
  ClipboardList,
  DatabaseZap,
  Droplets,
  GraduationCap,
  History,
  LayoutDashboard,
  Monitor,
  Route,
  ShieldCheck,
  SprayCan,
  UserCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { ButtonLink, buttonIconSlide } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import {
  CATEGORY_LABELS,
  COMPLAINT_CATEGORIES,
  type ComplaintCategory,
} from "@/features/complaints/categories";

import { TicketPreview } from "./ticket-preview";

/** Entrance delay for the hero's staggered fade-up sequence. */
function stagger(index: number): CSSProperties {
  return { animationDelay: `${index * 90}ms` };
}

function SectionHeading({
  id,
  eyebrow,
  title,
  children,
}: {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">{eyebrow}</p>
      <h2
        id={id}
        className="mt-3 text-3xl font-extrabold tracking-tight text-balance text-ink sm:text-4xl"
      >
        {title}
      </h2>
      {children === undefined ? null : (
        <p className="mt-4 text-base text-pretty text-ink-muted sm:text-lg">{children}</p>
      )}
    </div>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10 opacity-60" />
      <Container className="grid items-center gap-14 py-16 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:py-28">
        <div className="text-center lg:text-left">
          <p
            className="inline-flex animate-fade-up items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink-muted shadow-soft"
            style={stagger(0)}
          >
            <span className="size-1.5 rounded-full bg-accent" />
            AI Cloud-Based University Complaint System
          </p>
          <h1
            id="hero-title"
            className="mt-6 animate-fade-up text-4xl leading-[1.08] font-extrabold tracking-tight text-balance text-ink sm:text-5xl lg:text-6xl"
            style={stagger(1)}
          >
            Campus problems, reported once and <span className="text-brand">fixed right.</span>
          </h1>
          <p
            className="mx-auto mt-6 max-w-xl animate-fade-up text-lg text-pretty text-ink-muted lg:mx-0"
            style={stagger(2)}
          >
            Report a broken fan, a leaking tap or a dead projector in under a minute. MakeItRight
            sends it to the right department and keeps you updated until it is fixed.
          </p>
          <div
            className="mt-9 flex animate-fade-up flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start"
            style={stagger(3)}
          >
            <ButtonLink href="/login" size="lg" className="w-full sm:w-auto">
              Report an issue
              <ArrowRight aria-hidden="true" className={buttonIconSlide} />
            </ButtonLink>
            <ButtonLink
              href="#how-it-works"
              variant="secondary"
              size="lg"
              className="w-full sm:w-auto"
            >
              See how it works
            </ButtonLink>
          </div>
        </div>

        <TicketPreview />
      </Container>
    </section>
  );
}

const CATEGORY_ICONS: Readonly<Record<ComplaintCategory, LucideIcon>> = {
  electrical: Zap,
  it_equipment: Monitor,
  plumbing: Droplets,
  furniture: Armchair,
  sanitation: SprayCan,
  other: CircleHelp,
};

export function Categories() {
  return (
    <section aria-labelledby="categories-title" className="border-y border-line bg-surface">
      <Container className="py-10">
        <h2
          id="categories-title"
          className="text-center text-sm font-semibold tracking-wide text-ink-subtle uppercase"
        >
          What you can report
        </h2>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {COMPLAINT_CATEGORIES.map((category) => {
            const Icon = CATEGORY_ICONS[category];
            return (
              <li
                key={category}
                className="group flex items-center gap-3 rounded-xl border border-line bg-canvas px-4 py-3 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-soft"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-brand-strong transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
                  <Icon aria-hidden="true" className="size-4.5" />
                </span>
                <span className="text-sm font-semibold text-ink">{CATEGORY_LABELS[category]}</span>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}

interface Feature {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly body: string;
}

const STEPS: readonly Feature[] = [
  {
    icon: ClipboardList,
    title: "Report it",
    body: "Describe the problem, the building and the room. Your ticket gets a reference number straight away.",
  },
  {
    icon: Route,
    title: "It gets routed",
    body: "AI suggests a category and department. Routing rules check the suggestion, and unclear cases go to an admin.",
  },
  {
    icon: BadgeCheck,
    title: "It gets fixed",
    body: "The department updates progress as they work. You confirm the fix, or reopen it if it is not done right.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="py-20 sm:py-24">
      <Container>
        <SectionHeading
          id="how-title"
          eyebrow="How it works"
          title="From report to resolved in three steps"
        />
        <ol className="mt-14 grid gap-5 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="group relative rounded-2xl border border-line bg-surface p-7 shadow-soft transition-[transform,box-shadow,border-color] duration-300 ease-(--ease-out-soft) hover:-translate-y-1 hover:border-brand/40 hover:shadow-lift"
            >
              <span
                aria-hidden="true"
                className="absolute top-6 right-6 font-mono text-sm font-semibold text-ink-subtle transition-colors duration-300 group-hover:text-brand"
              >
                0{index + 1}
              </span>
              <span className="flex size-12 items-center justify-center rounded-xl bg-brand text-brand-fg shadow-soft transition-transform duration-300 group-hover:scale-105">
                <step.icon aria-hidden="true" className="size-5.5" />
              </span>
              <h3 className="mt-6 text-lg font-bold text-ink">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

interface Audience {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly points: readonly string[];
}

const AUDIENCES: readonly Audience[] = [
  {
    icon: GraduationCap,
    title: "Students",
    points: [
      "Submit a ticket in under a minute",
      "Only you can see your tickets",
      "Confirm the fix, or reopen it",
    ],
  },
  {
    icon: Building2,
    title: "Department staff",
    points: [
      "Only the tickets assigned to your department",
      "Sort the queue by age and priority",
      "Acknowledge, add work notes, resolve",
    ],
  },
  {
    icon: LayoutDashboard,
    title: "Administrators",
    points: [
      "See every ticket and how long it has waited",
      "Review and correct AI routing",
      "Manage departments and routing rules",
    ],
  },
];

export function Audiences() {
  return (
    <section
      id="who-its-for"
      aria-labelledby="audience-title"
      className="border-y border-line bg-surface py-20 sm:py-24"
    >
      <Container>
        <SectionHeading
          id="audience-title"
          eyebrow="Who it’s for"
          title="One platform, three clear roles"
        >
          Each person sees exactly what their role allows, and the database enforces it, not just
          the screen.
        </SectionHeading>
        <ul className="mt-14 grid gap-5 md:grid-cols-3">
          {AUDIENCES.map((audience) => (
            <li
              key={audience.title}
              className="group rounded-2xl border border-line bg-canvas p-7 transition-[transform,box-shadow,border-color,background-color] duration-300 ease-(--ease-out-soft) hover:-translate-y-1 hover:border-brand/40 hover:bg-surface hover:shadow-lift"
            >
              <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent-ink transition-transform duration-300 group-hover:-rotate-6">
                <audience.icon aria-hidden="true" className="size-5" />
              </span>
              <h3 className="mt-5 text-lg font-bold text-ink">{audience.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {audience.points.map((point) => (
                  <li key={point} className="flex gap-2.5 text-sm text-ink-muted">
                    <BadgeCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
                    {point}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

const GUARANTEES: readonly Feature[] = [
  {
    icon: DatabaseZap,
    title: "Saved first, always",
    body: "Your ticket is stored before any AI runs. If the AI is slow or down, nothing is lost.",
  },
  {
    icon: ShieldCheck,
    title: "AI suggests, rules decide",
    body: "The AI can only pick from approved categories and departments. Anything else is rejected.",
  },
  {
    icon: UserCheck,
    title: "Unsure means a person reviews",
    body: "Uncertain or urgent-sounding reports go to an admin instead of being routed automatically.",
  },
  {
    icon: History,
    title: "Every change is on record",
    body: "Each status change and assignment is added to a timeline that cannot be edited afterwards.",
  },
];

export function AiSafety() {
  return (
    <section id="ai-safety" aria-labelledby="ai-title" className="py-20 sm:py-24">
      <Container>
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-band px-6 py-14 text-band-fg sm:px-12 sm:py-16">
          <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-brand/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-24 size-72 rounded-full bg-accent/15 blur-3xl" />

          <div className="relative max-w-2xl">
            <p className="text-sm font-semibold tracking-wide text-accent uppercase">
              AI &amp; safety
            </p>
            <h2
              id="ai-title"
              className="mt-3 text-3xl font-extrabold tracking-tight text-balance sm:text-4xl"
            >
              AI that helps, without taking control
            </h2>
            <p className="mt-4 text-base text-pretty text-band-muted sm:text-lg">
              The AI assistant has a small, fixed set of actions, and every action is checked before
              it changes anything.
            </p>
          </div>

          <ul className="relative mt-12 grid gap-4 sm:grid-cols-2">
            {GUARANTEES.map((item) => (
              <li
                key={item.title}
                className="group flex gap-4 rounded-2xl border border-white/10 bg-white/5 p-5 transition-[background-color,border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-fg transition-transform duration-300 group-hover:scale-110">
                  <item.icon aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <h3 className="font-bold">{item.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-band-muted">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}

export function FinalCallToAction() {
  return (
    <section aria-labelledby="cta-title" className="pb-24">
      <Container>
        <div className="flex flex-col items-center gap-6 rounded-3xl border border-line bg-surface px-6 py-14 text-center shadow-soft sm:px-12">
          <h2
            id="cta-title"
            className="max-w-xl text-3xl font-extrabold tracking-tight text-balance text-ink sm:text-4xl"
          >
            Spotted something broken on campus?
          </h2>
          <p className="max-w-lg text-pretty text-ink-muted">
            Sign in and report it in under a minute. You can follow every step from your dashboard.
          </p>
          <ButtonLink href="/login" size="lg">
            Report an issue
            <ArrowRight aria-hidden="true" className={buttonIconSlide} />
          </ButtonLink>
        </div>
      </Container>
    </section>
  );
}
