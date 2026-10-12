export const CONTENT_SEVERITIES = ['None', 'Mild', 'Moderate', 'Severe'] as const;
export type ContentSeverity = 0 | 1 | 2 | 3;
export const FAMILY_AWKWARDNESS_LEVELS = [1, 2, 3, 4, 5] as const;
export type FamilyAwkwardnessLevel = (typeof FAMILY_AWKWARDNESS_LEVELS)[number];
export type SpoilerLevel = 0 | 1 | 2;

export const CATEGORY_SPOILER_PLACEHOLDER = 'Additional spoiler-sensitive information available.';
export const DESCRIPTION_SPOILER_PLACEHOLDER = 'Details hidden to avoid spoilers.';
export const UNRATED_VERDICT = 'Not yet rated';

export type SignatureQuestionId =
  | 'parents'
  | 'biryani'
  | 'animal-harm'
  | 'drugs'
  | 'sexual-violence'
  | 'alcohol'
  | 'language'
  | 'physical-violence';

type SeverityCopy = readonly [none: string, mild: string, moderate: string, severe: string];

export type SignatureQuestion = {
  id: SignatureQuestionId;
  prompt: string;
  icon: string;
  initiallyVisible: boolean;
  scale: 'family-awkwardness' | 'content-severity';
  /** One-line, report-based copy in None, Mild, Moderate, Severe order. */
  verdicts?: SeverityCopy;
  /** Factual copy used for serious harm and all sexual-violence reports. */
  factualVerdicts?: SeverityCopy;
};

export const signatureQuestions: readonly SignatureQuestion[] = [
  {
    id: 'parents',
    prompt: 'Watch with your parents?',
    icon: 'family',
    initiallyVisible: true,
    scale: 'family-awkwardness',
  },
  {
    id: 'biryani',
    prompt: 'Can you finish your biryani?',
    icon: 'meal',
    initiallyVisible: true,
    scale: 'content-severity',
    verdicts: [
      'No graphic imagery reported.',
      'Limited graphic imagery reported; you can probably keep eating.',
      'Noticeable graphic imagery reported; you may want a pause.',
      'Strong or sustained graphic imagery reported; it may affect your appetite.',
    ],
    factualVerdicts: [
      'No graphic imagery reported.',
      'Limited graphic imagery reported.',
      'Noticeable graphic imagery reported.',
      'Strong or sustained graphic imagery reported.',
    ],
  },
  {
    id: 'animal-harm',
    prompt: 'Would John Wick be angry?',
    icon: 'animal',
    initiallyVisible: true,
    scale: 'content-severity',
    verdicts: [
      'No animal harm reported.',
      'Limited animal harm reported.',
      'Noticeable animal harm reported.',
      'Strong or sustained animal harm reported.',
    ],
    factualVerdicts: [
      'No animal harm reported.',
      'Limited animal harm reported.',
      'Noticeable animal harm reported.',
      'Strong or sustained animal harm reported.',
    ],
  },
  {
    id: 'drugs',
    prompt: 'Is everyone seeing things?',
    icon: 'medicine',
    initiallyVisible: true,
    scale: 'content-severity',
    verdicts: [
      'No drug-related content reported.',
      'Some drug-related content reported.',
      'Noticeable drug use or intoxication reported.',
      'Strong or sustained drug-related content reported.',
    ],
    factualVerdicts: [
      'No drug-related content reported.',
      'Limited drug-related content reported.',
      'Noticeable drug-related content reported.',
      'Strong or sustained drug-related content reported.',
    ],
  },
  {
    id: 'sexual-violence',
    prompt: 'Does it contain sexual violence?',
    icon: 'warning',
    initiallyVisible: true,
    scale: 'content-severity',
    factualVerdicts: [
      'No sexual violence reported.',
      'Limited sexual violence content reported.',
      'Moderate sexual violence content reported.',
      'Severe sexual violence content reported.',
    ],
  },
  {
    id: 'alcohol',
    prompt: "Who's the designated driver?",
    icon: 'glass',
    initiallyVisible: false,
    scale: 'content-severity',
    verdicts: [
      'No alcohol-related content reported.',
      'Some alcohol use reported.',
      'Noticeable intoxication or repeated alcohol use reported.',
      'Strong or sustained alcohol-related content reported.',
    ],
    factualVerdicts: [
      'No alcohol-related content reported.',
      'Limited alcohol-related content reported.',
      'Noticeable alcohol-related content reported.',
      'Strong or sustained alcohol-related content reported.',
    ],
  },
  {
    id: 'language',
    prompt: 'Will your vocabulary expand?',
    icon: 'speech',
    initiallyVisible: false,
    scale: 'content-severity',
    verdicts: [
      'No profanity reported.',
      'Occasional profanity reported.',
      'Frequent profanity reported.',
      'Strong or persistent profanity reported.',
    ],
    factualVerdicts: [
      'No profanity reported.',
      'Occasional profanity reported.',
      'Frequent profanity reported.',
      'Strong or persistent profanity reported.',
    ],
  },
  {
    id: 'physical-violence',
    prompt: 'Does everyone need health insurance?',
    icon: 'impact',
    initiallyVisible: false,
    scale: 'content-severity',
    verdicts: [
      'No physical violence reported.',
      'Limited physical violence reported.',
      'Noticeable physical violence reported.',
      'Strong or graphic physical violence reported.',
    ],
    factualVerdicts: [
      'No physical violence reported.',
      'Limited physical violence reported.',
      'Noticeable physical violence reported.',
      'Severe physical violence reported.',
    ],
  },
] as const;

const familyAwkwardnessVerdicts: Readonly<Record<FamilyAwkwardnessLevel, string>> = {
  1: 'An easy family watch.',
  2: 'A little awkward at times.',
  3: 'Some awkward silences.',
  4: 'Very awkward for a family watch.',
  5: 'You may wish you had brought a book.',
};

const byId = new Map(signatureQuestions.map(question => [question.id, question]));

function isSpoilerLevel(value: unknown): value is SpoilerLevel {
  return value === 0 || value === 1 || value === 2;
}

function isSeverity(value: unknown): value is ContentSeverity {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0 && value <= 3;
}

function hiddenText(spoilerLevel: unknown): string | null {
  if (!isSpoilerLevel(spoilerLevel) || spoilerLevel === 2) return CATEGORY_SPOILER_PLACEHOLDER;
  if (spoilerLevel === 1) return DESCRIPTION_SPOILER_PLACEHOLDER;
  return null;
}

/**
 * Return only presentation copy. Category-spoiler suppression runs before ID or
 * severity lookup so this result cannot reveal which question was hidden.
 */
export function getSignatureVerdict(
  questionId: string,
  severity: ContentSeverity | null,
  spoilerLevel: SpoilerLevel,
  seriousHarm: boolean,
): string {
  const hidden = hiddenText(spoilerLevel);
  if (hidden) return hidden;
  const question = byId.get(questionId as SignatureQuestionId);
  if (!question || question.scale !== 'content-severity' || !isSeverity(severity)) return UNRATED_VERDICT;
  const verdicts = question.id === 'sexual-violence' || seriousHarm
    ? question.factualVerdicts
    : question.verdicts;
  return verdicts?.[severity] ?? UNRATED_VERDICT;
}

/** Family awkwardness is an independent five-point opinion, never inferred from content severity. */
export function getFamilyAwkwardnessVerdict(
  level: FamilyAwkwardnessLevel | null,
  spoilerLevel: SpoilerLevel,
  seriousHarm = false,
): string {
  const hidden = hiddenText(spoilerLevel);
  if (hidden) return hidden;
  if (level === null || !FAMILY_AWKWARDNESS_LEVELS.includes(level)) return UNRATED_VERDICT;
  if (seriousHarm) return `Community family-awkwardness rating: ${level} of 5.`;
  return familyAwkwardnessVerdicts[level];
}
