import test from 'node:test';
import assert from 'node:assert/strict';
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

test('all eight emoji questions stay visible without inferring hidden reports',()=>{
  const html=renderToStaticMarkup(React.createElement(MovieWarnings,{contributorCount:1,warnings:[{category:'animal_harm',severity:3,count:1,distribution:[0,0,0,1],provisional:true,disputed:false}]}));
  assert.doesNotMatch(html,/Show 3 more questions/);
  assert.equal((html.match(/class="question-emoji"/g)??[]).length,8);
  assert.match(html,/ceiling inspection/);
  assert.match(html,/Strong or sustained animal harm reported/);
  assert.doesNotMatch(html,/animal death|An easy family watch/);
  assert.equal((html.match(/<h3>/g)??[]).length,14);
  assert.match(html,/Not shown · Check/);
});

test('protected and unassessed categories have identical default HTML with universal reveal',()=>{
  const props={movieId:'film',contributorCount:0,warnings:[{category:'nudity',severity:null,count:0,distribution:[0,0,0,0],provisional:false,disputed:false,descriptors:[]}]};
  const unassessed=renderToStaticMarkup(React.createElement(MovieWarnings,props));
  const protectedHtml=renderToStaticMarkup(React.createElement(MovieWarnings,structuredClone(props)));
  assert.equal(unassessed,protectedHtml);
  assert.match(unassessed,/Reveal selected category/);
  assert.doesNotMatch(unassessed,/additional spoiler-sensitive|hidden categories|No viewer assessments yet/);
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

