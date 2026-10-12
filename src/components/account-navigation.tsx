'use client';
import Link from 'next/link';
import { useState } from 'react';
import { signOut,useAuthSession } from '../lib/supabase/browser';

export function AccountNavigation(){
  const {session}=useAuthSession();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function logout(){
    if(!session)return;
    setBusy(true);setError('');
    try{await signOut(session.csrfToken);}
    catch{setError('Sign-out failed. Please retry.');}
    finally{setBusy(false);}
  }
  return session?.user?<span className="account-navigation"><button type="button" disabled={busy} onClick={logout}>{busy?'Signing out…':'Sign out'}</button>{error?<span className="fine" role="alert">{error}</span>:null}</span>:<Link href="/login/">Sign in</Link>;
}
