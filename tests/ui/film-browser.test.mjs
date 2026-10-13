import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {loadTypeScript} from '../auth/load-typescript.mjs';
const load = path=>loadTypeScript(fileURLToPath(new URL(path,import.meta.url)));
const {cleanFilm,parseFilmList,toggleFilm,filmDestination,filmPoster,MAX_SAVED_FILMS} = load('../../src/lib/film-list.ts');
const {QUESTION_HELP}=load('../../src/lib/question-help.ts');
const {signatureQuestions}=load('../../src/lib/signature-questions.ts');
const {QuestionHelp}=load('../../src/components/question-help.tsx');
const {FilmDialog}=load('../../src/components/film-dialog.tsx');
const film={tmdbId:575351,movieId:'dcd83222-0705-49f8-9b7a-7f9ecc80f120',title:'Kumbalangi Nights',originalTitle:'Kumbalangi Nights',year:2019,language:'ml',posterPath:'/poster.jpg'};

test('watchlist stores only bounded movie metadata and rejects injected addresses',()=>{
  const clean=cleanFilm({...film,notes:'private note',warnings:['hidden'],movieId:'../../admin',posterPath:'//evil.example/image'});
  assert.equal(clean.movieId,null);assert.equal(clean.posterPath,null);
  assert.equal('notes' in clean,false);assert.equal('warnings' in clean,false);
  assert.equal(cleanFilm({...film,tmdbId:-1}),null);
  assert.equal(filmPoster('//evil.example/image'),null);
  assert.equal(filmPoster('/../secret'),null);
});
test('watchlist add, duplicate removal and reload preserve identity and limits',()=>{
  const added=toggleFilm([],film);assert.equal(added.length,1);
  assert.deepEqual(parseFilmList(JSON.stringify(added)),added);
  assert.equal(parseFilmList(JSON.stringify([film,film,null])).length,1);
  assert.equal(toggleFilm(added,film).length,0);
  assert.throws(()=>parseFilmList('broken'),/could not be read/);
  assert.throws(()=>toggleFilm(Array.from({length:MAX_SAVED_FILMS},(_,i)=>({...film,tmdbId:i+1})),film),/200 films/);
});
test('guide and contribution actions resolve only internal UUID film addresses',()=>{
  assert.equal(filmDestination(film.movieId),`/movies/${film.movieId}/`);
  assert.equal(filmDestination(film.movieId,true),`/movies/${film.movieId}/#contribute`);
  assert.throws(()=>filmDestination('//evil.example'),/invalid film address/);
});
test('every playful question has keyboard-readable help without film-specific content',()=>{
  assert.deepEqual(Object.keys(QUESTION_HELP).sort(),signatureQuestions.map(q=>q.id).sort());
  for(const question of signatureQuestions){
    const html=renderToStaticMarkup(React.createElement(QuestionHelp,{id:question.id,prompt:question.prompt}));
    assert.match(html,/aria-expanded="false"/);assert.match(html,/aria-controls=/);assert.match(html,/hidden=""/);
  }
  assert.match(QUESTION_HELP.biryani,/Gore and graphic injury/);
  assert.match(QUESTION_HELP.biryani,/not food content/);
});
test('movie popup offers real separate actions and discloses device-only saving',()=>{
  const html=renderToStaticMarkup(React.createElement(FilmDialog,{film,busy:false,error:'',onClose(){},onOpen(){}}));
  assert.match(html,/<dialog/);assert.match(html,/View guide/);assert.match(html,/Contribute/);assert.match(html,/Watched status saves on this browser/);
  assert.doesNotMatch(html,/synopsis|Severe|verified/i);
});

