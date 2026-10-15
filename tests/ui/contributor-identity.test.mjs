import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const {ContributorIdentity}=loadTypeScript(fileURLToPath(new URL('../../src/components/contributor-identity.tsx',import.meta.url)));
test('public note identity renders only an opted-in picture and escaped nickname',()=>{
 assert.equal(renderToStaticMarkup(React.createElement(ContributorIdentity,{})),'');
 assert.equal(renderToStaticMarkup(React.createElement(ContributorIdentity,{author:{nickname:'Viewer',avatarId:'https://tracker.example/x'}})),'');
 const html=renderToStaticMarkup(React.createElement(ContributorIdentity,{author:{nickname:'<Movie Owl>',avatarId:'c0000000-0000-4000-8000-000000000001'}}));
 assert.match(html,/&lt;Movie Owl&gt;/);assert.match(html,/alt=""/);assert.match(html,/loading="lazy"/);
 assert.doesNotMatch(html,/tracker|user_id|email/);
});
