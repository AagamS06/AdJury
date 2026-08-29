import type { PersonaName } from "@/lib/schema/juror";

/**
 * Provider-abstracted model client. All persona/orchestrator code depends on
 * this interface only, so the underlying provider can be swapped without
 * touching prompts (Rules.md §2, Architecture.md §5).
 *
 * If AI_API_KEY is unset, the client runs in deterministic MOCK mode so tests
 * and `npm run demo` work offline. Mock output is still real JSON that flows
 * through the same parse + Zod-validate path as a live model.
 */

export interface CompleteArgs {
  system: string;
  user: string;
  /** Persona hint — used only by the mock to shape plausible output. */
  persona: PersonaName;
  temperature?: number;
}

export interface ModelClient {
  readonly model: string;
  readonly isMock: boolean;
  complete(args: CompleteArgs): Promise<string>;
}

function env(key: string, fallback = ""): string {
  return process.env[key]?.trim() || fallback;
}

/** Build the client from environment. Anthropic when a key is present, else mock. */
export function getModelClient(): ModelClient {
  const provider = env("AI_PROVIDER", "anthropic");
  const apiKey = env("AI_API_KEY");
  const model = env("AI_MODEL", "claude-haiku-4-5");

  if (apiKey && provider === "anthropic") {
    return new AnthropicClient(apiKey, model);
  }
  // No key (or unsupported provider in Phase 1): offline mock.
  return new MockClient(model);
}

class AnthropicClient implements ModelClient {
  readonly isMock = false;
  constructor(
    private apiKey: string,
    readonly model: string,
  ) {}

  async complete(args: CompleteArgs): Promise<string> {
    // Lazy import so the mock path needs no SDK/network.
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });
    const res = await client.messages.create({
      model: this.model,
      max_tokens: 1024,
      temperature: args.temperature ?? 0.2,
      system: args.system,
      messages: [{ role: "user", content: args.user }],
    });
    const block = res.content.find((b) => b.type === "text");
    return block && "text" in block ? block.text : "";
  }
}

/**
 * Deterministic offline stand-in. Produces valid juror JSON whose score and
 * flags react to simple signals in the content, so demos and tests are
 * meaningful without a paid key.
 */
class MockClient implements ModelClient {
  readonly isMock = true;
  constructor(readonly model: string) {}

  async complete(args: CompleteArgs): Promise<string> {
    const content = extractContent(args.user);
    return JSON.stringify(mockJuror(args.persona, content));
  }
}

/** Pull the original content back out of the assembled user prompt. */
function extractContent(user: string): string {
  const marker = "<<<CONTENT>>>";
  const start = user.indexOf(marker);
  const end = user.lastIndexOf(marker);
  if (start !== -1 && end !== -1 && end > start) {
    return user.slice(start + marker.length, end).trim();
  }
  return user;
}

const RISKY = ["guaranteed", "guarantee", "cure", "cures", "#1", "risk-free", "risk free", "no risk", "100%"];
const GENERIC_OPENERS = ["introducing", "we are excited", "check out", "buy now", "our new"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function mockJuror(persona: PersonaName, content: string) {
  const lower = content.toLowerCase();
  // Base score is deterministic per (persona, content) in the 6-9 range.
  let score = 6 + (hash(persona + content) % 4); // 6..9
  const issues: { severity: "high" | "medium" | "low"; excerpt: string; explanation: string }[] = [];

  if (persona === "compliance_legal_flagger") {
    const hit = RISKY.find((w) => lower.includes(w));
    if (hit) {
      score = 3;
      issues.push({
        severity: "high",
        excerpt: hit,
        explanation: `"${hit}" is an absolute/unsubstantiated claim that likely needs evidence or a disclaimer.`,
      });
    }
  }

  if (persona === "stop_scrolling") {
    const dull = GENERIC_OPENERS.find((w) => lower.startsWith(w));
    if (dull) {
      score = Math.min(score, 5);
      issues.push({
        severity: "medium",
        excerpt: content.slice(0, 24),
        explanation: "Generic opener — unlikely to stop a jaded scroller.",
      });
    }
  }

  if (score <= 6 && issues.length === 0) {
    issues.push({
      severity: "low",
      excerpt: content.slice(0, 24) || content,
      explanation: "Minor improvement opportunity on this lens.",
    });
  }

  const confidence = score >= 8 ? "high" : score >= 5 ? "medium" : "high";
  return {
    persona,
    score,
    confidence,
    summary: `[[MOCK]] ${persona.replace(/_/g, " ")} scored this ${score}/10.`,
    issues,
    suggested_rewrite: content
      ? `${content}`.slice(0, 280)
      : "No content provided.",
  };
}
