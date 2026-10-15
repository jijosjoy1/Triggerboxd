/**
 * The Triggerboxd wordmark. Split so the second half can carry the brand red
 * used by the story-card header; the two spans concatenate into one accessible
 * name ("Triggerboxd") with no whitespace or punctuation between them.
 */
export function Wordmark() {
  return <><span className="wordmark-trigger">Trigger</span><span className="wordmark-boxd">boxd</span></>;
}
