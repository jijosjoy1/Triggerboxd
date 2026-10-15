import { errorResponse, readJsonBody, successResponse, validateMovieId } from '../../../../../../lib/api-http';
import { parseReviewAction } from '../../../../../../lib/admin-review';
import { requireActiveUser } from '../../../../../../lib/auth';
import { databaseError } from '../../../../../../lib/movie-api';
import { validateMutation } from '../../../../../../lib/request-security';
import { createRequestClient } from '../../../../../../lib/supabase/server';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
async function handle(request: Request, context: Context, mutation: boolean) {
  let applyCookies = (response: Response) => response;
  try {
    if (mutation) validateMutation(request);
    const id = validateMovieId((await context.params).id);
    const scoped = createRequestClient(request); applyCookies = scoped.applyCookies;
    await requireActiveUser(scoped.client);
    let name = 'get_admin_review'; let args: Record<string, unknown> = { p_id: id };
    if (mutation) {
      const action = parseReviewAction(await readJsonBody(request)); name = 'set_admin_review_flag';
      args = { ...args, p_expected_revision: action.expectedRevision, p_action: action.action, p_reason: action.reason, p_note: action.note };
    }
    // Each RPC independently checks the private owner allowlist.
    const { data, error } = await scoped.client.rpc(name, args); databaseError(error);
    return applyCookies(successResponse(data));
  } catch (error) { return applyCookies(errorResponse(error)); }
}
export const GET = (request: Request, context: Context) => handle(request, context, false);
export const POST = (request: Request, context: Context) => handle(request, context, true);
