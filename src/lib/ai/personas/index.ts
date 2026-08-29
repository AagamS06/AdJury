import type { Persona } from "./base";
import { brandVoiceGuardian } from "./brand-voice";
import { complianceLegalFlagger } from "./compliance";
import { targetAudienceFit } from "./audience-fit";
import { seoDiscoverability } from "./seo";
import { stopScrolling } from "./stop-scrolling";

export type { Persona } from "./base";

/** The five jurors, in canonical display order. */
export const PERSONAS: readonly Persona[] = [
  brandVoiceGuardian,
  complianceLegalFlagger,
  targetAudienceFit,
  seoDiscoverability,
  stopScrolling,
] as const;
