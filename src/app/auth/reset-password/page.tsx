import type { Metadata } from 'next';
import { safeReturnPath } from '../../../lib/request-security';
import PasswordForm from './password-form';

export const metadata: Metadata = { title: 'Reset password', robots: { index: false, follow: false } };
export default async function ResetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <main id="main" className="wrap"><PasswordForm next={safeReturnPath(params.next)} /></main>;
}
