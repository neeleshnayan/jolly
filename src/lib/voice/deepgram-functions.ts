/**
 * Client-safe tool definitions for the Deepgram Voice Agent (shared by the spike
 * + the prod call hook, so they never drift). Descriptions are deliberately
 * imperative — smaller models like Haiku under-call tools unless the "when" is
 * explicit. Pure data: no server imports, safe in the browser.
 */
export const DEEPGRAM_FUNCTIONS = [
  {
    name: "fetch_recommendations",
    description:
      "Fetch real, current openings for a career direction. Call this ONLY when the user commits to exploring a NEW direction that the roles you were already given don't cover — and only after they've clearly leaned into it, never on a passing mention or a single word. Do NOT call it for directions you can already speak to from your loaded roles. When unsure, don't call it.",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", description: "the career field/direction the user mentioned, e.g. marketing, sales, product, data, design" },
      },
      required: ["direction"],
    },
  },
  {
    name: "open_path",
    description:
      "Call this the moment the user zeroes in on ONE specific role to explore it in depth — it saves that path to their explored list so they can compare and commit later.",
    parameters: {
      type: "object",
      properties: {
        role_title: { type: "string", description: "the exact role title" },
        company: { type: "string", description: "the company" },
      },
      required: ["role_title"],
    },
  },
  {
    name: "introduce_mentor",
    description:
      "ALWAYS call this the instant you name or bring up a specific person from the user's mentor circle (someone who's already made a similar move). It surfaces that person's card on screen. Never say a circle person's name without also calling this — the card is what makes the introduction real.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "the person's full name, e.g. Arjun Mehta" },
        move: { type: "string", description: "their career move in arrow form, e.g. 'Analyst at Goldman Sachs → VP Product at Razorpay'" },
        why: { type: "string", description: "one short line on why they're relevant to this user" },
      },
      required: ["name"],
    },
  },
];
