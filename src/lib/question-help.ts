import type { SignatureQuestionId } from './signature-questions';

// Definitions are identical for every film, including unassessed/protected rows.
export const QUESTION_HELP: Record<SignatureQuestionId, string> = {
  parents: 'How awkward might a family viewing feel? Viewers vote from 1 (comfortable) to 5 (extremely awkward). This is a separate opinion, not an age rating or a safety guarantee.',
  biryani: 'Gore and graphic injury: blood, wounds and other disturbing visuals that might put you off your meal. This is about what you see, not food content.',
  'animal-harm': 'Animal harm: cruelty, injury or suffering involving animals. The John Wick reference is just the question’s nickname.',
  drugs: 'Drug use or intoxication. This does not mean every character uses drugs, or reveal which scenes contain them.',
  'sexual-violence': 'Sexual violence, coercion or assault. Reports use factual intensity labels; this question does not reveal a scene or victim.',
  alcohol: 'Alcohol use and drunkenness. It describes reported content, not a judgment about the characters.',
  language: 'Strong language, profanity or slurs. Intensity describes how prominent it is in viewer reports.',
  'physical-violence': 'Fighting, attacks or other physical violence. Graphic injuries are covered separately by the biryani question.',
};
