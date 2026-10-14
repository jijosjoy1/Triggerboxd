import type { CategoryRating, CategorySlug, OwnContribution, Severity, WarningSpoilerLevel } from './contracts';

export type RatingDraft = { severity: Severity; spoilerLevel: WarningSpoilerLevel; descriptors: string[] };
export type RatingDrafts = Partial<Record<CategorySlug, RatingDraft>>;

export function sameRating(a: RatingDraft, b: RatingDraft): boolean {
  return a.severity === b.severity && a.spoilerLevel === b.spoilerLevel && [...a.descriptors].sort().join('|') === [...b.descriptors].sort().join('|');
}

export function draftFrom(rating: CategoryRating): RatingDraft {
  return { severity: rating.severity, spoilerLevel: rating.spoilerLevel ?? 0, descriptors: rating.descriptors ?? [] };
}

/** Clearing an unsaved selection or resetting an existing rating never emits a removal request. */
export function editRating(drafts: RatingDrafts, slug: CategorySlug, next: RatingDraft | null, saved?: CategoryRating): RatingDrafts {
  const updated = { ...drafts };
  if (!next || (saved && sameRating(next, draftFrom(saved)))) delete updated[slug];
  else updated[slug] = next;
  return updated;
}

export class PartialSaveError extends Error {
  constructor(readonly completed: number, readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Could not save.');
  }
}

/** Keep a key until that exact request has a confirmed successful response. */
export class RetryKeys {
  private keys = new Map<string, string>();
  constructor(private readonly create: () => string) {}
  get(identity: string): string {
    let key = this.keys.get(identity);
    if (!key) { key = this.create(); this.keys.set(identity, key); }
    return key;
  }
  confirmed(identity: string): void { this.keys.delete(identity); }
  clear(): void { this.keys.clear(); }
}

/** PATCH each changed category against the revision returned by the previous PATCH. */
export async function saveChangedCategories(
  order: readonly CategorySlug[], drafts: RatingDrafts, initial: OwnContribution | null,
  patch: (slug: CategorySlug, draft: RatingDraft, expectedRevision: number) => Promise<OwnContribution | null>,
  onSaved: (slug: CategorySlug, contribution: OwnContribution | null) => void,
  isCurrent: () => boolean,
): Promise<{ contribution: OwnContribution | null; completed: number; interrupted: boolean }> {
  let contribution = initial;
  let completed = 0;
  for (const slug of order) {
    const draft = drafts[slug];
    if (!draft) continue;
    if (!isCurrent()) return { contribution, completed, interrupted: true };
    let next: OwnContribution | null;
    try { next = await patch(slug, draft, contribution?.revision ?? 0); }
    catch (cause) { throw new PartialSaveError(completed, cause); }
    if (!isCurrent()) return { contribution, completed, interrupted: true };
    contribution = next;
    onSaved(slug, contribution);
    completed++;
  }
  return { contribution, completed, interrupted: false };
}
