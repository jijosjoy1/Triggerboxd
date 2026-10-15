import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fileURLToPath} from 'node:url';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const load=p=>loadTypeScript(fileURLToPath(new URL('../../'+p,import.meta.url)));
test('public family opinion displays verdict without a check or hide step',()=>{
 const {FamilyOpinionDisplay}=load('src/components/movie-representation.tsx');
 const html=renderToStaticMarkup(React.createElement(FamilyOpinionDisplay,{summary:{value:2,count:1,distribution:[0,1,0,0,0],provisional:true}}));
 assert.match(html,/A few awkward silences/);assert.match(html,/2\/5/);assert.match(html,/Early result/);assert.doesNotMatch(html,/Check family|Hide family/);
 const empty=renderToStaticMarkup(React.createElement(FamilyOpinionDisplay,{summary:{value:null,count:0,distribution:[0,0,0,0,0],provisional:false}}));
 assert.match(empty,/No family opinions submitted yet/);assert.doesNotMatch(empty,/grandma|safe to watch/i);
});
