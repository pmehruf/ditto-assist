/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for the "evidence -> rule -> condition -> conclusion"
 * synthesis fix (see productAssist.ts's EVIDENCE -> RULE -> CONDITION ->
 * CONCLUSION section and the "synthesis" response-schema field). Before this
 * fix, Product Assist would retrieve the right evidence but often just
 * restate it, leaving the advisor to work out the conclusion themselves —
 * e.g. "a diagnostic angiogram is excluded from PTCA/angioplasty" instead of
 * "No, a diagnostic angiogram does not qualify."
 *
 * What these tests can and can't verify, honestly: the actual REASONING
 * (recognizing that a diagnostic angiogram is not PTCA/angioplasty, and
 * drawing "No" from that) happens inside the real Gemini call, which these
 * offline unit tests mock — there is no live-model eval harness in this
 * repo (see faq.test.ts/specialInstructions.test.ts for the same
 * mocked-repository convention this file follows). What IS verified here,
 * deterministically:
 *   1. The prompt/schema sent to Gemini actually carries the synthesis-
 *      forcing machinery (required "synthesis" field with its four
 *      resolutions, and the SYSTEM_INSTRUCTION directives that tell the
 *      model to compare facts against requirements rather than restate
 *      them) — a regression guard against this fix being silently reverted.
 *   2. Whatever conclusion the model reaches (simulated here via a mocked
 *      "correct" response for each scenario) survives unmodified to the
 *      advisor — no code-level softening, truncation, or override — and the
 *      internal "synthesis" reasoning never leaks into the client-facing
 *      answer/share/sources/meta.
 *   3. Source-hierarchy ordering (Special Instructions > Org Constitution
 *      > Document Excerpts) is unchanged by adding the synthesis field.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Type } from "@google/genai";
import type { Repositories } from "../db/repositories/index.js";
import type { KbCategoryRow, SpecialInstructionRow, FaqRecordRow, TermFaqRecordRow, KbPlaybookPlanFactRow, KbAcronymRow } from "../db/schema.js";
import type { SimilarKbChunk } from "../db/repositories/kbChunksRepository.js";

const FIXED_QUERY_EMBEDDING = [1, 0, 0];

const generateContentMock = vi.fn();
const embedContentMock = vi.fn(async ({ contents }: { contents: string[] }) => ({
  embeddings: contents.map(() => ({ values: FIXED_QUERY_EMBEDDING })),
}));

vi.mock("./geminiClient.js", () => ({
  getKbAiClient: () => ({
    models: {
      generateContent: generateContentMock,
      embedContent: embedContentMock,
    },
  }),
}));

// Imported AFTER the mock is registered, per vitest hoisting convention.
const { answerQuery, SYSTEM_INSTRUCTION, SYSTEM_INSTRUCTION_TERM } = await import("./productAssist.js");

function mockModelResponse(body: { synthesis?: unknown; answer: string; share: string | null; citedDocumentTitles?: string[] }, modelVersion?: string) {
  generateContentMock.mockResolvedValueOnce({
    text: JSON.stringify({
      synthesis: { requirement: "", userFacts: "", comparison: "", resolution: "SATISFIED" },
      ...body,
    }),
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    // Optional on the real SDK response (not guaranteed on every call) — see
    // answerQuery's meta.modelName. Omitted by default so the bulk of this
    // file's tests exercise the realistic "field absent" case; the dedicated
    // "model tracking" tests below pass it explicitly.
    ...(modelVersion !== undefined ? { modelVersion } : {}),
  });
}

function categoryRow(overrides: Partial<KbCategoryRow> = {}): KbCategoryRow {
  return {
    id: 1,
    name: "TestInsurer",
    type: "insurer",
    domain: "Health",
    sortOrder: 0,
    planNames: ["Activ One Max"],
    disabledPlanNames: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function chunk(content: string, overrides: Partial<SimilarKbChunk> = {}): SimilarKbChunk {
  return {
    chunk: { id: 1, resourceId: 1, content, chunkIndex: 0, tokenCount: null, createdAt: new Date() } as SimilarKbChunk["chunk"],
    resourceId: 1,
    resourceTitle: "Activ One Max — Policy Wording",
    categoryId: 1,
    documentType: "policy_wording",
    sourceUrl: null,
    distance: 0.1,
    ...overrides,
  };
}

function faqRow(overrides: Partial<FaqRecordRow> = {}): FaqRecordRow {
  return {
    id: 1,
    resourceId: 1,
    category: "health_product",
    question: "Does Ditto facilitate the Chronic Care Rider add-on?",
    answer: "Yes, this can be added at the time of proposal.",
    isAnswerable: true,
    hasConflict: false,
    conflictGroupKey: null,
    questionEmbedding: FIXED_QUERY_EMBEDDING as unknown as FaqRecordRow["questionEmbedding"],
    sourceRowNumber: 2,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function termFaqRow(overrides: Partial<TermFaqRecordRow> = {}): TermFaqRecordRow {
  return {
    id: 1,
    resourceId: 1,
    category: "Dittos Recommended Policies",
    question: "Can we do mid-term inclusion through Ditto for a term plan?",
    answer: "No, Ditto does not currently facilitate this for term plans either.",
    isAnswerable: true,
    hasConflict: false,
    conflictGroupKey: null,
    questionEmbedding: FIXED_QUERY_EMBEDDING as unknown as TermFaqRecordRow["questionEmbedding"],
    sourceRowNumber: 2,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function playbookFact(overrides: Partial<KbPlaybookPlanFactRow> = {}): KbPlaybookPlanFactRow {
  return {
    id: 1,
    resourceId: 1,
    domain: "Health",
    insurerName: "TestInsurer",
    planName: "Activ One Max",
    sourceTab: "Dittos Recommended Policies",
    content: "Chronic Care Rider covers listed chronic conditions once the insurer's eligibility criteria are met.",
    notes: [],
    updatedAt: new Date(),
    ...overrides,
  };
}

function specialInstructionRow(overrides: Partial<SpecialInstructionRow> = {}): SpecialInstructionRow {
  return {
    id: 1,
    topic: "Chronic Care Rider",
    instructionText: "The Chronic Care Rider may never be back-dated for this insurer, regardless of what the policy wording implies.",
    instructionType: "override_rule",
    insurerCategoryId: null,
    productPlanName: null,
    domain: "Health",
    topicEmbedding: FIXED_QUERY_EMBEDDING as unknown as SpecialInstructionRow["topicEmbedding"],
    isActive: true,
    createdBy: "test",
    updatedBy: "test",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SpecialInstructionRow;
}

function acronymRow(overrides: Partial<KbAcronymRow> = {}): KbAcronymRow {
  return {
    id: 1,
    acronym: "OS",
    expansion: "Activ One Max",
    notes: null,
    domain: "Health",
    isActive: true,
    createdBy: "test",
    updatedBy: "test",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface FakeReposConfig {
  categories?: KbCategoryRow[];
  chunks?: SimilarKbChunk[];
  playbookFacts?: KbPlaybookPlanFactRow[];
  faqs?: FaqRecordRow[];
  termFaqs?: TermFaqRecordRow[];
  specialInstructions?: SpecialInstructionRow[];
  acronyms?: KbAcronymRow[];
}

// Documents/limit-aware, per docType — a real DB query narrowed to
// documentTypes: ["policy_wording"] only ever returns policy_wording rows,
// so the fake must do the same or the new progressive-retrieval logic in
// productAssist.ts (which issues up to 3 separate, type-scoped calls) would
// see the exact same fixture chunks duplicated across every stage. Exposed
// as a vi.fn (via findSimilarSpy) so tests can assert which stages were, or
// were NOT, actually queried — the literal thing several of the new
// progressive-retrieval tests below need to verify.
function fakeRepos(cfg: FakeReposConfig = {}): { repos: Repositories; findSimilarSpy: ReturnType<typeof vi.fn> } {
  const findSimilarSpy = vi.fn(
    async (
      _embedding: number[],
      options: { documentTypes?: SimilarKbChunk["documentType"][]; categoryIds?: number[]; limit?: number } = {}
    ): Promise<SimilarKbChunk[]> => {
      const all = cfg.chunks ?? [];
      // Mirrors the real KbChunksRepository.findSimilar's categoryIds
      // filtering (see kbChunksRepository.ts) — needed so Insurance
      // Fundamentals tests (a dedicated categoryIds-scoped call with no
      // documentTypes) and the normal staged product-document calls (a
      // documentTypes-scoped call) don't see each other's fixture chunks
      // just because both happen to be present in one test's cfg.chunks.
      const byCategory = options.categoryIds ? all.filter(c => options.categoryIds!.includes(c.categoryId)) : all;
      const filtered = options.documentTypes ? byCategory.filter(c => options.documentTypes!.includes(c.documentType)) : byCategory;
      return filtered.slice(0, options.limit ?? filtered.length);
    }
  );
  const repos = {
    kbCategories: { list: async () => cfg.categories ?? [categoryRow()] },
    kbResources: { list: async () => [] },
    kbChunks: { findSimilar: findSimilarSpy },
    kbPlaybookPlanFacts: {
      findMatching: async () => cfg.playbookFacts ?? [],
      findAllForInsurer: async () => cfg.playbookFacts ?? [],
      listAllForDomain: async () => cfg.playbookFacts ?? [],
    },
    faqRecords: { listAnswerableActive: async () => cfg.faqs ?? [] },
    termFaqRecords: { listAnswerableActive: async () => cfg.termFaqs ?? [] },
    specialInstructions: { listActive: async () => cfg.specialInstructions ?? [] },
    kbAcronyms: { listActive: async () => cfg.acronyms ?? [] },
  } as unknown as Repositories;
  return { repos, findSimilarSpy };
}

/** Most tests only care about the resulting answer, not which retrieval
 * stages ran — this thin wrapper keeps every pre-existing call site
 * (`fakeReposOnly(cfg)` passed straight into `answerQuery`) unchanged. Tests
 * that need to assert on retrieval staging call `fakeReposOnly()` directly
 * instead, for access to `findSimilarSpy`. */
function fakeReposOnly(cfg: FakeReposConfig = {}): Repositories {
  return fakeRepos(cfg).repos;
}

const SCOPE = { categoryId: 1, planTags: ["Activ One Max"] };

beforeEach(() => {
  generateContentMock.mockReset();
  embedContentMock.mockClear();
});

describe("Product Assist synthesis — schema & prompt wiring (regression guard)", () => {
  it("SYSTEM_INSTRUCTION requires the evidence -> rule -> condition -> conclusion synthesis step", () => {
    expect(SYSTEM_INSTRUCTION).toContain("EVIDENCE → RULE → CONDITION → CONCLUSION");
    expect(SYSTEM_INSTRUCTION).toContain("SATISFIED");
    expect(SYSTEM_INSTRUCTION).toContain("NOT_SATISFIED");
    expect(SYSTEM_INSTRUCTION).toContain("INSUFFICIENT_INFORMATION");
  });

  it("SYSTEM_INSTRUCTION explicitly warns against treating a related-but-different procedure as equivalent", () => {
    expect(SYSTEM_INSTRUCTION).toContain("diagnostic angiogram is a different procedure from PTCA/angioplasty");
  });

  it("SYSTEM_INSTRUCTION restricts hedging language to genuine unresolved cases", () => {
    expect(SYSTEM_INSTRUCTION).toContain("HEDGING DISCIPLINE");
    expect(SYSTEM_INSTRUCTION).toContain("Never hedge merely because more than one document was retrieved");
  });

  it("SYSTEM_INSTRUCTION instructs applying insurance-expert terminology interpretation instead of defaulting to insufficient information", () => {
    expect(SYSTEM_INSTRUCTION).toContain("APPLY YOUR INSURANCE-EXPERT KNOWLEDGE TO STEP 3");
    expect(SYSTEM_INSTRUCTION).toContain("Do NOT default to INSUFFICIENT_INFORMATION merely because the advisor didn't repeat the source's exact technical wording");
  });

  it("SYSTEM_INSTRUCTION only nulls the draft message for genuine lack of source coverage, not for a reasoned SATISFIED/NOT_SATISFIED conclusion", () => {
    expect(SYSTEM_INSTRUCTION).toContain("NO DRAFT RULE");
    expect(SYSTEM_INSTRUCTION).toContain(
      "Do not null \"share\" out of caution merely because the answer required judgment, turned on an exclusion, or came with a caveat"
    );
  });

  it("SYSTEM_INSTRUCTION places a matched FAQ's citation in the References list, never inline in the answer's prose", () => {
    expect(SYSTEM_INSTRUCTION).toContain(
      "do NOT interrupt the prose with the FAQ question, a bolded reference to it, or any inline citation for it"
    );
    expect(SYSTEM_INSTRUCTION).toContain('- **FAQ- <the exact matched question>**');
  });

  it("sends a response schema with a required synthesis field ahead of answer/share", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    await answerQuery(fakeReposOnly(), SCOPE, "Any question", []);
    const call = generateContentMock.mock.calls[0][0];
    const schema = call.config.responseSchema;
    expect(schema.required).toEqual(["synthesis", "answer", "citedDocumentTitles", "share"]);
    expect(schema.propertyOrdering).toEqual(["synthesis", "answer", "citedDocumentTitles", "share"]);
    expect(schema.properties.synthesis.properties.resolution.enum).toEqual([
      "SATISFIED",
      "NOT_SATISFIED",
      "INSUFFICIENT_INFORMATION",
      "NO_REQUIREMENT_FOUND",
    ]);
    // Array-of-strings field the model uses to report which retrieved
    // documents it actually cited (2026-09) — see citedDocumentTitles's own
    // schema field description for the full contract.
    expect(schema.properties.citedDocumentTitles.type).toBe(Type.ARRAY);
    expect(schema.properties.citedDocumentTitles.items.type).toBe(Type.STRING);
  });
});

describe("Sources panel reflects what was actually cited, not everything retrieved (2026-09)", () => {
  // Real production bug: an answer built entirely from the Ditto FAQ still
  // showed unrelated, never-cited Policy Wording documents in the advisor-
  // facing "Sources" panel, because that panel was populated from every
  // chunk RETRIEVED as context, not from what the model's own References
  // list actually cited. citedDocumentTitles closes that gap.
  it("citedDocumentTitles names one of two retrieved chunks -> sources is filtered down to just that one", async () => {
    mockModelResponse({
      answer: "Room rent is capped at 1% of Sum Insured per day.\n\n**References**\n- Policy Wording, Section 3.1",
      citedDocumentTitles: ["Policy Wording A"],
      share: "Room rent is capped at 1% of the sum insured, per day.",
    });
    const result = await answerQuery(
      fakeReposOnly({
        chunks: [
          chunk("Section 3.1: Room rent capped at 1% of Sum Insured per day.", { resourceTitle: "Policy Wording A" }),
          chunk("Unrelated excerpt about a different topic entirely.", { resourceTitle: "Policy Wording B" }),
        ],
      }),
      SCOPE,
      "What is the room rent limit?",
      []
    );
    expect(result.sources.map((s) => s.title)).toEqual(["Policy Wording A"]);
  });

  it("citedDocumentTitles is an empty array (answer relied only on the Ditto FAQ) -> sources is empty even though chunks were retrieved", async () => {
    mockModelResponse({
      answer: "No, the remaining amount is the co-payment portion, which is not claimable.\n\n**References**\n- **FAQ- If a person has 2 plans with 20% co-payment...**",
      citedDocumentTitles: [],
      share: "No, that remaining amount is the co-payment you're responsible for.",
    });
    const result = await answerQuery(
      fakeReposOnly({ chunks: [chunk("Unrelated policy wording excerpt about a different plan feature.")] }),
      SCOPE,
      "How does copayment work?",
      []
    );
    expect(result.sources).toEqual([]);
  });

  it("citedDocumentTitles names a title that matches nothing retrieved (bookkeeping mismatch) -> falls back to the full retrieved list rather than hiding everything", async () => {
    mockModelResponse({
      answer: "Room rent is capped at 1% of Sum Insured per day.\n\n**References**\n- Policy Wording, Section 3.1",
      citedDocumentTitles: ["A title that does not match any retrieved chunk"],
      share: "Room rent is capped at 1% of the sum insured, per day.",
    });
    const result = await answerQuery(
      fakeReposOnly({ chunks: [chunk("Section 3.1: Room rent capped at 1% of Sum Insured per day.", { resourceTitle: "Policy Wording A" })] }),
      SCOPE,
      "What is the room rent limit?",
      []
    );
    expect(result.sources.map((s) => s.title)).toEqual(["Policy Wording A"]);
  });

  it("citedDocumentTitles absent from the model response (older/mocked answer) -> sources stays unfiltered, no regression", async () => {
    mockModelResponse({ answer: "Room rent is capped at 1% of Sum Insured per day.", share: "Room rent is capped at 1% of the sum insured, per day." });
    const result = await answerQuery(
      fakeReposOnly({ chunks: [chunk("Section 3.1: Room rent capped at 1% of Sum Insured per day.", { resourceTitle: "Policy Wording A" })] }),
      SCOPE,
      "What is the room rent limit?",
      []
    );
    expect(result.sources.map((s) => s.title)).toEqual(["Policy Wording A"]);
  });
});

describe("Acronym Dictionary integration", () => {
  it("a plan-name acronym in the question drives plan detection the same as the full name would — Playbook facts get looked up for it", async () => {
    mockModelResponse({ answer: "The bonus for Activ One Max is 50% per claim-free year.", share: "The bonus is 50% for every year without a claim." });
    await answerQuery(
      fakeReposOnly({
        categories: [categoryRow()],
        acronyms: [acronymRow()], // "OS" -> "Activ One Max", which IS in categoryRow()'s planNames roster
        playbookFacts: [playbookFact()],
      }),
      { categoryId: 1, planTags: [] }, // no plan chip selected — only the acronym names one
      "What's the bonus in OS?",
      []
    );
    const promptText = generateContentMock.mock.calls[0][0].contents[0].parts[0].text as string;
    // buildScopeLine renders the detected plan name into SELECTED SCOPE when
    // no chip was picked — confirms the acronym was resolved to the plan.
    expect(promptText).toContain("Activ One Max");
  });

  it("an acronym whose expansion is NOT a plan name (e.g. a benefit/term acronym) does not affect plan detection, only retrieval/context", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    await answerQuery(
      fakeReposOnly({
        categories: [categoryRow()],
        acronyms: [acronymRow({ acronym: "CBB", expansion: "Cumulative Bonus Super" })],
      }),
      { categoryId: 1, planTags: [] },
      "Does CBB apply after two claim-free years?",
      []
    );
    const promptText = generateContentMock.mock.calls[0][0].contents[0].parts[0].text as string;
    expect(promptText).toContain("No plan was selected via the UI or detected in the question");
  });

  it("matched acronyms are rendered as an ACRONYM REFERENCE block in the prompt, and expand the retrieval query text", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    await answerQuery(
      fakeReposOnly({ acronyms: [acronymRow({ acronym: "CBB", expansion: "Cumulative Bonus Super", notes: "HDFC ERGO only" })] }),
      SCOPE,
      "Does CBB apply after two claim-free years?",
      []
    );
    const promptText = generateContentMock.mock.calls[0][0].contents[0].parts[0].text as string;
    expect(promptText).toContain("ACRONYM REFERENCE");
    expect(promptText).toContain('- "CBB" = Cumulative Bonus Super (HDFC ERGO only)');
    const embeddedTexts = embedContentMock.mock.calls[0][0].contents as string[];
    expect(embeddedTexts[0]).toContain("Cumulative Bonus Super");
  });

  it("a question using no known acronym produces no ACRONYM REFERENCE block — byte-identical prompt for the unaffected case", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    await answerQuery(fakeReposOnly({ acronyms: [acronymRow()] }), SCOPE, "What is the room rent limit?", []);
    const promptText = generateContentMock.mock.calls[0][0].contents[0].parts[0].text as string;
    expect(promptText).not.toContain("ACRONYM REFERENCE");
  });
});

describe("Product Assist synthesis — Chronic Care Rider / angiogram vs PTCA (validation cases 1-4)", () => {
  const eligibilityChunk = chunk(
    "Chronic Care Rider — Heart Condition eligibility: PTCA/angioplasty performed at least 1 year prior to the proposal date. Diagnostic angiography/angiogram without angioplasty or stent insertion is explicitly excluded from this definition."
  );

  it("case 1 — direct eligibility question produces a definitive YES when the stated fact meets the requirement", async () => {
    mockModelResponse({
      synthesis: {
        requirement: "PTCA/angioplasty performed at least 1 year prior",
        userFacts: "PTCA performed 14 months ago",
        comparison: "userFacts is the SAME procedure the requirement names, and the timing exceeds the 1-year minimum",
        resolution: "SATISFIED",
      },
      answer: "Yes. The customer's PTCA/angioplasty was performed 14 months ago, which satisfies the Chronic Care Rider's 1-year-prior eligibility requirement.\n\n**References**\n- Policy Wording, Chronic Care Rider eligibility",
      share: "Yes, this qualifies — the procedure was done more than a year ago.",
    });
    const result = await answerQuery(
      fakeReposOnly({ chunks: [eligibilityChunk], playbookFacts: [playbookFact()] }),
      SCOPE,
      "Customer had PTCA 14 months ago — is the Chronic Care Rider eligible?",
      []
    );
    expect(result.answer.startsWith("Yes.")).toBe(true);
    expect(result.share).toBe("Yes, this qualifies — the procedure was done more than a year ago.");
  });

  it("case 2 — requirement explicitly excludes the user's stated condition produces a definitive NO (the worked example)", async () => {
    mockModelResponse({
      synthesis: {
        requirement: "PTCA/angioplasty performed at least 1 year prior; diagnostic angiogram without angioplasty/stent is explicitly excluded",
        userFacts: "Diagnostic angiogram, no angioplasty or stent",
        comparison: "userFacts names a DIFFERENT-BUT-RELATED procedure the requirement explicitly excludes — not equivalent to PTCA/angioplasty",
        resolution: "NOT_SATISFIED",
      },
      answer:
        "No. A diagnostic angiogram by itself does not make the customer eligible for the Chronic Care Rider. The relevant eligibility requires PTCA/angioplasty to have been performed at least 1 year earlier, and a standalone diagnostic angiogram without angioplasty or stent insertion is explicitly excluded from that definition.\n\n**References**\n- Policy Wording, Chronic Care Rider eligibility",
      share: "No — a diagnostic angiogram on its own doesn't qualify for this rider.",
    });
    const result = await answerQuery(
      fakeReposOnly({ chunks: [eligibilityChunk], playbookFacts: [playbookFact()] }),
      SCOPE,
      "The customer had a diagnostic angiogram, no angioplasty. Can the Chronic Care Rider reduce the waiting period for Activ One Max?",
      []
    );
    expect(result.answer.startsWith("No.")).toBe(true);
    expect(result.answer).not.toMatch(/it depends|please check|may qualify/i);
    expect(result.share).toContain("No");
  });

  it("case 3 — requirement explicitly includes the user's stated condition produces a definitive YES", async () => {
    const listedConditionChunk = chunk(
      "Chronic Care Rider — Diabetes eligibility: any customer diagnosed with Type 2 Diabetes Mellitus under active oral medication is eligible, no minimum duration required."
    );
    mockModelResponse({
      synthesis: {
        requirement: "Diagnosed with Type 2 Diabetes Mellitus under active oral medication, no minimum duration",
        userFacts: "Diagnosed Type 2 diabetic on oral medication",
        comparison: "userFacts is the SAME condition the requirement names",
        resolution: "SATISFIED",
      },
      answer: "Yes. The customer's Type 2 Diabetes diagnosis under oral medication directly matches the Chronic Care Rider's listed eligibility condition, with no minimum duration required.\n\n**References**\n- Policy Wording, Chronic Care Rider eligibility",
      share: "Yes, this condition is covered under the rider.",
    });
    const result = await answerQuery(fakeReposOnly({ chunks: [listedConditionChunk] }), SCOPE, "Customer is a Type 2 diabetic on oral medication — eligible for the Chronic Care Rider?", []);
    expect(result.answer.startsWith("Yes.")).toBe(true);
  });

  it("case 4 — a related but non-equivalent procedural term is not silently treated as equivalent (distinct outcome from case 1)", async () => {
    mockModelResponse({
      synthesis: {
        requirement: "PTCA/angioplasty performed at least 1 year prior",
        userFacts: "Diagnostic angiogram only",
        comparison: "DIFFERENT-BUT-RELATED — angiogram is not PTCA/angioplasty",
        resolution: "NOT_SATISFIED",
      },
      answer: "No. A diagnostic angiogram is not the same procedure as PTCA/angioplasty, so the eligibility requirement is not met.",
      share: "No, this specific procedure doesn't meet the requirement.",
    });
    const result = await answerQuery(fakeReposOnly({ chunks: [eligibilityChunk] }), SCOPE, "Customer only had a diagnostic angiogram — does that meet the Chronic Care Rider requirement?", []);
    // Same source content as case 1 (PTCA-satisfied), but a different stated
    // fact (angiogram, not PTCA) must not collapse into the same YES answer.
    expect(result.answer.startsWith("No.")).toBe(true);
    expect(result.answer).not.toBe("Yes. The customer's PTCA/angioplasty was performed 14 months ago, which satisfies the Chronic Care Rider's 1-year-prior eligibility requirement.\n\n**References**\n- Policy Wording, Chronic Care Rider eligibility");
  });
});

describe("Product Assist synthesis — multi-source & authority hierarchy (validation cases 5-6)", () => {
  it("case 5 — compatible Playbook + document-excerpt content are both delivered to the model for one synthesized conclusion", async () => {
    mockModelResponse({
      answer: "Yes. Both the Product Playbook and the policy wording agree this benefit applies.\n\n**References**\n- Policy Wording, Section 4.2",
      share: "Yes, this is covered.",
    });
    await answerQuery(
      fakeReposOnly({
        chunks: [chunk("Section 4.2: Restoration benefit applies once per policy year.")],
        playbookFacts: [playbookFact({ content: "Restoration benefit: confirmed live for this plan, unlimited restorations." })],
      }),
      SCOPE,
      "Does Activ One Max have a restoration benefit?",
      []
    );
    const promptText = generateContentMock.mock.calls[0][0].contents[0].parts[0].text as string;
    expect(promptText).toContain("Restoration benefit applies once per policy year");
    expect(promptText).toContain("Restoration benefit: confirmed live for this plan");
  });

  it("case 6 — ORG CONSTITUTION (FAQ/Playbook) content precedes DOCUMENT EXCERPTS content in the prompt, per source hierarchy", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    await answerQuery(
      fakeReposOnly({
        chunks: [chunk("Some insurer document text that could conflict with the Playbook.")],
        playbookFacts: [playbookFact({ content: "Playbook's own authoritative statement on this topic." })],
        // questionEmbedding deliberately NOT the default FIXED_QUERY_EMBEDDING
        // (a full 1.0-similarity match): this case's own point is that FAQ +
        // Playbook + document excerpts all coexist in one prompt, which needs
        // a genuinely-relevant-but-not-certain FAQ match (score ~0.6, above
        // FAQ_RELEVANCE_THRESHOLD's 0.5 inclusion bar but below
        // FAQ_SUFFICIENCY_THRESHOLD's 0.85 skip-retrieval gate — see the
        // dedicated "ORG CONSTITUTION SUFFICIENCY GATE" tests below for the
        // >=0.85 case).
        faqs: [faqRow({ questionEmbedding: [0.6, 0.8, 0] as unknown as FaqRecordRow["questionEmbedding"] })],
      }),
      SCOPE,
      "What does the Chronic Care Rider cover?",
      []
    );
    const promptText = generateContentMock.mock.calls[0][0].contents[0].parts[0].text as string;
    const constitutionIndex = promptText.indexOf("ORG CONSTITUTION");
    const excerptsIndex = promptText.indexOf("DOCUMENT EXCERPTS");
    expect(constitutionIndex).toBeGreaterThan(-1);
    expect(excerptsIndex).toBeGreaterThan(-1);
    expect(constitutionIndex).toBeLessThan(excerptsIndex);
  });
});

describe("Product Assist synthesis — uncertainty & overrides (validation cases 7-8)", () => {
  it("case 7 — genuine insufficient evidence retains uncertainty instead of guessing, and share stays null", async () => {
    mockModelResponse({
      synthesis: {
        requirement: "",
        userFacts: "Customer had an unspecified cardiac procedure",
        comparison: "UNCLEAR — the advisor's question doesn't name the specific procedure performed",
        resolution: "INSUFFICIENT_INFORMATION",
      },
      answer: "I don't have enough information to determine eligibility — the question doesn't specify which cardiac procedure was performed, and the Chronic Care Rider's eligibility depends on that distinction (e.g. PTCA/angioplasty vs a diagnostic-only procedure).",
      share: null,
    });
    const result = await answerQuery(fakeReposOnly({ chunks: [chunk("Chronic Care Rider eligibility depends on the exact cardiac procedure performed.")] }), SCOPE, "Customer had a cardiac procedure — is the Chronic Care Rider eligible?", []);
    expect(result.share).toBeNull();
    expect(result.answer).not.toMatch(/^(Yes|No)\./);
  });

  it("case 8 — an applicable override rule is delivered ahead of, and outside, the normal document/Playbook blocks", async () => {
    mockModelResponse({
      answer: "No. Per Ditto's override policy, the Chronic Care Rider can never be back-dated for this insurer, regardless of what the policy wording implies.",
      share: "No, this can't be back-dated.",
    });
    await answerQuery(
      fakeReposOnly({
        specialInstructions: [specialInstructionRow()],
        chunks: [chunk("Policy wording appears to allow back-dating under some circumstances.")],
        playbookFacts: [playbookFact()],
      }),
      SCOPE,
      "Can the Chronic Care Rider be back-dated for this insurer?",
      []
    );
    const promptText = generateContentMock.mock.calls[0][0].contents[0].parts[0].text as string;
    const overrideIndex = promptText.indexOf("SPECIAL INSTRUCTIONS");
    const constitutionIndex = promptText.indexOf("ORG CONSTITUTION");
    expect(overrideIndex).toBeGreaterThan(-1);
    expect(overrideIndex).toBeLessThan(constitutionIndex === -1 ? Infinity : constitutionIndex);
    expect(promptText).toContain("The Chronic Care Rider may never be back-dated");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Progressive source-priority retrieval (2026-08 token-optimization task).
// retrieveDocumentChunks() in productAssist.ts runs Policy Wording ->
// Prospectus -> Brochure/other as separate, escalating stages instead of one
// flat top-RETRIEVAL_LIMIT query across every type, stopping as soon as a
// stage (or the FAQ sufficiency gate before it) already has enough strong
// evidence — see that function's own doc comment for the full rationale,
// including why Product Playbook deliberately does NOT participate in the
// FAQ gate. findSimilarSpy (see fakeRepos above) makes each stage's calls
// individually inspectable: which documentTypes were requested, and how
// many times findSimilar was called at all.
// ─────────────────────────────────────────────────────────────────────────
describe("Progressive source-priority retrieval", () => {
  function pw(distance: number, content = "Policy Wording excerpt") {
    return chunk(content, { documentType: "policy_wording", distance });
  }
  function prospectus(distance: number, content = "Prospectus excerpt") {
    return chunk(content, { documentType: "prospectus", distance, resourceTitle: "Activ One Max — Prospectus" });
  }
  function brochure(distance: number, content = "Brochure excerpt") {
    return chunk(content, { documentType: "brochure", distance, resourceTitle: "Activ One Max — Brochure" });
  }
  // Cosine similarity 1.0 against the fixed test query embedding — clears
  // FAQ_SUFFICIENCY_THRESHOLD's 0.85 bar by construction.
  const highConfidenceFaq = faqRow({ questionEmbedding: FIXED_QUERY_EMBEDDING as unknown as FaqRecordRow["questionEmbedding"] });
  // Similarity ~0.6 — clears FAQ_RELEVANCE_THRESHOLD's 0.5 inclusion bar
  // (so it still participates in ORG CONSTITUTION) but stays below the 0.85
  // sufficiency gate, same fixture used in case 6 above.
  const moderateFaq = faqRow({ questionEmbedding: [0.6, 0.8, 0] as unknown as FaqRecordRow["questionEmbedding"] });

  it("1. FAQ sufficient (>=0.85 match) — document-chunk retrieval is never called at all", async () => {
    mockModelResponse({ answer: "Yes, this is Ditto's standard process.", share: "Yes, we can help with that." });
    const { repos, findSimilarSpy } = fakeRepos({
      faqs: [highConfidenceFaq],
      chunks: [pw(0.05), pw(0.1), pw(0.15)], // present in fixtures — must NOT be fetched
    });
    const result = await answerQuery(repos, SCOPE, "Does Ditto facilitate the Chronic Care Rider add-on?", []);
    expect(findSimilarSpy).not.toHaveBeenCalled();
    expect(result.sources).toHaveLength(0);
    expect(result.meta.retrievedChunkCount).toBe(0);
  });

  it("2. FAQ insufficient (<0.85) + Policy Wording available — Policy Wording is searched", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    const { repos, findSimilarSpy } = fakeRepos({ faqs: [moderateFaq], chunks: [pw(0.1)] });
    await answerQuery(repos, SCOPE, "What is the room rent limit?", []);
    expect(findSimilarSpy).toHaveBeenCalled();
    const firstCallOptions = findSimilarSpy.mock.calls[0][1];
    expect(firstCallOptions.documentTypes).toEqual(["policy_wording"]);
  });

  it("3. Policy Wording sufficient (>=3 strong matches) — Prospectus and Brochure are never searched", async () => {
    mockModelResponse({ answer: "The room rent limit is 1% of Sum Insured per day.", share: "Room rent is capped at 1% of the sum insured, per day." });
    const { repos, findSimilarSpy } = fakeRepos({
      chunks: [pw(0.1), pw(0.2), pw(0.3), prospectus(0.05), brochure(0.05)], // PW alone should already be enough
    });
    await answerQuery(repos, SCOPE, "What is the room rent limit?", []);
    expect(findSimilarSpy).toHaveBeenCalledTimes(1);
    expect(findSimilarSpy.mock.calls[0][1].documentTypes).toEqual(["policy_wording"]);
  });

  it("4. Policy Wording unavailable (no Policy Wording resources in scope) — Prospectus can be searched, and stops there once sufficient", async () => {
    mockModelResponse({ answer: "The room rent limit is 1% of Sum Insured per day.", share: "Room rent is capped at 1% of the sum insured, per day." });
    const { repos, findSimilarSpy } = fakeRepos({ chunks: [prospectus(0.1), prospectus(0.2), prospectus(0.3)] }); // no policy_wording chunks at all
    await answerQuery(repos, SCOPE, "What is the room rent limit?", []);
    expect(findSimilarSpy).toHaveBeenCalledTimes(2);
    expect(findSimilarSpy.mock.calls[0][1].documentTypes).toEqual(["policy_wording"]);
    expect(findSimilarSpy.mock.calls[1][1].documentTypes).toEqual(["prospectus"]);
  });

  it("5. Policy Wording insufficient (fewer than 3 strong matches) — Prospectus can be searched", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    const { repos, findSimilarSpy } = fakeRepos({ chunks: [pw(0.1), prospectus(0.1)] }); // only 1 PW match, only 1 Prospectus match — insufficient at every stage, escalates all the way through
    await answerQuery(repos, SCOPE, "What is the room rent limit?", []);
    expect(findSimilarSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(findSimilarSpy.mock.calls[1][1].documentTypes).toEqual(["prospectus"]);
  });

  it("6. Prospectus sufficient — Brochure/other is never searched", async () => {
    mockModelResponse({ answer: "The room rent limit is 1% of Sum Insured per day.", share: "Room rent is capped at 1% of the sum insured, per day." });
    const { repos, findSimilarSpy } = fakeRepos({
      chunks: [pw(0.1), prospectus(0.1), prospectus(0.2), prospectus(0.3), brochure(0.05)],
    });
    await answerQuery(repos, SCOPE, "What is the room rent limit?", []);
    expect(findSimilarSpy).toHaveBeenCalledTimes(2);
    for (const call of findSimilarSpy.mock.calls) {
      expect(call[1].documentTypes).not.toContain("brochure");
    }
  });

  it("7. Existing Special Instruction override-conflict short-circuit is unchanged — no retrieval happens at all", async () => {
    // Two active Override Rules, same topic/scope, genuinely DIFFERENT
    // instruction text — this is what specialInstructions.ts's
    // resolveApplicableInstructions treats as a real conflict (identical
    // text across rows is not a conflict, per its own distinctOverrideTexts
    // check), triggering the pre-existing hard-stop in answerQuery() that
    // returns before FAQ/document retrieval ever runs.
    const conflictingOverride = specialInstructionRow({
      id: 2,
      instructionText: "The Chronic Care Rider CAN be back-dated for this insurer under insurer-approved exceptions.",
    });
    const { repos, findSimilarSpy } = fakeRepos({
      specialInstructions: [specialInstructionRow({ id: 1 }), conflictingOverride],
      chunks: [pw(0.1), pw(0.1), pw(0.1)],
      faqs: [moderateFaq],
    });
    const result = await answerQuery(repos, SCOPE, "Can the Chronic Care Rider be back-dated for this insurer?", []);
    expect(findSimilarSpy).not.toHaveBeenCalled();
    expect(result.answer).toContain("more than one active Special Instruction");
  });

  it("8. Insurer/plan isolation — the same scoped categoryIds are passed to every retrieval stage, never widened", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    const { repos, findSimilarSpy } = fakeRepos({ chunks: [pw(0.1), prospectus(0.1)] });
    await answerQuery(repos, SCOPE, "What is the room rent limit?", []);
    expect(findSimilarSpy.mock.calls.length).toBeGreaterThan(0);
    for (const call of findSimilarSpy.mock.calls) {
      expect(call[1].categoryIds).toEqual([SCOPE.categoryId]);
    }
  });

  it("9. General scope (no insurer selected) — document-chunk retrieval spans every category in the domain, not just general-type ones", async () => {
    // 2026-09-05 fix: a "General" question (scope.categoryId === null) used
    // to be narrowed to only type:"general" categories, so an insurer's own
    // Policy Wording/Prospectus/Brochure was invisible to it. Locks in that
    // General now searches every category in the domain — insurer AND
    // general alike — same domain isolation, just no longer also restricted
    // to one category type within it.
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    const insurerCategory = categoryRow({ id: 1, type: "insurer", name: "TestInsurer" });
    const generalCategory = categoryRow({ id: 2, type: "general", name: "General", planNames: [] });
    const { repos, findSimilarSpy } = fakeRepos({
      categories: [insurerCategory, generalCategory],
      chunks: [pw(0.1), pw(0.1), pw(0.1)], // 3 strong PW matches — sufficient, stops after stage 1
    });
    const generalScope = { categoryId: null, planTags: [] };
    await answerQuery(repos, generalScope, "What is the room rent limit?", []);
    expect(findSimilarSpy).toHaveBeenCalled();
    for (const call of findSimilarSpy.mock.calls) {
      expect(call[1].categoryIds).toEqual(expect.arrayContaining([insurerCategory.id, generalCategory.id]));
      expect(call[1].categoryIds).toHaveLength(2);
    }
  });

  it("10. General scope + insurer named (no plan) — retrieval narrows to just that insurer's category, not the whole domain", async () => {
    // 2026-09: a General question naming a bare insurer (no specific plan)
    // now focuses retrieval to that insurer's own category instead of
    // searching every category in the domain — see
    // detectDomainWideCategoryMatches's comment. Counterpart to test 9 above
    // (which locks in the UNNARROWED case, where nothing was named).
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    const testInsurer = categoryRow({ id: 1, type: "insurer", name: "TestInsurer" });
    const otherInsurer = categoryRow({ id: 3, type: "insurer", name: "OtherInsurer", planNames: [] });
    const { repos, findSimilarSpy } = fakeRepos({
      categories: [testInsurer, otherInsurer],
      chunks: [pw(0.1), pw(0.1), pw(0.1)],
    });
    await answerQuery(repos, { categoryId: null, planTags: [] }, "What is the room rent limit for TestInsurer?", []);
    expect(findSimilarSpy).toHaveBeenCalled();
    for (const call of findSimilarSpy.mock.calls) {
      expect(call[1].categoryIds).toEqual([testInsurer.id]);
    }
  });
});

describe("Product Assist meta — per-query model tracking (2026-09)", () => {
  it("captures the actual resolved model from response.modelVersion when the SDK provides it", async () => {
    mockModelResponse({ answer: "Room rent is 1% of Sum Insured per day.", share: "Room rent is capped at 1% of the sum insured, per day." }, "gemini-2.5-flash-002");
    const repos = fakeReposOnly({ chunks: [chunk("Room rent capped at 1% of Sum Insured per day.")] });
    const result = await answerQuery(repos, SCOPE, "What is the room rent limit?", []);
    expect(result.meta.modelName).toBe("gemini-2.5-flash-002");
  });

  it("falls back to the requested GENERATION_MODEL alias when the SDK response omits modelVersion", async () => {
    mockModelResponse({ answer: "Room rent is 1% of Sum Insured per day.", share: "Room rent is capped at 1% of the sum insured, per day." }); // no modelVersion passed
    const repos = fakeReposOnly({ chunks: [chunk("Room rent capped at 1% of Sum Insured per day.")] });
    const result = await answerQuery(repos, SCOPE, "What is the room rent limit?", []);
    expect(result.meta.modelName).toBe("gemini-2.5-flash");
  });

  it("is null for the deterministic Special-Instruction-conflict answer, since no AI call is made", async () => {
    const conflictingRules = [
      specialInstructionRow({ id: 1, instructionText: "The Chronic Care Rider may never be back-dated for this insurer." }),
      specialInstructionRow({ id: 2, instructionText: "The Chronic Care Rider can be back-dated up to 30 days for this insurer." }),
    ];
    const repos = fakeReposOnly({ specialInstructions: conflictingRules });
    const result = await answerQuery(repos, SCOPE, "Can the Chronic Care Rider be back-dated?", []);
    expect(result.meta.modelName).toBeNull();
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ORG CONSTITUTION SUFFICIENCY GATE (2026-08, widened then partly reverted
// TWICE in 2026-09) — an exact Ditto FAQ match takes precedence over
// DOCUMENT EXCERPTS, and once one is found, the lookup should stop —
// applies uniformly regardless of scope mode (General/insurer-only/
// plan-selected) and both Health/Term domains (this file only exercises
// Health; Term shares the exact same answerQuery code path — see
// SYSTEM_INSTRUCTION_TERM tests elsewhere in this file for the
// domain-selection wiring itself). See "Progressive source-priority
// retrieval" tests 1/2 above for the FAQ-only gate itself. Neither Special
// Instruction override rules nor Playbook facts are part of this gate —
// both were tried and reverted the same month after measurably reducing
// answer quality in production (see productAssist.ts's OVERRIDE RULE
// SUFFICIENCY RISK and PLAYBOOK SUFFICIENCY RISK comments): neither has a
// per-topic relevance score strict enough to safely guarantee "this fully
// answers the question" rather than merely "this is topically related" —
// TOPIC_RELEVANCE_THRESHOLD (0.55) in particular is far looser than FAQ's
// deliberately strict 0.85, and a real advisor question is often compound
// (e.g. "is X covered, AND are non-payable items covered within X?") where
// an override rule matching only the first half would otherwise swallow
// retrieval for the whole question.
// ─────────────────────────────────────────────────────────────────────────
describe("ORG CONSTITUTION SUFFICIENCY GATE", () => {
  function pw(distance: number, content = "Policy Wording excerpt") {
    return chunk(content, { documentType: "policy_wording", distance });
  }

  it("an applicable Special Instruction override rule alone never skips document-chunk retrieval — it's still delivered at top authority, but retrieval always runs alongside it", async () => {
    // Real production case: an Activ One Max override rule about Day Care
    // Treatment matched (via the loose 0.55 topic-similarity bar) a compound
    // question that also asked about non-payable items within Day Care —
    // a topic the override rule never addressed. With the override rule
    // gating retrieval, the model had zero document evidence for that
    // second half and could only say "not specified," even though a Policy
    // Wording clause may have covered it. Retrieval must always run so the
    // model has a real chance at the part the override rule is silent on —
    // SOURCE PRECEDENCE #0's own exclusivity language ("COMPLETE and
    // EXCLUSIVE... for that same topic") is what keeps the override rule
    // authoritative on its own topic, not this gate.
    mockModelResponse({
      answer: "No. Per Ditto's override policy, the Chronic Care Rider can never be back-dated for this insurer, regardless of what the policy wording implies.",
      share: "No, this can't be back-dated.",
    });
    const { repos, findSimilarSpy } = fakeRepos({
      specialInstructions: [specialInstructionRow()],
      chunks: [pw(0.1), pw(0.1), pw(0.1)],
    });
    await answerQuery(repos, SCOPE, "Can the Chronic Care Rider be back-dated for this insurer?", []);
    expect(findSimilarSpy).toHaveBeenCalled();
  });

  it("Playbook facts alone never skip document-chunk retrieval, regardless of scope mode", async () => {
    // 2026-09: previously, a genuinely matched plan's Playbook facts alone
    // could trip this gate and skip Policy Wording/Prospectus/Brochure
    // retrieval entirely. Reverted on direct user feedback — see PLAYBOOK
    // SUFFICIENCY RISK in productAssist.ts. Playbook facts have no
    // per-topic relevance score (unlike the FAQ's questionEmbedding-based
    // score), so "the matched plan has ANY Playbook facts" was never a
    // trustworthy "this exact topic is settled" signal. Document-chunk
    // retrieval must always run alongside Playbook facts now.
    mockModelResponse({ answer: "Restoration benefit: confirmed live for this plan, unlimited restorations.", share: "Yes, this is covered." });
    const { repos, findSimilarSpy } = fakeRepos({
      playbookFacts: [playbookFact({ content: "Restoration benefit: confirmed live for this plan, unlimited restorations." })],
      chunks: [pw(0.1), pw(0.1), pw(0.1)],
    });
    await answerQuery(repos, SCOPE, "Does Activ One Max have a restoration benefit?", []);
    expect(findSimilarSpy).toHaveBeenCalled();
  });

  it("scope context (resolved insurer/plan name) is folded into the embedded retrieval text even when the advisor never typed it — fixes FAQ-matching inconsistency across scope modes", async () => {
    // Root cause of the original bug report: a UI-selected plan/insurer
    // wasn't part of the text that got embedded, so the exact same
    // underlying question scored differently against the FAQ purely
    // depending on whether the advisor happened to type the plan name
    // themselves (General scope) or picked it via the UI (plan-selected
    // scope) — making the FAQ sufficiency gate fire inconsistently for what
    // was really the same question. Folding scope.categoryId's resolved
    // name + effectivePlanTags into the embedded text fixes that.
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    const repos = fakeReposOnly({});
    await answerQuery(repos, SCOPE, "Is Maternity covered?", []); // names neither "TestInsurer" nor "Activ One Max" directly
    const embeddedTexts = embedContentMock.mock.calls[0][0].contents as string[];
    expect(embeddedTexts[0]).toContain("TestInsurer");
    expect(embeddedTexts[0]).toContain("Activ One Max");
  });
});

describe("Product Assist synthesis — no regression (validation case 9)", () => {
  it("a straightforward, already-correct detail answer still passes through unchanged, and internal synthesis never leaks to the client", async () => {
    mockModelResponse({
      synthesis: {
        requirement: "Room rent capped at 1% of Sum Insured per day",
        userFacts: "",
        comparison: "NO_REQUIREMENT_FOUND n/a — factual lookup, no eligibility comparison needed",
        resolution: "SATISFIED",
      },
      answer: "The room rent limit for Activ One Max is capped at 1% of Sum Insured per day.\n\n**References**\n- Policy Wording, Section 3.1",
      share: "Room rent is capped at 1% of the sum insured, per day.",
    });
    const result = await answerQuery(fakeReposOnly({ chunks: [chunk("Section 3.1: Room rent capped at 1% of Sum Insured per day.")] }), SCOPE, "What is the room rent limit for Activ One Max?", []);

    expect(result.answer).toContain("capped at 1% of Sum Insured per day");
    expect(result.share).toBe("Room rent is capped at 1% of the sum insured, per day.");
    expect(result.hadNoMatches).toBe(false);
    expect(result.sources).toHaveLength(1);
    // The internal reasoning workspace must never be forwarded to the client.
    expect(result).not.toHaveProperty("synthesis");
    expect(JSON.stringify(result)).not.toContain("NO_REQUIREMENT_FOUND n/a");
  });
});

describe("Unresolved Queries — hadNoMatches also fires on a post-retrieval NO_REQUIREMENT_FOUND (2026-09)", () => {
  // Real production bug: retrieval finding *something* (the right insurer's
  // chunks) doesn't mean any of it actually addresses the specific question
  // asked — e.g. a category match pulls in policy wording for the right
  // plan, but nothing in it covers the specific rider the advisor asked
  // about. Before this fix, hadNoMatches only looked at whether retrieval
  // came back completely empty, so this everyday "the model politely said
  // it doesn't know" case never got auto-recorded into Unresolved Queries.
  it("retrieval finds chunks, but the model's own synthesis.resolution is NO_REQUIREMENT_FOUND -> hadNoMatches is still true", async () => {
    mockModelResponse({
      synthesis: {
        requirement: "",
        userFacts: "Cancer cover for women",
        comparison: "UNCLEAR — no source mentions this rider",
        resolution: "NO_REQUIREMENT_FOUND",
      },
      answer: "The provided source content does not contain information about a specific \"Cancer cover for women\" rider for this plan.",
      share: null,
    });
    const result = await answerQuery(
      fakeReposOnly({ chunks: [chunk("Some unrelated policy wording excerpt about room rent.")] }),
      SCOPE,
      "Cancer cover for women",
      []
    );

    expect(result.hadNoMatches).toBe(true);
    // Confirms this is genuinely the post-retrieval case, not the pre-
    // existing zero-retrieval one — retrieval found a chunk.
    expect(result.sources).toHaveLength(1);
  });

  it("retrieval finds chunks and synthesis.resolution is SATISFIED -> hadNoMatches stays false (no regression)", async () => {
    mockModelResponse({
      synthesis: { requirement: "Room rent capped", userFacts: "", comparison: "", resolution: "SATISFIED" },
      answer: "Room rent is capped at 1% of Sum Insured per day.",
      share: "Room rent is capped at 1% of the sum insured, per day.",
    });
    const result = await answerQuery(fakeReposOnly({ chunks: [chunk("Room rent capped at 1% of Sum Insured per day.")] }), SCOPE, "What is the room rent limit?", []);
    expect(result.hadNoMatches).toBe(false);
  });
});

describe("Term domain wiring (2026-09)", () => {
  it("defaults to the Health system instruction when no domain is passed — byte-identical behavior for every existing caller", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    await answerQuery(fakeReposOnly(), SCOPE, "Any question", []);
    expect(generateContentMock.mock.calls[0][0].config.systemInstruction).toBe(SYSTEM_INSTRUCTION);
  });

  it("selects the Term system instruction when domain is Term", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    await answerQuery(fakeReposOnly(), SCOPE, "Any question", [], "Term");
    expect(generateContentMock.mock.calls[0][0].config.systemInstruction).toBe(SYSTEM_INSTRUCTION_TERM);
    expect(generateContentMock.mock.calls[0][0].config.systemInstruction).not.toBe(SYSTEM_INSTRUCTION);
  });

  it("SYSTEM_INSTRUCTION_TERM carries the Term-insurance persona and a Term-relevant worked example, not Health's", () => {
    expect(SYSTEM_INSTRUCTION_TERM).toContain("Term Insurance Product Expert");
    expect(SYSTEM_INSTRUCTION_TERM).not.toContain("Health Insurance Product Expert");
    expect(SYSTEM_INSTRUCTION_TERM).toContain("Myocardial Infarction of Specified Severity");
    expect(SYSTEM_INSTRUCTION_TERM).toContain("EVIDENCE → RULE → CONDITION → CONCLUSION");
  });

  it("fetches Term FAQ (term_faq_records) rather than the Health FAQ when domain is Term", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    await answerQuery(
      fakeReposOnly({
        // A Health FAQ row present too — must NOT be picked up for a Term query.
        faqs: [faqRow({ question: "Health-only FAQ question", answer: "Health-only FAQ answer" })],
        termFaqs: [termFaqRow({ question: "Term-only FAQ question", answer: "Term-only FAQ answer" })],
      }),
      SCOPE,
      "Can we do mid-term inclusion through Ditto?",
      [],
      "Term"
    );
    const promptText = generateContentMock.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).toContain("Term-only FAQ question");
    expect(promptText).not.toContain("Health-only FAQ question");
  });

  it("fetches Term Playbook plan facts (not skipped) for a Term query with a plan in scope, scoped to the Term domain", async () => {
    // 2026-09: a real Term Playbook now exists (see termPlaybookIngest.ts) —
    // this replaces the old "skips the Product Playbook fetch entirely for
    // Term" test from when Term was FAQ-only.
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    const findMatchingSpy = vi.fn(async (_insurerName: string, _planTags: string[], _domain: "Health" | "Term") => [playbookFact({ domain: "Term" })]);
    const repos = {
      kbCategories: { list: async () => [categoryRow()] },
      kbResources: { list: async () => [] },
      kbChunks: { findSimilar: async () => [] },
      kbPlaybookPlanFacts: { findMatching: findMatchingSpy },
      faqRecords: { listAnswerableActive: async () => [] },
      termFaqRecords: { listAnswerableActive: async () => [] },
      specialInstructions: { listActive: async () => [] },
      kbAcronyms: { listActive: async () => [] },
    } as unknown as Repositories;

    await answerQuery(repos, SCOPE, "What's the bonus for Activ One Max?", [], "Term");

    expect(findMatchingSpy).toHaveBeenCalledTimes(1);
    expect(findMatchingSpy.mock.calls[0][2]).toBe("Term");
  });

  it("scopes the Health Playbook fetch to the Health domain (default caller)", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    const findMatchingSpy = vi.fn(async (_insurerName: string, _planTags: string[], _domain: "Health" | "Term") => [playbookFact()]);
    const repos = {
      kbCategories: { list: async () => [categoryRow()] },
      kbResources: { list: async () => [] },
      kbChunks: { findSimilar: async () => [] },
      kbPlaybookPlanFacts: { findMatching: findMatchingSpy },
      faqRecords: { listAnswerableActive: async () => [] },
      termFaqRecords: { listAnswerableActive: async () => [] },
      specialInstructions: { listActive: async () => [] },
      kbAcronyms: { listActive: async () => [] },
    } as unknown as Repositories;

    await answerQuery(repos, SCOPE, "What's the bonus for Activ One Max?", []);

    expect(findMatchingSpy).toHaveBeenCalledTimes(1);
    expect(findMatchingSpy.mock.calls[0][2]).toBe("Health");
  });
});

describe("General-scope domain-wide plan detection (2026-09-07)", () => {
  // Regression coverage for the bug where a "General" question (no insurer
  // picked via the UI) that nonetheless named a specific plan directly in
  // its text — or asked a broad, no-plan-named, multi-insurer question —
  // never triggered a Product Playbook lookup at all, because the fetch was
  // gated behind scope.categoryId !== null. See detectDomainWidePlanMatches.
  const axisCategory = categoryRow({
    id: 10,
    name: "Axis Max Life",
    planNames: ["Axis Max Life Smart Term Plan Plus"],
  });
  const hdfcCategory = categoryRow({
    id: 20,
    name: "HDFC Life",
    planNames: ["HDFC Life Click 2 Protect Supreme"],
  });
  const generalScope = { categoryId: null, planTags: [] };

  it("a General question naming a specific plan fetches that plan's Playbook facts, scoped to its own owning category", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    const findMatchingSpy = vi.fn(async (_insurerName: string, _planTags: string[], _domain: "Health" | "Term") => [
      playbookFact({ insurerName: "Axis Max Life", planName: "Axis Max Life Smart Term Plan Plus" }),
    ]);
    const repos = {
      kbCategories: { list: async () => [axisCategory, hdfcCategory] },
      kbResources: { list: async () => [] },
      kbChunks: { findSimilar: async () => [] },
      kbPlaybookPlanFacts: { findMatching: findMatchingSpy },
      faqRecords: { listAnswerableActive: async () => [] },
      termFaqRecords: { listAnswerableActive: async () => [] },
      specialInstructions: { listActive: async () => [] },
      kbAcronyms: { listActive: async () => [] },
    } as unknown as Repositories;

    const result = await answerQuery(repos, generalScope, "Is there a lifetime discount in Axis Max Life Smart Term Plan Plus?", []);

    expect(findMatchingSpy).toHaveBeenCalledTimes(1);
    expect(findMatchingSpy.mock.calls[0][0]).toBe("Axis Max Life");
    expect(findMatchingSpy.mock.calls[0][1]).toEqual(["Axis Max Life Smart Term Plan Plus"]);
    expect(result.meta.playbookFactCount).toBe(1);

    // SELECTED SCOPE line must also surface the domain-detected plan, per
    // buildScopeLine's General-with-detected-plan branch.
    const promptText = generateContentMock.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).toContain("Axis Max Life Smart Term Plan Plus");
  });

  it("plans named from two different categories in one General question are looked up per owning category, never cross-matched", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    const findMatchingSpy = vi.fn(async (insurerName: string, _planTags: string[], _domain: "Health" | "Term") => [
      playbookFact({ insurerName, planName: insurerName === "Axis Max Life" ? "Axis Max Life Smart Term Plan Plus" : "HDFC Life Click 2 Protect Supreme" }),
    ]);
    const repos = {
      kbCategories: { list: async () => [axisCategory, hdfcCategory] },
      kbResources: { list: async () => [] },
      kbChunks: { findSimilar: async () => [] },
      kbPlaybookPlanFacts: { findMatching: findMatchingSpy },
      faqRecords: { listAnswerableActive: async () => [] },
      termFaqRecords: { listAnswerableActive: async () => [] },
      specialInstructions: { listActive: async () => [] },
      kbAcronyms: { listActive: async () => [] },
    } as unknown as Repositories;

    const result = await answerQuery(
      repos,
      generalScope,
      "How do Axis Max Life Smart Term Plan Plus and HDFC Life Click 2 Protect Supreme compare on discounts?",
      []
    );

    expect(findMatchingSpy).toHaveBeenCalledTimes(2);
    const callsByInsurer = new Map(findMatchingSpy.mock.calls.map(c => [c[0], c[1]]));
    expect(callsByInsurer.get("Axis Max Life")).toEqual(["Axis Max Life Smart Term Plan Plus"]);
    expect(callsByInsurer.get("HDFC Life")).toEqual(["HDFC Life Click 2 Protect Supreme"]);
    expect(result.meta.playbookFactCount).toBe(2);
  });

  it("a General question naming no plan at all falls back to every plan's Playbook facts for the domain, not findMatching", async () => {
    // 2026-09-07: broad fallback — a question this generic has no single
    // plan for findMatching's insurer/plan-tag narrowing to key off, so
    // listAllForDomain() is used instead, unconditionally, rather than
    // silently including nothing.
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    const findMatchingSpy = vi.fn(async (_insurerName: string, _planTags: string[], _domain: "Health" | "Term") => [playbookFact()]);
    const listAllForDomainSpy = vi.fn(async (_domain: "Health" | "Term") => [
      playbookFact({ insurerName: "Axis Max Life", planName: "Axis Max Life Smart Term Plan Plus", content: "Axis discount facts." }),
      playbookFact({ insurerName: "HDFC Life", planName: "HDFC Life Click 2 Protect Supreme", content: "HDFC discount facts." }),
    ]);
    const repos = {
      kbCategories: { list: async () => [axisCategory, hdfcCategory] },
      kbResources: { list: async () => [] },
      kbChunks: { findSimilar: async () => [] },
      kbPlaybookPlanFacts: { findMatching: findMatchingSpy, listAllForDomain: listAllForDomainSpy },
      faqRecords: { listAnswerableActive: async () => [] },
      termFaqRecords: { listAnswerableActive: async () => [] },
      specialInstructions: { listActive: async () => [] },
      kbAcronyms: { listActive: async () => [] },
    } as unknown as Repositories;

    const result = await answerQuery(repos, generalScope, "What are the various discounts offered by the insurers?", []);

    expect(findMatchingSpy).not.toHaveBeenCalled();
    expect(listAllForDomainSpy).toHaveBeenCalledTimes(1);
    expect(listAllForDomainSpy.mock.calls[0][0]).toBe("Health");
    expect(result.meta.playbookFactCount).toBe(2);
    const promptText = generateContentMock.mock.calls[0][0].contents[0].parts[0].text;
    expect(promptText).toContain("Axis discount facts.");
    expect(promptText).toContain("HDFC discount facts.");
  });

  it("scopes the broad no-plan fallback to the Term domain when domain is Term", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    const listAllForDomainSpy = vi.fn(async (_domain: "Health" | "Term") => [playbookFact({ domain: "Term" })]);
    const repos = {
      kbCategories: { list: async () => [axisCategory, hdfcCategory] },
      kbResources: { list: async () => [] },
      kbChunks: { findSimilar: async () => [] },
      kbPlaybookPlanFacts: { findMatching: vi.fn(), listAllForDomain: listAllForDomainSpy },
      faqRecords: { listAnswerableActive: async () => [] },
      termFaqRecords: { listAnswerableActive: async () => [] },
      specialInstructions: { listActive: async () => [] },
      kbAcronyms: { listActive: async () => [] },
    } as unknown as Repositories;

    await answerQuery(repos, generalScope, "What are the various discounts offered by the insurers?", [], "Term");

    expect(listAllForDomainSpy).toHaveBeenCalledTimes(1);
    expect(listAllForDomainSpy.mock.calls[0][0]).toBe("Term");
  });

  it("an insurer-scoped question is unaffected — still a single findMatching call against the selected category only", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    const findMatchingSpy = vi.fn(async (_insurerName: string, _planTags: string[], _domain: "Health" | "Term") => [playbookFact()]);
    const repos = {
      kbCategories: { list: async () => [categoryRow()] },
      kbResources: { list: async () => [] },
      kbChunks: { findSimilar: async () => [] },
      kbPlaybookPlanFacts: { findMatching: findMatchingSpy },
      faqRecords: { listAnswerableActive: async () => [] },
      termFaqRecords: { listAnswerableActive: async () => [] },
      specialInstructions: { listActive: async () => [] },
      kbAcronyms: { listActive: async () => [] },
    } as unknown as Repositories;

    await answerQuery(repos, SCOPE, "What's the bonus for Activ One Max?", []);

    expect(findMatchingSpy).toHaveBeenCalledTimes(1);
  });

  // 2026-09 regression fix — the live wrong-answer report: an insurer IS
  // selected via the UI (e.g. "Care Health") but no plan is picked and none
  // is detectable in the question text. findMatching short-circuits to []
  // whenever planTags is empty (by design), and the pre-fix code had no
  // other branch covering "categoryId set, no plan" — so playbookFacts
  // stayed [], and the question silently fell through to Prospectus-only
  // document-chunk retrieval even though the insurer itself was known. This
  // asserts findAllForInsurer (not findMatching) is what now covers it.
  it("an insurer-scoped question with NO plan selected or detected falls back to every plan's Playbook facts for that insurer via findAllForInsurer", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    const findMatchingSpy = vi.fn(async (_insurerName: string, _planTags: string[], _domain: "Health" | "Term") => []);
    const findAllForInsurerSpy = vi.fn(async (_insurerName: string, _domain: "Health" | "Term") => [
      playbookFact({ planName: "Care Supreme", content: "Restoration triggers on partial exhaustion." }),
      playbookFact({ planName: "Care Freedom", content: "Restoration triggers on partial exhaustion, once a year." }),
    ]);
    const repos = {
      kbCategories: { list: async () => [categoryRow()] },
      kbResources: { list: async () => [] },
      kbChunks: { findSimilar: async () => [] },
      kbPlaybookPlanFacts: { findMatching: findMatchingSpy, findAllForInsurer: findAllForInsurerSpy },
      faqRecords: { listAnswerableActive: async () => [] },
      termFaqRecords: { listAnswerableActive: async () => [] },
      specialInstructions: { listActive: async () => [] },
      kbAcronyms: { listActive: async () => [] },
    } as unknown as Repositories;

    const result = await answerQuery(repos, { categoryId: 1, planTags: [] }, "How does the restoration benefit work?", []);

    expect(findMatchingSpy).not.toHaveBeenCalled();
    expect(findAllForInsurerSpy).toHaveBeenCalledTimes(1);
    expect(findAllForInsurerSpy.mock.calls[0][0]).toBe("TestInsurer");
    expect(findAllForInsurerSpy.mock.calls[0][1]).toBe("Health");
    expect(result.meta.playbookFactCount).toBe(2);
    const promptText = generateContentMock.mock.calls[0][0].contents[0].parts[0].text as string;
    expect(promptText).toContain("Restoration triggers on partial exhaustion.");
    expect(promptText).toContain("Restoration triggers on partial exhaustion, once a year.");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Insurance Fundamentals (2026-09) — a dedicated, domain-scoped conceptual-
// knowledge layer (kb_categories.type === "fundamentals"), retrieved via its
// own always-on, bounded, relevance-thresholded channel (see
// retrieveFundamentalsChunks in productAssist.ts), independent of
// scope.categoryId and never blended into the normal Policy Wording ->
// Prospectus -> Brochure/other staged retrieval.
//
// Note on domain isolation (requirement: Fundamentals must never leak
// across Health/Term): actual domain scoping happens inside
// KbCategoriesRepository.list({ domain }) — a real SQL WHERE clause, tested
// separately and untouched by this feature — which is the SAME mechanism
// every other domain-scoped source in this file already trusts (categoryIds
// resolution, Playbook lookups, FAQ table selection, etc., none of which
// re-check domain themselves either). fakeRepos's mocked kbCategories.list
// ignores the domain argument entirely (returns cfg.categories verbatim,
// same as it always has), so these tests validate what THIS feature's own
// code controls — TYPE-based filtering/scoping on whatever categories list
// it's handed — rather than re-testing the repository's domain WHERE clause.
// ─────────────────────────────────────────────────────────────────────────
describe("Insurance Fundamentals (2026-09)", () => {
  function fundamentalsCategoryRow(overrides: Partial<KbCategoryRow> = {}): KbCategoryRow {
    return categoryRow({
      id: 9,
      name: "Insurance Fundamentals",
      type: "fundamentals",
      planNames: [],
      ...overrides,
    });
  }
  function fundamentalsChunk(content: string, overrides: Partial<SimilarKbChunk> = {}) {
    return chunk(content, {
      categoryId: 9,
      documentType: "other",
      resourceTitle: "Understanding Health Insurance: Fundamentals, Coverage, Benefits and Policy Relationships",
      distance: 0.1, // well inside FUNDAMENTALS_RELEVANCE_DISTANCE (0.55)
      ...overrides,
    });
  }

  it("SYSTEM_INSTRUCTION and SYSTEM_INSTRUCTION_TERM both define INSURANCE FUNDAMENTALS as the lowest-ranked, non-authoritative source", () => {
    for (const instruction of [SYSTEM_INSTRUCTION, SYSTEM_INSTRUCTION_TERM]) {
      expect(instruction).toContain("5. INSURANCE FUNDAMENTALS");
      expect(instruction).toContain("Always the lowest-ranked source of any kind");
      expect(instruction).toContain(
        "never as the source of this specific product's actual coverage, benefit, limit, exclusion, waiting period, restoration rule, utilisation sequence, or any other product-specific outcome"
      );
    }
  });

  // 2026-09: real-world case where OS (Optima Secure) Policy Wording still
  // described a discontinued "Cumulative Bonus" clause the insurer has since
  // replaced with a "Plus" benefit the Playbook records — Policy Wording can
  // go stale in a way the Playbook/FAQ/Special Instructions don't, so both
  // domains must tell the model to treat the latter as current and
  // controlling over Policy Wording whenever a plan is selected.
  it("SYSTEM_INSTRUCTION and SYSTEM_INSTRUCTION_TERM both instruct that Playbook/Ditto FAQ/Special Instructions outrank Policy Wording as the current source of truth for a selected plan", () => {
    for (const instruction of [SYSTEM_INSTRUCTION, SYSTEM_INSTRUCTION_TERM]) {
      expect(instruction).toContain("CURRENT SOURCE OF TRUTH");
      expect(instruction).toContain("ahead of Policy Wording, Prospectus, Brochure, or any other DOCUMENT EXCERPT");
      expect(instruction).toContain(
        "do not let a Policy Wording passage on that same topic add to, soften, or contradict it, no matter how detailed or official-sounding the Policy Wording passage is"
      );
      expect(instruction).toContain("apply it the same way for both Health and Term plans");
    }
  });

  it("retrieved even when an insurer/plan is already selected (not limited to General/no-insurer questions)", async () => {
    mockModelResponse({ answer: "A waiting period is a period during which certain claims cannot be made.", share: "There's a waiting period before some claims can be made." });
    const result = await answerQuery(
      fakeReposOnly({
        categories: [categoryRow(), fundamentalsCategoryRow()],
        chunks: [
          chunk("Section 3.1: Room rent capped at 1% of Sum Insured per day.", { categoryId: 1 }),
          fundamentalsChunk("A waiting period is a duration after policy start during which certain claims are not payable."),
        ],
      }),
      SCOPE, // insurer + plan already selected
      "What is a waiting period?",
      []
    );
    const promptText = generateContentMock.mock.calls[0][0].contents[0].parts[0].text as string;
    expect(promptText).toContain("=== INSURANCE FUNDAMENTALS");
    expect(promptText).toContain("A waiting period is a duration after policy start");
    expect(result.meta.fundamentalsChunkCount).toBe(1);
  });

  it("kept out of DOCUMENT EXCERPTS / the Sources panel entirely — never a citable document like a policy PDF", async () => {
    mockModelResponse({
      answer: "Room rent is capped at 1% of Sum Insured per day.\n\n**References**\n- Policy Wording, Section 3.1",
      citedDocumentTitles: ["Policy Wording A"],
      share: "Room rent is capped at 1% of the sum insured, per day.",
    });
    const result = await answerQuery(
      fakeReposOnly({
        categories: [categoryRow(), fundamentalsCategoryRow()],
        chunks: [
          chunk("Section 3.1: Room rent capped at 1% of Sum Insured per day.", { categoryId: 1, resourceTitle: "Policy Wording A" }),
          fundamentalsChunk("Room rent generally refers to the daily hospital accommodation charge."),
        ],
      }),
      SCOPE,
      "What is the room rent limit?",
      []
    );
    expect(result.sources.map(s => s.title)).toEqual(["Policy Wording A"]);
    expect(result.sources.map(s => s.title)).not.toContain(
      "Understanding Health Insurance: Fundamentals, Coverage, Benefits and Policy Relationships"
    );
  });

  it("excluded from the normal staged product-document retrieval pool, even for a General (no insurer selected) question — retrieved only through its own dedicated call", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    const insurerCategory = categoryRow({ id: 1, type: "insurer", name: "TestInsurer" });
    const generalCategory = categoryRow({ id: 2, type: "general", name: "General", planNames: [] });
    const fundamentals = fundamentalsCategoryRow({ id: 3 });
    const { repos, findSimilarSpy } = fakeRepos({
      categories: [insurerCategory, generalCategory, fundamentals],
      chunks: [
        chunk("Policy Wording excerpt", { categoryId: 1, documentType: "policy_wording", distance: 0.1 }),
        chunk("Policy Wording excerpt", { categoryId: 1, documentType: "policy_wording", distance: 0.1 }),
        chunk("Policy Wording excerpt", { categoryId: 1, documentType: "policy_wording", distance: 0.1 }),
        fundamentalsChunk("Fundamentals excerpt", { categoryId: 3 }),
      ],
    });
    await answerQuery(repos, { categoryId: null, planTags: [] }, "What is the room rent limit?", []);

    const stagedCalls = findSimilarSpy.mock.calls.filter(c => (c[1] as { documentTypes?: unknown }).documentTypes);
    expect(stagedCalls.length).toBeGreaterThan(0);
    for (const call of stagedCalls) {
      const categoryIds = call[1].categoryIds as number[];
      expect(categoryIds).toEqual(expect.arrayContaining([insurerCategory.id, generalCategory.id]));
      expect(categoryIds).not.toContain(fundamentals.id);
    }

    const fundamentalsCalls = findSimilarSpy.mock.calls.filter(c => !(c[1] as { documentTypes?: unknown }).documentTypes);
    expect(fundamentalsCalls).toHaveLength(1);
    expect(fundamentalsCalls[0][1].categoryIds).toEqual([fundamentals.id]);
  });

  it("a chunk beyond the relevance-distance threshold is dropped — an unrelated question retrieves nothing extra", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    const result = await answerQuery(
      fakeReposOnly({
        categories: [categoryRow(), fundamentalsCategoryRow()],
        chunks: [fundamentalsChunk("Unrelated background content", { distance: 0.9 })], // beyond FUNDAMENTALS_RELEVANCE_DISTANCE (0.55)
      }),
      SCOPE,
      "What is the room rent limit?",
      []
    );
    expect(result.meta.fundamentalsChunkCount).toBe(0);
    const promptText = generateContentMock.mock.calls[0][0].contents[0].parts[0].text as string;
    expect(promptText).not.toContain("INSURANCE FUNDAMENTALS");
  });

  it("no fundamentals category configured — zero extra retrieval calls, byte-identical to before this feature existed", async () => {
    mockModelResponse({ answer: "Room rent is capped at 1% of Sum Insured per day.", share: "Room rent is capped at 1% of the sum insured, per day." });
    const { repos, findSimilarSpy } = fakeRepos({ chunks: [chunk("Section 3.1: Room rent capped at 1% of Sum Insured per day.")] });
    const result = await answerQuery(repos, SCOPE, "What is the room rent limit?", []);
    expect(result.meta.fundamentalsChunkCount).toBe(0);
    const promptText = generateContentMock.mock.calls[0][0].contents[0].parts[0].text as string;
    expect(promptText).not.toContain("INSURANCE FUNDAMENTALS");
    // Every findSimilar call made is a staged product-document call
    // (documentTypes set) — no dedicated categoryIds-only Fundamentals call
    // happened at all, since no fundamentals category exists.
    expect(findSimilarSpy).toHaveBeenCalled();
    for (const call of findSimilarSpy.mock.calls) {
      expect((call[1] as { documentTypes?: unknown }).documentTypes).toBeDefined();
    }
  });

  it("reuses the single query embedding already computed for this question — no extra AI/embedding call for Fundamentals", async () => {
    mockModelResponse({ answer: "A waiting period is a period during which certain claims cannot be made.", share: null });
    await answerQuery(
      fakeReposOnly({
        categories: [categoryRow(), fundamentalsCategoryRow()],
        chunks: [fundamentalsChunk("A waiting period is...")],
      }),
      SCOPE,
      "What is a waiting period?",
      []
    );
    expect(embedContentMock).toHaveBeenCalledTimes(1);
  });

  it("is bounded by its own small retrieval cap, independent of the 24-chunk product-document budget", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    const manyFundamentalsChunks = Array.from({ length: 10 }, (_, i) => fundamentalsChunk(`Fundamentals excerpt ${i}`));
    const { repos, findSimilarSpy } = fakeRepos({
      categories: [categoryRow(), fundamentalsCategoryRow()],
      chunks: manyFundamentalsChunks,
    });
    await answerQuery(repos, SCOPE, "What is a waiting period?", []);
    const fundamentalsCall = findSimilarSpy.mock.calls.find(c => !(c[1] as { documentTypes?: unknown }).documentTypes);
    expect(fundamentalsCall).toBeDefined();
    expect(fundamentalsCall![1].limit).toBeLessThanOrEqual(4);
  });

  it("a purely conceptual General question answered only by Fundamentals content is NOT treated as an unresolved/no-match query", async () => {
    mockModelResponse({
      synthesis: { requirement: "", userFacts: "", comparison: "", resolution: "SATISFIED" },
      answer: "A waiting period is a duration after policy start during which certain claims aren't payable.",
      share: "There's a wait before some claims can be made.",
    });
    const result = await answerQuery(
      fakeReposOnly({
        categories: [fundamentalsCategoryRow()],
        chunks: [fundamentalsChunk("A waiting period is a duration after policy start during which certain claims aren't payable.")],
      }),
      { categoryId: null, planTags: [] },
      "What is a waiting period?",
      []
    );
    const promptText = generateContentMock.mock.calls[0][0].contents[0].parts[0].text as string;
    expect(promptText).not.toContain("(No matching Playbook facts, Ditto FAQ entries, or document excerpts were found");
    expect(result.hadNoMatches).toBe(false);
  });

  it("a product-specific question with only Fundamentals content still surfaces as unresolved once the model itself reports NO_REQUIREMENT_FOUND", async () => {
    mockModelResponse({
      synthesis: { requirement: "", userFacts: "", comparison: "", resolution: "NO_REQUIREMENT_FOUND" },
      answer: "The provided source content does not specify the exact restoration rule for this plan.",
      share: null,
    });
    const result = await answerQuery(
      fakeReposOnly({
        categories: [categoryRow(), fundamentalsCategoryRow()],
        chunks: [fundamentalsChunk("Restoration benefits generally reinstate the sum insured after it's exhausted by a claim.")],
      }),
      SCOPE,
      "What's the exact restoration rule for Activ One Max?",
      []
    );
    expect(result.hadNoMatches).toBe(true);
  });
});
