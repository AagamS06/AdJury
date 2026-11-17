import type { MetadataRoute } from "next";
import { buildRobotsPolicy, resolveSiteUrl } from "@/lib/seo/metadata";

/**
 * `robots.txt` (DailyPlan Day 80). File-based metadata route — Next serves this at
 * `/robots.txt`. All policy lives in the pure `lib/seo/metadata.ts` core: the
 * origin is resolved from `NEXT_PUBLIC_APP_URL` (the Day-79 domain var) and the
 * allow/disallow rules + the sitemap pointer are built from the route inventory,
 * so this file carries no SEO logic of its own.
 */
export default function robots(): MetadataRoute.Robots {
  const { url } = resolveSiteUrl(process.env.NEXT_PUBLIC_APP_URL);
  const policy = buildRobotsPolicy(url);
  return {
    rules: policy.rules,
    sitemap: policy.sitemap,
    host: policy.host,
  };
}
