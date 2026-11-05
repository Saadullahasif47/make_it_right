/**
 * Duplicate detection worker code (supabase/functions/_shared/duplicates), run in Node: the
 * ranking formula and threshold, the canonical text, the embedding adapter and both handlers.
 */
import { describe, expect, it, vi } from "vitest";

import {
  EMBEDDING_DIMENSIONS,
  canonicalText,
  embedText,
  normalise,
  sha256Hex,
} from "../../../../supabase/functions/_shared/duplicates/embeddings";
import {
  createDuplicateMatchHandler,
  createEmbeddingHandler,
} from "../../../../supabase/functions/_shared/duplicates/handlers";
import {
  CANDIDATE_THRESHOLD,
  MAX_CANDIDATES,
  RANKING_WEIGHTS,
  cosineSimilarity,
  rankCandidates,
  rankingScore,
} from "../../../../supabase/functions/_shared/duplicates/ranking";
import type { ClaimedJob } from "../../../../supabase/functions/_shared/jobs/types";

const job: ClaimedJob = {
  jobId: "0b7a6e00-0000-4000-8000-000000000001",
  msgId: 4,
  jobType: "embedding",
  targetId: "0b7a6e00-0000-4000-8000-000000000002",
  attempt: 1,
};

const unit = (index: number) =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === index ? 1 : 0));

describe("ranking", () => {
  it("follows the plan's weights", () => {
    expect(RANKING_WEIGHTS).toEqual({
      similarity: 0.6,
      sameRoom: 0.2,
      categoryMatch: 0.1,
      sameAsset: 0.1,
    });
    expect(
      rankingScore({ similarity: 1, sameRoom: true, categoryMatch: true, sameAsset: true }),
    ).toBe(1);
    expect(
      rankingScore({ similarity: 0.5, sameRoom: false, categoryMatch: true, sameAsset: false }),
    ).toBe(0.4);
  });

  it("drops weak candidates and keeps at most five, best first", () => {
    const features = Array.from({ length: 8 }, (_, index) => ({
      caseId: `case-${String(index)}`,
      similarity: 0.88 + index * 0.01,
      sameBuilding: true,
      sameRoom: true,
      categoryMatch: true,
      sameAsset: false,
    }));
    const ranked = rankCandidates(features);
    expect(ranked).toHaveLength(MAX_CANDIDATES);
    expect(ranked.map((candidate) => candidate.caseId)).toEqual([
      "case-7",
      "case-6",
      "case-5",
      "case-4",
      "case-3",
    ]);
    expect(ranked.every((candidate) => candidate.score >= CANDIDATE_THRESHOLD)).toBe(true);
  });

  it("does not propose a different problem in the same room on the room alone", () => {
    expect(
      rankCandidates([
        {
          caseId: "light",
          similarity: 0.2,
          sameBuilding: true,
          sameRoom: true,
          categoryMatch: false,
          sameAsset: false,
        },
      ]),
    ).toEqual([]);
  });

  it("computes cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(RangeError);
  });
});

describe("canonical text", () => {
  it("joins title, description and category, without identifiers", () => {
    expect(
      canonicalText({
        title: "Leak",
        description: "Call 07700 900123 about the sink",
        category: "plumbing",
      }),
    ).toBe("Leak\nCall [phone] about the sink\nCategory: plumbing.");
    expect(canonicalText({ title: "Leak", description: "Sink", category: "unclassified" })).toBe(
      "Leak\nSink",
    );
  });

  it("hashes the text with SHA-256", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("embedText (Gemini adapter)", () => {
  const options = (fetchMock: typeof fetch) => ({
    apiKey: "k",
    model: "gemini-embedding-2",
    fetch: fetchMock,
  });

  it("asks for 768 dimensions and returns a unit vector", async () => {
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(Response.json({ embedding: { values: unit(3).map((value) => value * 5) } })),
    );
    const vector = await embedText(options(fetchMock), "text", AbortSignal.timeout(5_000));
    expect(vector[3]).toBe(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent",
    );
    expect(JSON.parse(init?.body as string)).toMatchObject({ outputDimensionality: 768 });
    expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("k");
  });

  it("refuses a vector of the wrong size or with invalid numbers", async () => {
    for (const values of [
      [1, 2, 3],
      [...unit(0).slice(1), Number.NaN],
    ]) {
      await expect(
        embedText(
          options(() => Promise.resolve(Response.json({ embedding: { values } }))),
          "t",
          AbortSignal.timeout(5_000),
        ),
      ).rejects.toMatchObject({ code: "INVALID_OUTPUT", retryable: false });
    }
    expect(() => normalise(unit(0).map(() => 0))).toThrow();
  });

  it.each([
    [429, "RATE_LIMITED", true],
    [503, "PROVIDER_UNAVAILABLE", true],
    [400, "PROVIDER_REJECTED", false],
  ])("maps HTTP %i to %s", async (status, code, retryable) => {
    await expect(
      embedText(
        options(() => Promise.resolve(Response.json({}, { status }))),
        "t",
        AbortSignal.timeout(5_000),
      ),
    ).rejects.toMatchObject({ code, retryable });
  });
});

describe("handlers", () => {
  const context = {
    complaint_id: job.targetId,
    title: "Leak",
    description: "Water under the sink",
    category: "plumbing",
    model: null as string | null,
    text_hash: null as string | null,
  };

  function setup(
    stored: { model: string | null; text_hash: string | null },
    features: unknown[] = [],
  ) {
    const rpc = vi.fn((name: string, _args: Readonly<Record<string, unknown>>) => {
      if (name === "worker_embedding_context") return Promise.resolve([{ ...context, ...stored }]);
      if (name === "worker_duplicate_features") return Promise.resolve(features);
      return Promise.resolve(null);
    });
    const fetchMock = vi.fn(() =>
      Promise.resolve(Response.json({ embedding: { values: unit(1) } })),
    );
    const options = {
      rpc,
      embedding: {
        apiKey: "k",
        model: "gemini-embedding-2",
        fetch: fetchMock as unknown as typeof fetch,
      },
      model: "gemini-embedding-2",
    };
    return { rpc, fetchMock, options };
  }

  it("embeds new text and stores it with its model and hash", async () => {
    const { rpc, fetchMock, options } = setup({ model: null, text_hash: null });
    await createEmbeddingHandler(options)(job, AbortSignal.timeout(5_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenLastCalledWith(
      "worker_save_embedding",
      expect.objectContaining({
        p_model: "gemini-embedding-2",
        p_text_hash: await sha256Hex(canonicalText(context)),
        p_embedding: unit(1),
      }),
    );
  });

  it("never calls the provider again for unchanged text under the same model", async () => {
    const hash = await sha256Hex(canonicalText(context));
    const { rpc, fetchMock, options } = setup({ model: "gemini-embedding-2", text_hash: hash });
    await createEmbeddingHandler(options)(job, AbortSignal.timeout(5_000));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith(
      "worker_save_embedding",
      expect.objectContaining({ p_embedding: null }),
    );
  });

  it("re-embeds when the model changed, so vectors of two models never mix", async () => {
    const hash = await sha256Hex(canonicalText(context));
    const { fetchMock, options } = setup({ model: "older-model", text_hash: hash });
    await createEmbeddingHandler(options)(job, AbortSignal.timeout(5_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing when AI is off", async () => {
    const { options } = setup({ model: null, text_hash: null });
    await expect(
      createEmbeddingHandler({ ...options, embedding: { unavailable: "AI_DISABLED" } })(
        job,
        AbortSignal.timeout(5_000),
      ),
    ).rejects.toMatchObject({ code: "AI_DISABLED", retryable: false });
  });

  it("stores only ranked candidates above the threshold", async () => {
    const strong = {
      case_id: "0b7a6e00-0000-4000-8000-000000000010",
      case_reference: 5010,
      similarity: 0.9,
      same_building: true,
      same_room: true,
      category_match: true,
      same_asset: false,
    };
    const weak = {
      ...strong,
      case_id: "0b7a6e00-0000-4000-8000-000000000011",
      similarity: 0.1,
      same_room: false,
      category_match: false,
    };
    const { rpc, options } = setup({ model: null, text_hash: null }, [strong, weak]);
    await createDuplicateMatchHandler(options)(
      { ...job, jobType: "duplicate_match" },
      AbortSignal.timeout(5_000),
    );
    const saved = rpc.mock.calls.find(([name]) => name === "worker_save_match_candidates")?.[1];
    expect(saved?.p_candidates).toEqual([
      expect.objectContaining({
        case_id: strong.case_id,
        score: rankingScore({
          similarity: 0.9,
          sameRoom: true,
          categoryMatch: true,
          sameAsset: false,
        }),
      }),
    ]);
  });
});
