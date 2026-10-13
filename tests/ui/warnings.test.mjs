import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const {MovieWarnings}=loadTypeScript(fileURLToPath(new URL('../../src/components/movie-warnings.tsx',import.meta.url)));
const load = name => loadTypeScript(fileURLToPath(new URL(`../../src/components/${name}`,import.meta.url)));

test('warning UI distinguishes an explicit None from unanswered categories',()=>{
  const html=renderToStaticMarkup(React.createElement(MovieWarnings,{contributorCount:1,warnings:[{category:'nudity',severity:0,count:1,distribution:[1,0,0,0],provisional:true,disputed:false}]}));
  assert.equal((html.match(/severity-none/g)??[]).length,1);
  assert.equal((html.match(/severity-unknown/g)??[]).length,5);
  assert.match(html,/Provisional/);
});
test('warning UI keeps severe outliers visible under a None summary',()=>{
  const html=renderToStaticMarkup(React.createElement(MovieWarnings,{contributorCount:5,warnings:[{category:'nudity',severity:0,count:5,distribution:[4,0,0,1],provisional:false,disputed:true}]}));
  assert.match(html,/Reports differ/);
  assert.match(html,/<dt>Severe<\/dt><dd>1<\/dd>/);
  assert.match(html,/severity-none/);
});

test('all eight reviews show inline with no click-to-reveal, and unrated never reads as safe',()=>{
  const html=renderToStaticMarkup(React.createElement(MovieWarnings,{contributorCount:1,warnings:[{category:'animal_harm',severity:3,count:1,distribution:[0,0,0,1],provisional:true,disputed:false}]}));
  assert.equal((html.match(/class="question-emoji"/g)??[]).length,8);
  assert.doesNotMatch(html,/Show 3 more|more-questions/);
  assert.match(html,/How drunk does everyone get\?/);
  assert.match(html,/Does everyone need health insurance\?/);
  // Every question row carries a severity pill: one assessed, seven unassessed.
  assert.equal((html.match(/severity-unrated/g)??[]).length,7);
  assert.equal((html.match(/severity-severe/g)??[]).length,1);
  // Missing data must never render as a green absence pill.
  assert.equal((html.match(/severity-none/g)??[]).length,0);
  assert.match(html,/Not yet rated/);
  assert.doesNotMatch(html,/An easy family watch/);
  // Humour applies for an ordinary report; a green pill never does.
  assert.match(html,/John Wick is coming\./);
  assert.equal((html.match(/<h3>/g)??[]).length,14);
});

test('protected and unassessed categories have identical default HTML with universal reveal',()=>{
  const props={movieId:'film',contributorCount:0,warnings:[{category:'nudity',severity:null,count:0,distribution:[0,0,0,0],provisional:false,disputed:false,descriptors:[]}]};
  const unassessed=renderToStaticMarkup(React.createElement(MovieWarnings,props));
  const protectedHtml=renderToStaticMarkup(React.createElement(MovieWarnings,structuredClone(props)));
  assert.equal(unassessed,protectedHtml);
  assert.match(unassessed,/Reveal selected category/);
  assert.doesNotMatch(unassessed,/additional spoiler-sensitive|hidden categories|No viewer assessments yet/);
});

test('family vote renders nothing until the session resolves and never server-renders buttons',()=>{
  const {FamilyVote}=load('../../src/components/movie-product-controls.tsx');
  const idle=renderToStaticMarkup(React.createElement(FamilyVote,{movieId:'film'}));
  assert.equal(idle,'');
  const watchedButUnresolved=renderToStaticMarkup(React.createElement(FamilyVote,{movieId:'film',watched:true}));
  assert.equal(watchedButUnresolved,'');
  assert.doesNotMatch(idle,/aria-pressed|family-vote|Save/i);
});

test('question rows stack on narrow phones and use no fixed width past 320px',()=>{
  const css=readFileSync(fileURLToPath(new URL('../../src/app/film-ui.css',import.meta.url)),'utf8');
  for (const rule of css.matchAll(/\.mvp-page \.question-content[^{}]*\{([^}]*)\}/g)) {
    for (const declaration of rule[1].split(';')) {
      const width=/(?:^|[\s:])width\s*:\s*(\d+)px/.exec(declaration);
      if (width) assert.ok(Number(width[1])<=320,`question row declares width:${width[1]}px`);
    }
  }
  assert.match(css,/@media\(max-width:650px\)\{[^@]*\.mvp-page \.question-content\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/\.mvp-page \.severity-unrated/);
  assert.match(css,/\.family-vote-option\{[^}]*min-height:3\dpx/);
  assert.match(css,/\.family-vote-option\[aria-pressed=true\]/);
});

test('quick-form drafts survive category switches and are cleared once saved',()=>{
  const {applyCategoryDraft,storeCategoryDraft,clearCategoryDraft,emptyDraft}=load('../../src/components/movie-product-controls.tsx');
  const saved={category:'nudity',severity:2,spoilerLevel:0,descriptors:['blood']};
  const draft={severity:'3',spoilerLevel:2,descriptors:[]};
  assert.deepEqual(applyCategoryDraft(undefined,saved),{severity:'2',spoilerLevel:0,descriptors:['blood']});
  assert.deepEqual(applyCategoryDraft(undefined,{category:'drugs',severity:null}),emptyDraft);
  assert.deepEqual(applyCategoryDraft(draft,saved),draft);
  const stored=storeCategoryDraft({},'nudity',draft);
  assert.deepEqual(stored,{nudity:draft});
  assert.deepEqual(clearCategoryDraft(stored,'nudity'),{});
  assert.deepEqual(clearCategoryDraft(stored,'drugs'),stored);
});

test('quick form gates authoring on the shared watched flag and labels updates',()=>{
  const {QuickContribution}=load('../../src/components/movie-product-controls.tsx');
  const {MovieDetail}=load('../../src/components/movie-warnings.tsx');
  const loading=renderToStaticMarkup(React.createElement(QuickContribution,{movieId:'b43dd8a6-1e0f-4a6c-9a1f-0f4a8b0e2c11',onChanged(){}}));
  assert.match(loading,/Checking sign-in/);
  assert.doesNotMatch(loading,/Save warning|Save my family vote|Choose intensity/);
  const movie={id:'b43dd8a6-1e0f-4a6c-9a1f-0f4a8b0e2c11',tmdbId:42,title:'Kayattam',originalTitle:'Kayattam',year:2025,language:'ml',posterPath:null,warnings:[],contributorCount:0};
  const unwatched=renderToStaticMarkup(React.createElement(MovieDetail,{movieId:movie.id,initialMovie:movie}));
  assert.match(unwatched,/Tick Watched above to add your experience\./);
  assert.match(unwatched,/id="tab-contribute" role="tab" aria-selected="false" aria-controls="panel-contribute" aria-disabled="true"/);
  assert.equal((unwatched.match(/type="checkbox"/g)??[]).length,1);
  assert.doesNotMatch(unwatched,/Save warning|Save my family vote|Choose intensity|Discard draft|Delete my contribution/);
});

