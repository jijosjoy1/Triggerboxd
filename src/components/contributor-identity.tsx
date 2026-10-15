import { avatarUrl } from '../lib/avatar';
export function ContributorIdentity({ author }: { author?: { nickname: string; avatarId: string } | null }) {
  const source = avatarUrl(author?.avatarId);
  if (!source || !author?.nickname) return null;
  return <div className="contributor-identity"><img src={source} alt="" width={32} height={32} loading="lazy" /><span>{author.nickname}</span></div>;
}
