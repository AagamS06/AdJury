import type { MetadataRoute } from "next";
import { buildSitemap, resolveSiteUrl } from "@/lib/seo/metadata";

/**
 * `sitemap.xml` (DailyPlan Day 80). File-based metadata route — Next serves this
 * at `/sitemap.xml`. The indexable route set + per-route hints come from the pure
 * `lib/seo/metadata.ts` core (which robots.txt and the reconcile guard share), so
 * the sitemap lists exactly the public, indexable pages and nothing crawlers are
 * told to skip. The origin is resolved from `NEXT_PUBLIC_APP_URL`.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const { url } = resolveSiteUrl(process.env.NEXT_PUBLIC_APP_URL);
  return buildSitemap(url, new Date());
}
