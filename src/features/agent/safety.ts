/**
 * Deterministic safety screen (plan §8, BR-08): reports that mention a possible danger to people
 * always go to a human, whatever the model proposes. The model can recommend urgency but can
 * never approve, escalate or trigger any emergency response.
 *
 * Deliberately broad. A false positive costs one manual routing; a false negative could leave a
 * dangerous fault waiting in a department queue as "medium".
 */
const SAFETY_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ["fire", /\b(fire|flames?|on fire|burning|scorch(ed|ing)?)\b/i],
  ["smoke", /\bsmok(e|ing|y)\b/i],
  ["sparks", /\bspark(s|ing|ed)?\b/i],
  ["electric_shock", /\b(electric(al)? shock|shocked|electrocut\w*|live wires?|exposed wir\w*)\b/i],
  ["gas", /\bgas (leak|smell)|smell(s|ing)? of gas\b/i],
  ["flooding", /\b(flood(ed|ing)?|burst pipe|water (pouring|gushing))\b/i],
  [
    "structural",
    /\b(collaps\w*|falling (ceiling|plaster)|ceiling (fell|falling)|crack(ed)? (wall|ceiling|beam))\b/i,
  ],
  [
    "injury",
    /\b(injur\w*|bleeding|hurt (himself|herself|themselves|myself)|unconscious|ambulance)\b/i,
  ],
  ["trapped", /\b(trapped|stuck in (the )?lift|stuck in (the )?elevator)\b/i],
  ["chemical", /\b(chemical (spill|leak)|asbestos|toxic)\b/i],
];

export interface SafetyScreen {
  readonly flagged: boolean;
  /** Pattern names only, safe to log and store; never the matched text. */
  readonly signals: readonly string[];
}

export function screenForSafety(text: string): SafetyScreen {
  const signals = SAFETY_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  return { flagged: signals.length > 0, signals };
}
