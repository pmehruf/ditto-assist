/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for the "evidence -> rule -> condition -> conclusion"
 * synthesis fix (see queryAssist.ts's EVIDENCE -> RULE -> CONDITION ->
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
 *   3. Source-hierarchy ordering (Special Instructions > Ditto Constitution
 *      > Document Excerpts) is unchanged by adding the synthesis field.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Repositories } from "../db/repositories/index.js";
import type { KbCategoryRow, SpecialInstructionRow, FaqRecordRow, KbPlaybookPlanFactRow } from "../db/schema.js";
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
const { answerQuery, SYSTEM_INSTRUCTION } = await import("./queryAssist.js");

function mockModelResponse(body: { synthesis?: unknown; answer: string; share: string | null }) {
  generateContentMock.mockResolvedValueOnce({
    text: JSON.stringify({
      synthesis: { requirement: "", userFacts: "", comparison: "", resolution: "SATISFIED" },
      ...body,
    }),
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
  });
}

function categoryRow(overrides: Partial<KbCategoryRow> = {}): KbCategoryRow {
  return {
    id: 1,
    name: "TestInsurer",
    type: "insurer",
    sortOrder: 0,
    planNames: ["Activ One Max"],
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

function playbookFact(overrides: Partial<KbPlaybookPlanFactRow> = {}): KbPlaybookPlanFactRow {
  return {
    id: 1,
    resourceId: 1,
    insurerName: "TestInsurer",
    planName: "Activ One Max",
    sourceTab: "Dittos Recommended Policies",
    content: "Chronic Care Rider covers listed chronic conditions once the insurer's eligibility criteria are met.",
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
    topicEmbedding: FIXED_QUERY_EMBEDDING as unknown as SpecialInstructionRow["topicEmbedding"],
    isActive: true,
    createdBy: "test",
    updatedBy: "test",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SpecialInstructionRow;
}

interface FakeReposConfig {
  categories?: KbCategoryRow[];
  chunks?: SimilarKbChunk[];
  playbookFacts?: KbPlaybookPlanFactRow[];
  faqs?: FaqRecordRow[];
  specialInstructions?: SpecialInstructionRow[];
}

function fakeRepos(cfg: FakeReposConfig = {}): Repositories {
  return {
    kbCategories: { list: async () => cfg.categories ?? [categoryRow()] },
    kbResources: { list: async () => [] },
    kbChunks: { findSimilar: async () => cfg.chunks ?? [] },
    kbPlaybookPlanFacts: { findMatching: async () => cfg.playbookFacts ?? [] },
    faqRecords: { listAnswerableActive: async () => cfg.faqs ?? [] },
    specialInstructions: { listActive: async () => cfg.specialInstructions ?? [] },
  } as unknown as Repositories;
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
    await answerQuery(fakeRepos(), SCOPE, "Any question", []);
    const call = generateContentMock.mock.calls[0][0];
    const schema = call.config.responseSchema;
    expect(schema.required).toEqual(["synthesis", "answer", "share"]);
    expect(schema.propertyOrdering).toEqual(["synthesis", "answer", "share"]);
    expect(schema.properties.synthesis.properties.resolution.enum).toEqual([
      "SATISFIED",
      "NOT_SATISFIED",
      "INSUFFICIENT_INFORMATION",
      "NO_REQUIREMENT_FOUND",
    ]);
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
      fakeRepos({ chunks: [eligibilityChunk], playbookFacts: [playbookFact()] }),
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
      fakeRepos({ chunks: [eligibilityChunk], playbookFacts: [playbookFact()] }),
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
    const result = await answerQuery(fakeRepos({ chunks: [listedConditionChunk] }), SCOPE, "Customer is a Type 2 diabetic on oral medication — eligible for the Chronic Care Rider?", []);
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
    const result = await answerQuery(fakeRepos({ chunks: [eligibilityChunk] }), SCOPE, "Customer only had a diagnostic angiogram — does that meet the Chronic Care Rider requirement?", []);
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
      fakeRepos({
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

  it("case 6 — DITTO CONSTITUTION (FAQ/Playbook) content precedes DOCUMENT EXCERPTS content in the prompt, per source hierarchy", async () => {
    mockModelResponse({ answer: "Not specified in available sources.", share: null });
    await answerQuery(
      fakeRepos({
        chunks: [chunk("Some insurer document text that could conflict with the Playbook.")],
        playbookFacts: [playbookFact({ content: "Playbook's own authoritative statement on this topic." })],
        faqs: [faqRow()],
      }),
      SCOPE,
      "What does the Chronic Care Rider cover?",
      []
    );
    const promptText = generateContentMock.mock.calls[0][0].contents[0].parts[0].text as string;
    const constitutionIndex = promptText.indexOf("DITTO CONSTITUTION");
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
    const result = await answerQuery(fakeRepos({ chunks: [chunk("Chronic Care Rider eligibility depends on the exact cardiac procedure performed.")] }), SCOPE, "Customer had a cardiac procedure — is the Chronic Care Rider eligible?", []);
    expect(result.share).toBeNull();
    expect(result.answer).not.toMatch(/^(Yes|No)\./);
  });

  it("case 8 — an applicable override rule is delivered ahead of, and outside, the normal document/Playbook blocks", async () => {
    mockModelResponse({
      answer: "No. Per Ditto's override policy, the Chronic Care Rider can never be back-dated for this insurer, regardless of what the policy wording implies.",
      share: "No, this can't be back-dated.",
    });
    await answerQuery(
      fakeRepos({
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
    const constitutionIndex = promptText.indexOf("DITTO CONSTITUTION");
    expect(overrideIndex).toBeGreaterThan(-1);
    expect(overrideIndex).toBeLessThan(constitutionIndex === -1 ? Infinity : constitutionIndex);
    expect(promptText).toContain("The Chronic Care Rider may never be back-dated");
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
    const result = await answerQuery(fakeRepos({ chunks: [chunk("Section 3.1: Room rent capped at 1% of Sum Insured per day.")] }), SCOPE, "What is the room rent limit for Activ One Max?", []);

    expect(result.answer).toContain("capped at 1% of Sum Insured per day");
    expect(result.share).toBe("Room rent is capped at 1% of the sum insured, per day.");
    expect(result.hadNoMatches).toBe(false);
    expect(result.sources).toHaveLength(1);
    // The internal reasoning workspace must never be forwarded to the client.
    expect(result).not.toHaveProperty("synthesis");
    expect(JSON.stringify(result)).not.toContain("NO_REQUIREMENT_FOUND n/a");
  });
});
