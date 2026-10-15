import type { Metadata } from 'next';
import NicknameForm from './nickname-form';
import { safeReturnPath } from '../../lib/request-security';

export const metadata: Metadata = { title: 'Your profile', robots: { index: false, follow: false } };

export default async function AccountPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams;
  const setup=params.setup==='nickname';
  return <main id="main" className="wrap"><NicknameForm setup={setup} next={setup?safeReturnPath(params.next):'/account/'} /></main>;
}
