export const CONTENT_SEVERITIES = ['None', 'Mild', 'Moderate', 'Severe'] as const;
export type ContentSeverity = 0 | 1 | 2 | 3;
export const FAMILY_AWKWARDNESS_LEVELS = [1, 2, 3, 4, 5] as const;
export type FamilyAwkwardnessLevel = (typeof FAMILY_AWKWARDNESS_LEVELS)[number];
export type SpoilerLevel = 0 | 1 | 2;

export const CATEGORY_SPOILER_PLACEHOLDER = 'Additional spoiler-sensitive information available.';
export const DESCRIPTION_SPOILER_PLACEHOLDER = 'Details hidden to avoid spoilers.';
export const UNRATED_VERDICT = 'Not yet rated';
export const UNRATED_INDICATOR = '⚪';
export const MORE_QUESTIONS_LABEL = 'Show 3 more ↓';
export const FAMILY_INDICATORS = ['🟢','🟡','🟠','🔴','💀'] as const;

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
  /** Emoji rendered as decorative art; config-owned so copy never lives in a component. */
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
    icon: '👨‍👩‍👧',
    initiallyVisible: true,
    scale: 'family-awkwardness',
  },
  {
    id: 'biryani',
    prompt: 'Can you eat biryani while watching?',
    icon: '🍛',
    initiallyVisible: true,
    scale: 'content-severity',
    verdicts: [
      'Eat peacefully — no graphic imagery reported.',
      "Maybe don’t watch while chewing.",
      'You might want to put that spoon down.',
      "Even the biryani wants to leave.",
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
    icon: '🐶',
    initiallyVisible: true,
    scale: 'content-severity',
    verdicts: [
      'John can relax — no animal harm reported.',
      'John is getting suspicious.',
      'John is reaching for his suit.',
      'John Wick is coming.',
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
    icon: '💊',
    initiallyVisible: true,
    scale: 'content-severity',
    verdicts: [
      'No drug-related content reported.',
      "Someone’s making questionable decisions.",
      'Reality has left the chat.',
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
    icon: '⚠️',
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
    prompt: 'How drunk does everyone get?',
    icon: '🍺',
    initiallyVisible: false,
    scale: 'content-severity',
    verdicts: [
      'Not a drop reported.',
      'Just a drink or two.',
      "Someone’s definitely calling a cab.",
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
    icon: '🤬',
    initiallyVisible: false,
    scale: 'content-severity',
    verdicts: [
      'Sunday school vocabulary — no profanity reported.',
      'A few spicy words.',
      'The subtitles need censoring.',
      'Your English teacher would resign.',
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
    icon: '🥊',
    initiallyVisible: false,
    scale: 'content-severity',
    verdicts: [
      'Everyone’s walking away — no physical violence reported.',
      'A few bruises.',
      'The hospital is getting busy.',
      'Severe physical violence reported.',
    ],
    factualVerdicts: [
      'No physical violence reported.',
      'Limited physical violence reported.',
      'Noticeable physical violence reported.',
      'Severe physical violence reported.',
    ],
  },
] as const;

export const familyAwkwardnessVerdicts: Readonly<Record<FamilyAwkwardnessLevel, string>> = {
  1: 'Even grandma can join.',
  2: 'A few awkward silences.',
  3: 'Suddenly, WhatsApp looks interesting.',
  4: 'The ceiling fan deserves an Oscar.',
  5: "The remote won't save you.",
};

/**
 * Descriptors that make a report serious enough to replace humour with factual
 * copy. Only descriptors already visible in the public summary are consulted, so
 * a protected category can never be inferred from the tone switch.
 */
export const SERIOUS_HARM_DESCRIPTORS: Readonly<Record<string, readonly string[]>> = {
  gore_graphic_violence: ['graphic_injury'],
  animal_harm: ['animal_death', 'animal_cruelty'],
  drugs: ['drug_addiction', 'overdose'],
  alcohol: ['alcohol_abuse'],
  physical_violence: ['torture', 'domestic_violence'],
  sexual_violence: ['rape', 'attempted_rape', 'sexual_coercion', 'graphic_sexual_violence'],
};

export const isSeriousHarm = (category: string, descriptors?: readonly string[], severity?: ContentSeverity | null): boolean => {
  if (severity !== undefined && ['drugs','alcohol','physical_violence'].includes(category) && (severity === 3 || (severity !== 0 && !descriptors?.length))) return true;
  if (!descriptors?.length) return false;
  const serious = SERIOUS_HARM_DESCRIPTORS[category];
  return !!serious && descriptors.some(descriptor => serious.includes(descriptor));
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
