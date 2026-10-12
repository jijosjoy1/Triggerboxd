import { createClient } from '@supabase/supabase-js';
import { ApiError } from './api-http';
import { createTmdbGateway } from './tmdb';

function databaseConfig(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key)throw new ApiError('SERVICE_UNAVAILABLE');
  return {url,key};
}
export function publicDatabase(){
  const {url,key}=databaseConfig();
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
export function serviceDatabase(){
  const {url}=databaseConfig();
  const key=process.env.SUPABASE_SECRET_KEY;
  if(!key)throw new ApiError('SERVICE_UNAVAILABLE');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
export function tmdbGateway(){
  const accessToken=process.env.TMDB_READ_ACCESS_TOKEN;
  if(!accessToken)throw new ApiError('SERVICE_UNAVAILABLE');
  // No metadata cache until the applicable retention terms have been confirmed.
  return createTmdbGateway({accessToken});
}
export function databaseError(error:{message?:string;code?:string}|null):void {
  if(!error)return;
  // Known SQL messages are mapped safely; unknown provider details never reach users.
  throw new ApiError(error.message ?? 'SERVICE_UNAVAILABLE');
}
export async function searchSubject(request:Request):Promise<string> {
  const salt=process.env.REQUEST_HASH_SECRET;
  if(!salt||salt.length<32)throw new ApiError('SERVICE_UNAVAILABLE');
  // Cloudflare replaces this header at the edge. Local requests are never used as live quota evidence.
  const origin=process.env.APP_ORIGIN;
  let localWorker=false;
  try{
    const configured=origin?new URL(origin):null;
    const actual=new URL(request.url);
    localWorker=!!configured&&configured.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(configured.hostname)
      &&configured.port===actual.port&&['127.0.0.1','localhost','[::1]'].includes(actual.hostname);
  }catch{/* Invalid config is not permission to accept a spoofed edge identity. */}
  const ip=request.headers.get('cf-connecting-ip') ?? (process.env.NODE_ENV!=='production'||localWorker?'local':null);
  if(!ip||ip.length>64)throw new ApiError('SERVICE_UNAVAILABLE');
  const bytes=new TextEncoder().encode(`${salt}:${new Date().toISOString().slice(0,10)}:${ip}`);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}
