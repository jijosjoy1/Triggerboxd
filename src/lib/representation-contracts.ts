import { ValidationError } from './validation';
export const REPRESENTATION_LABELS = {lgbtq_characters:'LGBTQ+ characters',same_sex_romance:'Same-sex romance',same_sex_kissing:'Same-sex kissing',same_sex_intimacy:'Same-sex intimacy',transgender_characters:'Transgender characters',lgbtq_themes:'LGBTQ+ themes',gender_identity:'Gender identity themes'} as const;
export type RepresentationSlug=keyof typeof REPRESENTATION_LABELS;
export interface RepresentationItem {slug:RepresentationSlug;count:number;provisional:boolean}
export interface RepresentationResult {representation:RepresentationItem[]}
export interface OwnRepresentationResult {representation:null|{revision:number;watched:boolean;details:{slug:RepresentationSlug;spoilerLevel:number}[]}}
export interface FamilySummaryResult {familySummary:{value:number|null;count:number;distribution:number[];provisional:boolean}}
function exact(value:unknown,keys:string[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))throw new ValidationError('body','Use documented fields.');return value as Record<string,unknown>;}
function integer(value:unknown,min:number,max=Number.MAX_SAFE_INTEGER){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw new ValidationError('value','Invalid number.');return value;}
function slug(value:unknown):RepresentationSlug{if(typeof value!=='string'||!Object.hasOwn(REPRESENTATION_LABELS,value))throw new ValidationError('slug','Select a supported detail.');return value as RepresentationSlug;}
export function parseRepresentationReveal(value:unknown){const r=exact(value,['slug','level']);return {slug:slug(r.slug),level:integer(r.level,1,2)};}
export function parseRepresentationWrite(value:unknown,remove=false){const r=exact(value,remove?['slug','expectedRevision','watched']:['slug','expectedRevision','watched','spoilerLevel']);if(r.watched!==true)throw new ValidationError('watched','Confirm you watched the film.','WATCH_CONFIRMATION_REQUIRED');return {slug:slug(r.slug),expectedRevision:integer(r.expectedRevision,0),watched:true,spoilerLevel:remove?0:integer(r.spoilerLevel,0,2),remove};}
export function parseFamilyCheck(value:unknown){const r=exact(value,['check']);if(r.check!==true)throw new ValidationError('check','Explicitly check family opinion.');}
