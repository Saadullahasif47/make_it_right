import type { ComplaintCategory } from "@/features/complaints/categories";

/**
 * Deterministic fallback classifier (ADR 0005, amendment 2): when the AI attempt cannot route a
 * report for a reason that is not about the report itself (the provider is down, slow or rate
 * limited, the model's answer was unusable, or it asked for a person), a report that clearly
 * names one kind of fault is still routed to that category's approved department.
 *
 * Deliberately conservative: a category needs a clear lead over every other, so a report that
 * mentions two kinds of fault, or none, still goes to a person. It never decides priority beyond
 * "medium", and it never runs for reports the safety screen flagged (triage.ts). Tuned and
 * measured on the labelled evaluation set (tests/unit/features/agent/keyword-router.test.ts).
 */
const KEYWORDS: Readonly<Record<ComplaintCategory, readonly RegExp[]>> = {
  electrical: [
    /\b(lights?|lites?|lighting|bulbs?|tube ?lights?|lamps?)\b/i,
    /\b(ceiling )?fans?\b/i,
    /\b(sockets?|plugs?|switch(es|board)?|power (cut|outage|failure)|no (power|electricity)|electricity)\b/i,
    /\b(fuses?|breakers?|wiring)\b/i,
    /\b(air ?conditioners?|aircon|hand ?dryers?|dryers?)\b/i,
  ],
  it_equipment: [
    /\b(projectors?|smart ?boards?|document cameras?|webcams?)\b/i,
    /\b(computers?|pcs?|desktops?|laptops?|monitors?|keyboards?)\b/i,
    /\b(printers?|scanners?)\b/i,
    /\b(wi-?fi|internet|network|router|lan|ethernet)\b/i,
    /\b(hdmi|speakers?|microphones?|input|display)\b/i,
  ],
  plumbing: [
    /\b(taps?|faucets?|sinks?|basins?)\b/i,
    /\b(leak(s|ing|y|ed)?|drip(s|ping)?)\b/i,
    /\b(pipes?|drains?|clogged|water pressure|no water)\b/i,
    /\b(water ?coolers?|coolers?|flush(ing)?|cisterns?)\b/i,
    /\b(urinals?|showers?|shower heads?|toilets?|water heaters?|geysers?)\b/i,
  ],
  furniture: [
    /\b(chairs?|desks?|tables?|benches?|stools?)\b/i,
    /\b(doors?|locks?|latch(es)?|hinges?|handles?)\b/i,
    /\b(cupboards?|shelf|shelves|lockers?|drawers?)\b/i,
    /\b(windows?|blinds?|curtains?|whiteboards?|notice ?boards?)\b/i,
  ],
  // Rooms (washroom, bathroom) are places, not faults, so they do not count here.
  sanitation: [
    /\b(dirty|filthy|unclean|not cleaned|cleaning|dusty?|wiped)\b/i,
    /\b(bins?|dustbins?|trash|garbage|rubbish|litter|waste)\b/i,
    /\b(cockroach(es)?|pests?|rats?|droppings|infestation|insects?)\b/i,
    /\b(soap|tissues?|toilet paper|hand towels?|saniti[sz]er|spill(s|ed)?|sticky|stains?|smell(s|y)?|odou?r|mou?ld|damp)\b/i,
  ],
  /*
   * Building and grounds. These never route on their own (classifyByKeywords abstains when they
   * lead), but they stop a report about a gate or ceiling tiles being pulled into furniture or
   * plumbing.
   */
  other: [
    /\b(gates?|fences?|railings?|ceiling tiles?|tiles|roof|walls?|paint(ed|ing)?|stairs?|ramps?|signs?|signage|parking|pavements?|paths?)\b/i,
  ],
};

export interface KeywordMatch {
  readonly category: ComplaintCategory;
  /** How many of the category's keyword groups matched; for logs and the trace. */
  readonly score: number;
}

/**
 * The single category a report clearly describes, or undefined when it names none or more than
 * one. A category "leads" when it matches more keyword groups than any other category.
 */
export function classifyByKeywords(text: string): KeywordMatch | undefined {
  const scores = (Object.keys(KEYWORDS) as ComplaintCategory[])
    .map((category) => ({
      category,
      score: KEYWORDS[category].filter((pattern) => pattern.test(text)).length,
    }))
    .sort((a, b) => b.score - a.score);
  const [best, runnerUp] = scores;
  if (best === undefined || best.score === 0) return undefined;
  if (runnerUp !== undefined && runnerUp.score >= best.score) return undefined;
  // "Other" is too broad to route by keywords; a person decides where it goes.
  if (best.category === "other") return undefined;
  return best;
}
