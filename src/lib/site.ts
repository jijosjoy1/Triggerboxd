export const siteUrl='https://triggerboxd.com';
const suppliedContact=process.env.NEXT_PUBLIC_CONTACT_URL ?? 'mailto:info@triggerboxd.com';
export const contactUrl=suppliedContact&&/^(https:\/\/|mailto:)/i.test(suppliedContact)?suppliedContact:null;
export const categories=['Nudity','Sexual content','Sexual violence','Gore / graphic violence','Disturbing content','Suicide / self-harm'] as const;
export const severities=['Unknown','None','Mild','Moderate','Severe'] as const;
export type Severity=typeof severities[number];
export const sampleWarnings:Severity[]=['Mild','Unknown','None','Moderate','Severe','Unknown'];
export const severityIcons:Record<Severity,string>={Unknown:'?',None:'✓',Mild:'●',Moderate:'◆',Severe:'▲'};
