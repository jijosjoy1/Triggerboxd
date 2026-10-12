import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const {MovieWarnings}=loadTypeScript(fileURLToPath(new URL('../../src/components/movie-warnings.tsx',import.meta.url)));

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

test('compact questions retain five visible and three expandable questions without inference',()=>{
  const html=renderToStaticMarkup(React.createElement(MovieWarnings,{contributorCount:1,warnings:[{category:'animal_harm',severity:3,count:1,distribution:[0,0,0,1],provisional:true,disputed:false}]}));
  assert.match(html,/Show 3 more questions/);
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
