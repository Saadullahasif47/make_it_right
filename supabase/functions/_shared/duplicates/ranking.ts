/**
 * Duplicate candidate ranking (plan v2 §07). The score orders candidates for a person; it never
 * links anything by itself. Weights follow the plan's illustrative formula; the threshold below
 * which a case is not even proposed was chosen on the labelled pairs (A3.04, see
 * docs/evidence/a3-duplicate-eval.md) and is not a universal constant.
 */
export const RANKING_WEIGHTS = {
  similarity: 0.6,
  sameRoom: 0.2,
  categoryMatch: 0.1,
  sameAsset: 0.1,
} as const;

/**
 * Candidates scoring below this are not shown. Chosen on the A3.04 evaluation (best F1 on the
 * tuning half of 60 synthetic pairs; held-out precision 1.00, recall 0.80). With this weighting a
 * pair needs the same room to reach it, so duplicates whose room is unknown are not proposed:
 * a known limitation recorded in docs/evidence/a3-duplicate-eval.md and ADR 0011.
 */
export const CANDIDATE_THRESHOLD = 0.82;

/** At most this many candidates per report (plan: top 5). */
export const MAX_CANDIDATES = 5;

export interface CandidateFeatures {
  readonly caseId: string;
  /** Cosine similarity with the closest report already in the case, -1..1. */
  readonly similarity: number;
  readonly sameBuilding: boolean;
  readonly sameRoom: boolean;
  /** The same category, or one of the two not classified yet. */
  readonly categoryMatch: boolean;
  readonly sameAsset: boolean;
}

export interface RankedCandidate extends CandidateFeatures {
  readonly score: number;
}

export function rankingScore(features: Omit<CandidateFeatures, "caseId" | "sameBuilding">): number {
  const score =
    RANKING_WEIGHTS.similarity * features.similarity +
    RANKING_WEIGHTS.sameRoom * (features.sameRoom ? 1 : 0) +
    RANKING_WEIGHTS.categoryMatch * (features.categoryMatch ? 1 : 0) +
    RANKING_WEIGHTS.sameAsset * (features.sameAsset ? 1 : 0);
  return Math.round(score * 10_000) / 10_000;
}

/** The candidates worth a person's time, best first. */
export function rankCandidates(
  features: readonly CandidateFeatures[],
  threshold: number = CANDIDATE_THRESHOLD,
): readonly RankedCandidate[] {
  return features
    .map((candidate) => ({ ...candidate, score: rankingScore(candidate) }))
    .filter((candidate) => candidate.score >= threshold)
    .sort((a, b) => b.score - a.score || b.similarity - a.similarity)
    .slice(0, MAX_CANDIDATES);
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) {
    throw new RangeError("vectors must have the same, non-zero length");
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}
