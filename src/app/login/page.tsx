import type { Metadata } from 'next';
import { safeReturnPath } from '../../lib/request-security';
import LoginForm from './login-form';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = safeReturnPath(params.next);
  return <main id="main" className="wrap"><LoginForm next={next} linkError={typeof params.error === 'string' && ['callback', 'link'].includes(params.error) ? params.error : null} /></main>;
}
