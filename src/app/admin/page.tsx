import type {Metadata} from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import {AdminDashboard} from '../../components/admin-dashboard';
import { requireActiveUser } from '../../lib/auth';
import { createRequestClient } from '../../lib/supabase/server';
import '../film-ui.css';

export const dynamic='force-dynamic';
// Never indexable, never linked from public navigation, and never in the sitemap.
export const metadata:Metadata={title:'Owner dashboard',robots:{index:false,follow:false},alternates:{canonical:'/admin/'}};

export default async function AdminPage(){
  let authorised = false;
  try {
    const scoped = createRequestClient(new Request('https://admin.internal/admin/', { headers: await headers() }));
    await requireActiveUser(scoped.client);
    const { data, error } = await scoped.client.rpc('get_admin_overview', { p_recent_limit: 1, p_recent_offset: 0 });
    authorised = !error && !!data;
  } catch { /* Keep the private page hidden when identity cannot be verified. */ }
  if (!authorised) notFound();
  return <main id="main" className="wrap mvp-page"><div className="film-page-heading"><h1>Owner dashboard</h1><p>Private operating summary. Access requires an account on the owner allowlist.</p></div><AdminDashboard/></main>;
}
