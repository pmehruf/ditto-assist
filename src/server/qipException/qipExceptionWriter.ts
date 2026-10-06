// QIP Exception Request generator — the AI writer's instructions and reply
// handling. Ported from the standalone "QIP Exception Doc Generator" tool
// (netlify/functions/draft.js). The AI writes ONLY the narrative text
// (per-advisor overview/category paragraphs, Background, Conclusion); every
// heading, table, number and Blunder % is produced client-side by
// src/qipException/template.ts, and the page checks the result before the
// .docx can be downloaded. The wording rules below are the original tool's,
// unchanged.

export type QipDraftTask = "advisor" | "shared";

export const QIP_MAX_FACTS_CHARS = 30000;

const STYLE = `
Language rules (very important):
- Write like a team lead explaining things to a colleague. Use very basic, everyday English that anyone can understand, even someone who does not know insurance or quality terms.
- Keep every sentence short, ideally under 18 words and never over 25. One idea per sentence.
- Use simple words. Say "use" not "utilize", "show" not "demonstrate", "help" not "facilitate", "because" not "due to the fact that", "about" not "approximately", "start" not "commence", "got better" not "improved significantly".
- Do not use fancy or corporate words such as: leverage, ensure, robust, holistic, trajectory, pertinent, furthermore, moreover, additionally, notably, overall performance landscape, deviation, aligned, benchmark-compliant, stabilization, underscores, demonstrates, indicates, consistently strong.
- Do not use dashes to join thoughts, semicolons, or lists inside a sentence. Plain full stops only.
- Do not start many sentences the same way. Do not use phrases like "It is worth noting" or "It is important to".
- The words "QA score", "benchmark", "blunder" and "instances" are the team's own words, so you may use them. Explain anything else in plain words.
- It should read as if a real person who knows the advisor wrote it by hand: warm, calm, honest. Not stiff, not salesy, not like an AI.

Examples of the plain style wanted (do not copy these lines):
- "She is new to payments and has only had feedback on a few of them so far."
- "He missed the benchmark by a small gap. Many of his other chats were rated 5."
- "This was already explained to her, and we are keeping an eye on it."
- "Both advisors were close to the benchmark, and their scores are getting better this month."
- "These look like short dips, not a regular problem."`;

const COMMON_RULES = `
You help a program manager write a QIP exception request about advisors. The document is read by senior reviewers.
Rules you must follow:
1. Use ONLY the facts given. Do not invent events, reasons, dates, names, scores or counts.
2. Any number you write must appear in the facts. Do not calculate new numbers. Do not write a number that is not in the facts.
3. Use each advisor's exact name and the pronoun given for that advisor. Do not use any other pronoun for them.
4. Supportive and honest tone. No hype, no filler, no mention of AI. Follow the language rules below exactly.
5. The tool already prints the score, instance, blunder percentage and benchmark-gap lines. Do not repeat those lines.
6. Follow the "Notes and instructions" for the advisor, as long as they do not conflict with rule 1.
7. No placeholders, no square brackets, no markdown, no headings, no bullet points.
8. Reply with a single JSON object and nothing else.
${STYLE}

Writing approach (very important):
- Write short connected paragraphs, like a person explaining the case in a letter. Not a list of separate points.
- Each paragraph tells a small story in order: what the situation is, why it happened, why it is not a regular problem, and what is being done about it.
- Link sentences with simple words such as "because", "so", "but", "since then" and "after that". Do not stack unrelated one-line facts.
- Never say the same thing twice, in one paragraph or across paragraphs. Each paragraph must add something new.
- Only use facts that are given. If a fact such as a reason or a plan is not given, leave it out. Do not guess a reason.
- The tool already prints the score, benchmark gap, blunder percentage and instance counts. Do not restate them as a sentence. Use a number only when comparing, for example this month with an earlier month.`;

export function buildPrompt(task: QipDraftTask, facts: string): { system: string; user: string } {
  if (task === "advisor") {
    return {
      system: `${COMMON_RULES}
Task: write the narrative for ONE advisor.
Return JSON in exactly this shape:
{"overview": ["..."], "categories": {"lead": ["..."], "pay": ["..."]}}
- "overview": exactly 1 paragraph of 3 to 4 sentences about the advisor as a whole: who the advisor is, the situation in plain words, and the reason for the request. Use the notes and the evaluation start date if given.
- "categories": include a key ("lead" for Lead Score, "pay" for Payments) ONLY for categories listed in the facts. Each has exactly 1 paragraph of 2 to 3 sentences about that category only. Say what the past months and the current performance show, and what the blunders were about. Do not repeat the overview. If the facts have no extra detail for a category, write 1 short sentence only.`,
      user: `Facts:\n${facts}`,
    };
  }
  return {
    system: `${COMMON_RULES}
Task: write the Background and the Conclusion for the whole request.
Return JSON in exactly this shape:
{"background": ["..."], "conclusion": ["..."]}
- "background": exactly 1 paragraph of 3 to 4 sentences that sets the scene for the reader. Say who the request is about and what they have in common. Do not list each advisor's numbers.
- "conclusion": exactly 1 paragraph of 3 to 4 sentences. It must not repeat the background. Give the reasons an exception is fair and what happens next (support, feedback, monitoring) only if the facts say so. Do not include the final request sentence. The tool adds it.`,
    user: `Facts:\n${facts}`,
  };
}

export function parseModelJson(text: string): any {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a === -1 || b === -1) throw new Error("No JSON found");
  return JSON.parse(t.slice(a, b + 1));
}

const cleanList = (v: unknown, max: number): string[] =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, max);

export function shape(task: QipDraftTask, obj: any): Record<string, string[]> {
  const o = obj && typeof obj === "object" ? obj : {};
  if (task === "advisor") {
    const cats = o.categories && typeof o.categories === "object" ? o.categories : {};
    return { overview: cleanList(o.overview, 2), lead: cleanList(cats.lead, 2), pay: cleanList(cats.pay, 2) };
  }
  return { background: cleanList(o.background, 2), conclusion: cleanList(o.conclusion, 2) };
}
