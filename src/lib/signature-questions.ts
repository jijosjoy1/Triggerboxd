export const CONTENT_SEVERITIES = ['None', 'Mild', 'Moderate', 'Severe', 'Very severe', 'Extreme'] as const;
export type ContentSeverity = 0 | 1 | 2 | 3 | 4 | 5;
export const FAMILY_AWKWARDNESS_LEVELS = [1, 2, 3, 4, 5] as const;
export type FamilyAwkwardnessLevel = (typeof FAMILY_AWKWARDNESS_LEVELS)[number];
export type SpoilerLevel = 0 | 1 | 2;

export const CATEGORY_SPOILER_PLACEHOLDER = 'Additional spoiler-sensitive information available.';
export const DESCRIPTION_SPOILER_PLACEHOLDER = 'Details hidden to avoid spoilers.';
export const UNRATED_VERDICT = 'Not yet rated';
export const UNRATED_INDICATOR = '⚪';
export const MORE_QUESTIONS_LABEL = 'Show 2 more ↓';

export type SignatureQuestionId =
  | 'parents'
  | 'biryani'
  | 'graphic-violence'
  | 'horror'
  | 'animal-harm'
  | 'drugs'
  | 'sexual-violence'
  | 'alcohol'
  | 'language';

type SeverityCopy = readonly [none: string, mild: string, moderate: string, severe: string];
type ExtendedSeverityCopy = readonly [none: string, mild: string, moderate: string, severe: string, verySevere: string, extreme: string];

export type SignatureQuestion = {
  id: SignatureQuestionId;
  prompt: string;
  /** Emoji rendered as decorative art; config-owned so copy never lives in a component. */
  icon: string;
  initiallyVisible: boolean;
  scale: 'family-awkwardness' | 'content-severity';
  /** One-line, report-based copy in None, Mild, Moderate, Severe order. */
  verdicts?: SeverityCopy | ExtendedSeverityCopy;
  /** Factual copy used for serious harm and all sexual-violence reports. */
  factualVerdicts?: ExtendedSeverityCopy;
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
    prompt: 'Can you finish your biryani?',
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
      'Very strong graphic imagery reported.',
      'Extreme graphic imagery reported.',
    ],
  },
  {
    id: 'graphic-violence', prompt: 'Heads rolling or blood splattering?', icon: '🩸',
    initiallyVisible: true, scale: 'content-severity',
    verdicts: [
      'No graphic violence reported.', 'Some bloodshed reported.',
      'Bloody violence gets noticeable.', 'Brutal violence and bloodshed reported.',
    ],
    factualVerdicts: [
      'No graphic violence reported.', 'Limited graphic violence reported.',
      'Noticeable graphic violence reported.', 'Severe graphic violence reported.',
      'Very severe graphic violence reported.', 'Extreme graphic violence reported.',
    ],
  },
  {
    id: 'horror', prompt: 'Will you sleep tonight?', icon: '👻',
    initiallyVisible: true, scale: 'content-severity',
    verdicts: [
      'No frightening content reported.', 'Sweet dreams guaranteed.', 'Maybe leave a light on.',
      'That shadow looks suspicious.', 'Sleep is officially cancelled.', 'Even the ghosts are scared.',
    ],
    factualVerdicts: [
      'No frightening content reported.', 'Limited frightening content reported.',
      'Noticeable frightening content reported.', 'Severe frightening content reported.',
      'Very severe frightening content reported.', 'Extreme frightening content reported.',
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
      'Very strong animal harm reported.',
      'Extreme animal harm reported.',
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
      'Very strong drug-related content reported.',
      'Extreme drug-related content reported.',
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
      'Very severe sexual violence content reported.',
      'Extreme sexual violence content reported.',
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
      'Very strong alcohol-related content reported.',
      'Extreme alcohol-related content reported.',
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
      'Very strong or persistent profanity reported.',
      'Extreme or persistent profanity reported.',
    ],
  },
] as const;

/** Shared presentation data for family votes, the guide and exported story cards. */
export const FAMILY_AWKWARDNESS = [
  {level:1,emoji:'😊',verdict:'Even grandma can join.',description:'Nothing likely to make family viewing awkward.',title:'COMFORTABLE',color:'#4A986C',asset:'/story/reactions/level-1-grandma.svg'},
  {level:2,emoji:'🤫',verdict:'A few awkward silences.',description:'Mildly awkward or suggestive moments.',title:'A LITTLE AWKWARD',color:'#D5B84E',asset:'/story/reactions/level-2-silence.svg'},
  {level:3,emoji:'😐',verdict:'Suddenly, WhatsApp looks interesting.',description:'Some scenes might make you reach for your phone.',title:'AWKWARD',color:'#E58B43',asset:'/story/reactions/level-3-phone.svg'},
  {level:4,emoji:'🥵',verdict:'The ceiling fan deserves an Oscar.',description:'Significant awkward content. Expect some uncomfortable moments.',title:'VERY AWKWARD',color:'#D65C4D',asset:'/story/reactions/level-4-fan.svg'},
  {level:5,emoji:'💀',verdict:"The remote won't save you.",description:'Very uncomfortable moments that might make family viewing difficult.',title:'EXTREMELY AWKWARD',color:'#8D3438',asset:'/story/reactions/level-5-remote.svg'},
] as const;
export const FAMILY_INDICATORS = FAMILY_AWKWARDNESS.map(rating => rating.emoji);

export function familyAwkwardness(level: number | null) {
  return level !== null && Number.isInteger(level) && level >= 1 && level <= 5 ? FAMILY_AWKWARDNESS[level - 1] : null;
}

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
  if (severity != null && ['drugs','alcohol','physical_violence'].includes(category) && (severity >= 3 || (severity !== 0 && !descriptors?.length))) return true;
  if (!descriptors?.length) return false;
  const serious = SERIOUS_HARM_DESCRIPTORS[category];
  return !!serious && descriptors.some(descriptor => serious.includes(descriptor));
};

const byId = new Map(signatureQuestions.map(question => [question.id, question]));

function isSpoilerLevel(value: unknown): value is SpoilerLevel {
  return value === 0 || value === 1 || value === 2;
}

function isSeverity(value: unknown): value is ContentSeverity {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0 && value <= 5;
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
  const verdicts = question.id === 'sexual-violence' || seriousHarm || (isSeverity(severity) && severity >= 4 && question.id !== 'horror')
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
  return familyAwkwardness(level)?.verdict ?? UNRATED_VERDICT;
}
