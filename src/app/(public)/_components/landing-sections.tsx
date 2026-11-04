import {
  Armchair,
  ArrowRight,
  Building2,
  CircleCheck,
  CircleHelp,
  DatabaseZap,
  Droplets,
  GraduationCap,
  History,
  LayoutDashboard,
  Lock,
  Monitor,
  Route,
  ShieldCheck,
  SprayCan,
  UserRoundSearch,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { ButtonLink, buttonIcon } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import {
  CATEGORY_LABELS,
  COMPLAINT_CATEGORIES,
  type ComplaintCategory,
} from "@/features/complaints/categories";
import { PriorityBadge } from "@/features/complaints/components/ticket-parts";
import { StatusBadge } from "@/features/complaints/components/status-badge";
import type { TicketPriority, TicketState } from "@/features/complaints/statuses";

import { TicketPreview } from "./ticket-preview";

const REPORT_HREF = "/student/complaints/new";

function SectionHeading({
  id,
  title,
  children,
  className,
}: {
  readonly id: string;
  readonly title: string;
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={className}>
      <h2
        id={id}
        className="text-[1.75rem] leading-tight font-semibold tracking-tight text-balance text-ink sm:text-3xl"
      >
        {title}
      </h2>
      {children === undefined ? null : (
        <p className="mt-3 max-w-xl text-pretty text-ink-muted">{children}</p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Hero
 * ------------------------------------------------------------------------------------------- */

const HERO_FACTS: readonly { icon: LucideIcon; text: string }[] = [
  { icon: DatabaseZap, text: "Saved before any AI runs" },
  { icon: Lock, text: "Only you and the department see it" },
  { icon: History, text: "Every step on the timeline" },
];

export function Hero() {
  return (
    <section
      aria-labelledby="hero-title"
      className="border-b border-line lg:flex lg:min-h-[calc(100svh-var(--public-chrome))] lg:flex-col lg:justify-center"
    >
      <Container className="grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:gap-16 lg:py-8">
        <div>
          {/* An editorial label: brand text led by a short rule, no pill or dot. */}
          <p className="flex animate-rise items-center gap-3 text-sm font-semibold tracking-wide text-brand">
            <span aria-hidden="true" className="h-0.5 w-8 rounded-full bg-brand" />
            Campus maintenance, from report to fix
          </p>
          <h1
            id="hero-title"
            className="mt-6 animate-rise text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.025em] text-balance text-ink [animation-delay:70ms] sm:text-5xl lg:text-[3.5rem]"
          >
            A better way to get campus problems fixed.
          </h1>
          <p className="mt-5 max-w-xl animate-rise text-lg text-pretty text-ink-muted [animation-delay:140ms]">
            Report a broken light, a leaking tap or a dead projector in a minute. MakeItRight sends
            it to the department that fixes it, and you can follow every step until it is done.
          </p>
          <div className="mt-8 flex animate-rise flex-wrap gap-3 [animation-delay:210ms]">
            <ButtonLink href={REPORT_HREF} size="lg">
              Report an issue
              <ArrowRight aria-hidden="true" className={buttonIcon} />
            </ButtonLink>
            <ButtonLink href="#how-it-works" variant="secondary" size="lg">
              See how it works
            </ButtonLink>
          </div>
          {/* On short laptop screens the hero drops these facts so it still fits one screen. */}
          <ul className="mt-10 flex animate-rise flex-col gap-3 text-sm text-ink-muted [animation-delay:280ms] sm:flex-row sm:flex-wrap sm:gap-x-6 lg:[@media(max-height:760px)]:hidden">
            {HERO_FACTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-2">
                <Icon aria-hidden="true" className="size-4 text-brand" strokeWidth={1.75} />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <div className="animate-rise [animation-delay:200ms]">
          <TicketPreview />
        </div>
      </Container>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------
 * What you can report
 * ------------------------------------------------------------------------------------------- */

const CATEGORY_DETAILS: Readonly<
  Record<ComplaintCategory, { icon: LucideIcon; examples: string }>
> = {
  electrical: { icon: Zap, examples: "Lights, sockets, fans and power cuts" },
  it_equipment: { icon: Monitor, examples: "Projectors, lab computers, printers and Wi-Fi" },
  plumbing: { icon: Droplets, examples: "Leaks, taps, coolers and blocked drains" },
  furniture: { icon: Armchair, examples: "Chairs, desks, doors and locks" },
  sanitation: { icon: SprayCan, examples: "Washrooms, bins and cleaning" },
  other: { icon: CircleHelp, examples: "Anything else that needs fixing" },
};

export function Categories() {
  return (
    <section
      aria-labelledby="categories-title"
      data-reveal
      className="py-20 sm:py-24 lg:flex lg:min-h-[calc(100svh-4rem)] lg:snap-start lg:flex-col lg:justify-center lg:py-12"
    >
      <Container className="grid gap-10 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:gap-16">
        <SectionHeading id="categories-title" title="What you can report">
          Six categories cover everyday faults in classrooms, labs, hostels and offices. Not sure
          which one fits? Describe the problem; the category is decided after you report it.
        </SectionHeading>
        <ul className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {COMPLAINT_CATEGORIES.map((category) => {
            const { icon: Icon, examples } = CATEGORY_DETAILS[category];
            return (
              <li key={category} className="bg-surface p-5">
                <Icon aria-hidden="true" className="size-5 text-brand" strokeWidth={1.75} />
                <p className="mt-3 font-medium text-ink">{CATEGORY_LABELS[category]}</p>
                <p className="mt-1 text-sm text-ink-muted">{examples}</p>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------
 * How it works
 * ------------------------------------------------------------------------------------------- */

interface Step {
  readonly title: string;
  readonly body: string;
  readonly states: readonly TicketState[];
}

const STEPS: readonly Step[] = [
  {
    title: "You report it",
    body: "Say what is wrong and where. The report is saved at once and gets a reference number.",
    states: ["submitted"],
  },
  {
    title: "It reaches the right team",
    body: "The AI assistant proposes a department and routing rules check it. Anything unclear or urgent goes to an administrator.",
    states: ["assigned", "needs_review"],
  },
  {
    title: "The department fixes it",
    body: "Staff acknowledge the ticket, record progress and mark it resolved with a note on what was done.",
    states: ["in_progress", "resolved"],
  },
  {
    title: "You confirm the fix",
    body: "Close it if it is fixed, or reopen it with a reason. Every step stays on the timeline.",
    states: ["closed", "reopened"],
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-title"
      data-reveal
      className="border-y border-line bg-surface py-20 sm:py-24 lg:flex lg:min-h-[calc(100svh-4rem)] lg:snap-start lg:flex-col lg:justify-center lg:py-12"
    >
      <Container>
        <SectionHeading id="how-title" title="How a report gets resolved">
          Four steps, the same for every ticket. The labels are the statuses you will see in the
          app.
        </SectionHeading>
        <ol className="relative mt-12 grid gap-10 lg:grid-cols-4 lg:gap-8">
          <span
            aria-hidden="true"
            className="absolute top-3.5 bottom-3.5 left-3.5 w-px bg-line lg:top-3.5 lg:right-0 lg:bottom-auto lg:left-0 lg:h-px lg:w-full"
          />
          {STEPS.map((step, index) => (
            <li key={step.title} className="relative pl-12 lg:pt-12 lg:pl-0">
              <span className="absolute top-0 left-0 flex size-7 items-center justify-center rounded-full border border-line-strong bg-surface font-mono text-xs font-medium text-ink">
                {index + 1}
              </span>
              <h3 className="font-semibold text-ink">{step.title}</h3>
              <p className="mt-2 text-sm text-pretty text-ink-muted">{step.body}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {step.states.map((state) => (
                  <StatusBadge key={state} status={state} />
                ))}
              </div>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Product preview
 * ------------------------------------------------------------------------------------------- */

interface QueueRow {
  readonly reference: string;
  readonly title: string;
  readonly place: string;
  readonly priority: TicketPriority;
  readonly status: TicketState;
  readonly age: string;
}

const QUEUE: readonly QueueRow[] = [
  {
    reference: "MIR-1031",
    title: "Socket sparks when a charger is plugged in",
    place: "Hostel A, room 112",
    priority: "high",
    status: "assigned",
    age: "12 min",
  },
  {
    reference: "MIR-1027",
    title: "Lights flicker at the back of Lab 3",
    place: "Engineering Block",
    priority: "medium",
    status: "in_progress",
    age: "3 h",
  },
  {
    reference: "MIR-1019",
    title: "Fan regulator only runs at full speed",
    place: "Main Library",
    priority: "low",
    status: "reopened",
    age: "1 d",
  },
];

const SUMMARY: readonly { label: string; value: string }[] = [
  { label: "Open tickets", value: "12" },
  { label: "Awaiting routing", value: "3" },
  { label: "Routed by AI", value: "68%" },
];

function StaffQueuePreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-soft">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="text-sm font-semibold text-ink">Electrical Maintenance</p>
        <p className="text-xs text-ink-subtle">Department queue · Most urgent first</p>
      </div>
      <ul className="divide-y divide-line">
        {QUEUE.map((row) => (
          <li key={row.reference} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-ink-subtle">{row.reference}</span>
                <span className="text-[11px] text-ink-subtle">· {row.age}</span>
              </div>
              <p className="mt-0.5 truncate text-sm font-medium text-ink">{row.title}</p>
              <p className="text-xs text-ink-muted">{row.place}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
              <PriorityBadge priority={row.priority} />
              <StatusBadge status={row.status} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AdminSummaryPreview() {
  return (
    <div className="grid grid-cols-3 divide-x divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-soft">
      {SUMMARY.map((item) => (
        <div key={item.label} className="px-4 py-3.5">
          <p className="text-xs text-ink-muted">{item.label}</p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-ink tabular-nums">
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

const PRODUCT_POINTS: readonly { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Building2,
    title: "A queue per department",
    body: "Staff see only their department's tickets, sorted by age or urgency, with new ones marked.",
  },
  {
    icon: LayoutDashboard,
    title: "One overview for administrators",
    body: "Open work, ageing tickets, department workload and how the AI routed reports, from live data.",
  },
];

export function ProductPreview() {
  return (
    <section
      aria-labelledby="product-title"
      data-reveal
      className="py-20 sm:py-24 lg:flex lg:min-h-[calc(100svh-4rem)] lg:snap-start lg:flex-col lg:justify-center lg:py-12"
    >
      <Container className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:gap-16">
        <div>
          <SectionHeading id="product-title" title="Built for the people who fix things">
            The same ticket a student reports becomes a clear task for the department and a number
            on the administrator&apos;s dashboard.
          </SectionHeading>
          <dl className="mt-8 space-y-6">
            {PRODUCT_POINTS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="relative pl-13">
                <dt className="font-medium text-ink">
                  <span className="absolute top-0 left-0 flex size-9 items-center justify-center rounded-lg border border-line bg-surface text-brand">
                    <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
                  </span>
                  {title}
                </dt>
                <dd className="mt-1 text-sm text-pretty text-ink-muted">{body}</dd>
              </div>
            ))}
          </dl>
        </div>
        <figure>
          <div aria-hidden="true" className="space-y-3 select-none">
            <StaffQueuePreview />
            <AdminSummaryPreview />
          </div>
          <figcaption className="mt-3 text-xs text-ink-subtle">
            Example data. The real queue and dashboard use the same components.
          </figcaption>
        </figure>
      </Container>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------
 * AI and safety
 * ------------------------------------------------------------------------------------------- */

const DECISION_FLOW = [
  "The AI model proposes a category, department and priority",
  "The server checks it against the approved routing rules",
  "The database checks the same rules again before writing",
  "Routine reports are routed; anything else goes to a person",
] as const;

const GUARANTEES: readonly { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: DatabaseZap,
    title: "Saved first, always",
    body: "Your report is stored before any AI runs. If the AI is slow or unavailable, nothing is lost.",
  },
  {
    icon: Route,
    title: "AI suggests, rules decide",
    body: "The AI can only choose a department that the routing rules already approve for that category.",
  },
  {
    icon: UserRoundSearch,
    title: "Unsure means a person reviews",
    body: "High-priority, safety-related or unclear reports always go to an administrator.",
  },
  {
    icon: History,
    title: "Every change is on record",
    body: "Each assignment and status change is added to a timeline that cannot be edited afterwards.",
  },
];

export function AiSafety() {
  return (
    <section
      id="ai-safety"
      aria-labelledby="ai-title"
      data-reveal
      className="border-y border-line bg-surface py-20 sm:py-24 lg:flex lg:min-h-[calc(100svh-4rem)] lg:snap-start lg:flex-col lg:justify-center lg:py-12"
    >
      <Container className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionHeading id="ai-title" title="AI that helps, without taking control">
            A Gemini model reads each report and proposes where it should go. It has three tools and
            no write access: it can look up a route, propose one, or ask for a human.
          </SectionHeading>
          <ol className="mt-8 space-y-3">
            {DECISION_FLOW.map((step, index) => (
              <li key={step} className="flex items-start gap-3 text-sm text-ink">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-soft font-mono text-xs font-medium text-brand-strong">
                  {index + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </div>
        <dl className="divide-y divide-line rounded-xl border border-line">
          {GUARANTEES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="relative p-5 pl-14">
              <dt className="font-medium text-ink">
                <Icon
                  aria-hidden="true"
                  className="absolute top-5.5 left-5 size-5 text-brand"
                  strokeWidth={1.75}
                />
                {title}
              </dt>
              <dd className="mt-1 text-sm text-pretty text-ink-muted">{body}</dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Roles
 * ------------------------------------------------------------------------------------------- */

const AUDIENCES: readonly { icon: LucideIcon; title: string; points: readonly string[] }[] = [
  {
    icon: GraduationCap,
    title: "Students",
    points: [
      "Report an issue in under a minute",
      "Follow its status and full history",
      "Confirm the fix, or reopen it",
    ],
  },
  {
    icon: Building2,
    title: "Department staff",
    points: [
      "Only the tickets assigned to your department",
      "Sort the queue by age or urgency",
      "Acknowledge, add work notes, resolve",
    ],
  },
  {
    icon: ShieldCheck,
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
      id="roles"
      aria-labelledby="roles-title"
      data-reveal
      className="py-20 sm:py-24 lg:flex lg:min-h-[calc(100svh-4rem)] lg:snap-start lg:flex-col lg:justify-center lg:py-12"
    >
      <Container>
        <SectionHeading id="roles-title" title="One platform, three clear roles">
          Each person sees exactly what their role allows, and the database enforces it, not just
          the screen.
        </SectionHeading>
        <div className="mt-10 grid divide-y divide-line rounded-xl border border-line bg-surface lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          {AUDIENCES.map(({ icon: Icon, title, points }) => (
            <div key={title} className="p-6">
              <div className="flex items-center gap-2.5">
                <Icon aria-hidden="true" className="size-5 text-brand" strokeWidth={1.75} />
                <h3 className="font-semibold text-ink">{title}</h3>
              </div>
              <ul className="mt-4 space-y-2.5">
                {points.map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-sm text-ink-muted">
                    <CircleCheck
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-success"
                      strokeWidth={1.75}
                    />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Final call to action
 * ------------------------------------------------------------------------------------------- */

export function FinalCallToAction() {
  return (
    <section aria-labelledby="cta-title" data-reveal className="pb-20 sm:pb-24">
      <Container>
        <div className="flex flex-col gap-6 rounded-xl border border-line bg-surface p-8 sm:p-10 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 id="cta-title" className="text-2xl font-semibold tracking-tight text-ink">
              Spotted something broken on campus?
            </h2>
            <p className="mt-2 max-w-xl text-pretty text-ink-muted">
              Sign in with your student account and report it. You can follow every step from your
              dashboard.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href={REPORT_HREF} size="lg">
              Report an issue
              <ArrowRight aria-hidden="true" className={buttonIcon} />
            </ButtonLink>
            <ButtonLink href="/signup" variant="secondary" size="lg">
              Create an account
            </ButtonLink>
          </div>
        </div>
      </Container>
    </section>
  );
}
