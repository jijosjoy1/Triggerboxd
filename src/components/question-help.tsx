'use client';
import { useId, useState } from 'react';
import { QUESTION_HELP } from '../lib/question-help';
import type { SignatureQuestionId } from '../lib/signature-questions';

const icons: Record<SignatureQuestionId,string> = { parents:"👀", biryani:"🍛", "animal-harm":"🐾", drugs:"💊", "sexual-violence":"⚠️", alcohol:"🍻", language:"🤬", "physical-violence":"🥊" };

export function QuestionHelp({id,prompt}:{id:SignatureQuestionId;prompt:string}) {
  const [open,setOpen] = useState(false);
  const helpId = useId();
  return <div className="question-heading"><h3><span className="question-emoji" aria-hidden="true">{icons[id]}</span>{prompt}</h3><button type="button" className="question-info" aria-label={`What does “${prompt}” mean?`} aria-expanded={open} aria-controls={helpId} onClick={()=>setOpen(!open)} onKeyDown={event=>{if(event.key==='Escape'){setOpen(false);event.stopPropagation();}}}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></svg></button><p id={helpId} className="question-explanation" hidden={!open}>{QUESTION_HELP[id]}</p></div>;
}
