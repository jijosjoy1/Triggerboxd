import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const {MovieScenes}=loadTypeScript('src/components/movie-scenes.tsx');
test('default SSR renders only a closed lazy timeline with version caveat and no entry fields',()=>{
 const html=renderToStaticMarkup(React.createElement(MovieScenes,{movieId:'dcd83222-0705-49f8-9b7a-7f9ecc80f120'}));
 assert.match(html,/Scene timeline/);assert.match(html,/theatrical, censored or extended/);assert.doesNotMatch(html,/textarea|mvp-scene-list|Report note|Your own entries/);
});
