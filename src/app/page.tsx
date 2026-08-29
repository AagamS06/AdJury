import { PERSONAS } from "@/lib/ai/personas";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-royal">
        AdJury
      </p>
      <h1 className="text-4xl font-bold text-ink">
        Five jurors review your content before you publish.
      </h1>
      <p className="mt-4 text-lg text-body">
        AdJury is a review &amp; QA layer for marketing content. Paste your ad
        copy, social post, or email and get scored, flagged, and rewritten from
        five distinct professional angles.
      </p>

      <ul className="mt-10 grid gap-3">
        {PERSONAS.map((p) => (
          <li
            key={p.name}
            className="rounded-md border border-border bg-surface px-4 py-3"
          >
            <span className="font-semibold text-navy">{p.title}</span>
            <span className="text-muted"> — {p.lens}</span>
          </li>
        ))}
      </ul>

      <p className="mt-10 text-sm text-muted">
        🚧 Phase 1 scaffold. The review engine runs today via{" "}
        <code className="font-mono">npm run demo</code>.
      </p>
    </main>
  );
}
