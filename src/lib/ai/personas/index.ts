import type { Persona } from "./base";
import { brandVoiceGuardian } from "./brand-voice";
import { complianceLegalFlagger } from "./compliance";
import { targetAudienceFit } from "./audience-fit";
import { seoDiscoverability } from "./seo";
import { stopScrolling } from "./stop-scrolling";
import { businessAnalyst } from "./business-analyst";

export type { Persona } from "./base";

/**
 * The jury, in canonical display order: the five craft jurors, then the
 * Business Analyst (Day 23b) — the company's insider business-and-market read.
 */
export const PERSONAS: readonly Persona[] = [
  brandVoiceGuardian,
  complianceLegalFlagger,
  targetAudienceFit,
  seoDiscoverability,
  stopScrolling,
  businessAnalyst,
] as const;
