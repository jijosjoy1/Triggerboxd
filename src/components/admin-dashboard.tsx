'use client';

import { useEffect, useState } from 'react';
import { adminHasMore } from '../lib/admin';
import { useAuthSession } from '../lib/supabase/browser';

type Rating = { category: string; severity: number };
type Assessment = { filmTitle: string; submittedAt: string; updatedAt: string; edited: boolean; categoryCount: number; categories: Rating[] };
type Overview = {
  generatedAt: string;
  accounts: { total: number; last7Days: number; last30Days: number };
  films: { total: number; published: number; hidden: number };
  assessments: { total: number; neverEdited: number; edited: number; active: number; categoryRatings: number };
  recentAccounts: { nickname: string; joinedAt: string }[];
  recentFilms: { title: string; year: number | null; importedAt: string }[];
  recentAssessments: Assessment[];
};

export const SEVERITY_WORDS = ['None', 'Mild', 'Moderate', 'Severe', 'Very severe', 'Extreme'] as const;
const PAGE_SIZE = 5;

function shortDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? 'Unknown time' : parsed.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function categoryName(slug: string): string {
  return slug.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
}

export function AdminDashboard() {
  const { session, loading: authLoading, error: authError } = useAuthSession();
  const [view, setView] = useState<{ key: string; data?: Overview; error?: string } | null>(null);
  const [offset, setOffset] = useState(0);
  const [requestVersion, setRequestVersion] = useState(0);
  const [privacyBlocked, setPrivacyBlocked] = useState(false);
  const userId = !authLoading && !authError && !privacyBlocked ? session?.user?.id : null;
  const requestKey = userId ? `${userId}:${offset}:${requestVersion}` : null;

  // The shared auth store emits this before its post-logout session request finishes.
  useEffect(() => {
    const hidePrivateData = () => {
      setPrivacyBlocked(true);
      setView(null);
      setRequestVersion(version => version + 1);
    };
    const onAccountChange = (event: Event) => {
      if (!(event as CustomEvent<{ signedOut?: boolean }>).detail?.signedOut) return;
      hidePrivateData();
    };
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('triggerboxd-auth');
    if (channel) channel.onmessage = event => { if (event.data?.type === 'signed-out') hidePrivateData(); };
    window.addEventListener('triggerboxd:account-change', onAccountChange);
    return () => { window.removeEventListener('triggerboxd:account-change', onAccountChange); channel?.close(); };
  }, []);
  useEffect(() => { setPrivacyBlocked(false); setOffset(0); setView(null); }, [session?.user?.id]);

  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    let active = true;
    setView({ key: requestKey });
    void (async () => {
      try {
        const response = await fetch(`/api/v1/admin/overview?limit=${PAGE_SIZE}&offset=${offset}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const result = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status === 403 || response.status === 404) throw new Error('This page is not available for your account.');
          if (response.status === 401) throw new Error('Sign in with the owner account to view this page.');
          throw new Error(result?.error?.message ?? 'The dashboard could not be loaded.');
        }
        if (!result?.data) throw new Error('The dashboard returned an incomplete response.');
        if (active) setView({ key: requestKey, data: result.data as Overview });
      } catch (reason) {
        if (active) setView({ key: requestKey, error: reason instanceof Error ? reason.message : 'The dashboard could not be loaded.' });
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [requestKey, offset]);

  if (authLoading || privacyBlocked) return <p role="status" className="adm-status">Loading the owner summary…</p>;
  if (authError) return <div className="mvp-notice mvp-error" role="alert"><h2>Dashboard unavailable</h2><p>Unable to verify the current account. Please try again.</p></div>;
  if (!userId) return <p role="status" className="adm-status">Sign in with the owner account to view this page.</p>;
  const currentView = view?.key === requestKey ? view : null;
  if (currentView?.error) return <div className="mvp-notice mvp-error" role="alert"><h2>Dashboard unavailable</h2><p>{currentView.error}</p><button type="button" className="mvp-secondary" onClick={() => setRequestVersion(version => version + 1)}>Retry</button></div>;
  const data = currentView?.data;
  if (!data) return <p role="status" className="adm-status">Loading the owner summary…</p>;

  const empty = (text: string) => <p className="fine adm-empty">{text}</p>;

  return <div className="adm">
    <p className="fine" role="status" aria-live="polite">Generated {shortDate(data.generatedAt)}. Page {(offset / PAGE_SIZE) + 1}.</p>

    <section className="adm-tiles" aria-label="Totals">
      <dl className="adm-tile"><dt>Registered accounts</dt><dd>{data.accounts.total}</dd></dl>
      <dl className="adm-tile"><dt>New in 7 days</dt><dd>{data.accounts.last7Days}</dd></dl>
      <dl className="adm-tile"><dt>New in 30 days</dt><dd>{data.accounts.last30Days}</dd></dl>
      <dl className="adm-tile"><dt>Imported films</dt><dd>{data.films.total}</dd></dl>
      <dl className="adm-tile"><dt>Assessments</dt><dd>{data.assessments.total}</dd></dl>
    </section>

    <section aria-labelledby="adm-assessment-notes">
      <h2 id="adm-assessment-notes">Counting notes</h2>
      <p className="fine">An assessment is one viewer&rsquo;s contribution for one film. It is not the same as an individual category rating: this catalogue holds {data.assessments.categoryRatings} category ratings across {data.assessments.total} assessments. {data.assessments.neverEdited} assessments have never been edited and {data.assessments.edited} have been updated at least once. {data.assessments.active} are active; {data.films.published} of {data.films.total} films are published and {data.films.hidden} are hidden.</p>
      <p className="fine">Accounts are counted from profile rows, which the account-creation trigger writes for every new account including ones created outside this website. Edit counts show that a contribution was changed at least once; earlier revision history was never stored, so individual past edits cannot be reconstructed.</p>
    </section>

    <section aria-labelledby="adm-accounts">
      <h2 id="adm-accounts">Recently registered accounts</h2>
      {data.recentAccounts.length === 0 ? empty('No accounts yet.') : <ul className="adm-list">{data.recentAccounts.map((account, index) => <li key={`${account.joinedAt}-${index}`}><span className="adm-primary">{account.nickname}</span><span className="fine">{shortDate(account.joinedAt)}</span></li>)}</ul>}
    </section>

    <section aria-labelledby="adm-films">
      <h2 id="adm-films">Recently imported films</h2>
      {data.recentFilms.length === 0 ? empty('No films imported yet.') : <ul className="adm-list">{data.recentFilms.map((film, index) => <li key={`${film.importedAt}-${index}`}><span className="adm-primary">{film.title}</span><span className="fine">{film.year ?? 'Year unknown'} · {shortDate(film.importedAt)}</span></li>)}</ul>}
    </section>

    <section aria-labelledby="adm-assessments">
      <h2 id="adm-assessments">Recent assessments</h2>
      {data.recentAssessments.length === 0 ? empty('No assessments yet.') : <ul className="adm-list">{data.recentAssessments.map((item, index) => <li key={`${item.updatedAt}-${index}`}>
        <span className="adm-primary">{item.filmTitle}</span>
        <span className="fine">Submitted {shortDate(item.submittedAt)}{item.edited ? ` · updated ${shortDate(item.updatedAt)}` : ' · not edited since'}</span>
        <span className="adm-ratings">{item.categories.length === 0 ? 'No category ratings' : item.categories.map(rating => `${categoryName(rating.category)}: ${SEVERITY_WORDS[rating.severity] ?? 'Unknown'}`).join(' · ')}{item.categoryCount > item.categories.length ? ` · +${item.categoryCount - item.categories.length} more` : ''}</span>
      </li>)}</ul>}
    </section>

    <div className="adm-pager">
      <button type="button" className="mvp-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Newer</button>
      <button type="button" className="mvp-secondary" disabled={!adminHasMore(data, offset, PAGE_SIZE)} onClick={() => setOffset(offset + PAGE_SIZE)}>Older</button>
    </div>
  </div>;
}
