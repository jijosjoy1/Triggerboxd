import type { Metadata } from 'next';
import NicknameForm from './nickname-form';

export const metadata: Metadata = { title: 'Your profile', robots: { index: false, follow: false } };

export default function AccountPage() {
  return <main id="main" className="wrap"><NicknameForm /></main>;
}
