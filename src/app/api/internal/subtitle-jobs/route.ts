import { timingSafeEqual } from 'node:crypto';
import { ApiError, errorResponse, readJsonBody, successResponse, validateMovieId } from '../../../../lib/api-http';
import { parseSubtitleResult } from '../../../../lib/subtitle-estimates';
import { databaseError, serviceDatabase } from '../../../../lib/movie-api';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
  try {
    const secret=process.env.TRIGGERBOXD_PIPELINE_TOKEN;
    if (!secret || secret.length<32) throw new ApiError('SERVICE_UNAVAILABLE');
    const supplied=request.headers.get('authorization')??'';
    const expected=`Bearer ${secret}`;
    if (Buffer.byteLength(supplied)!==Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))) throw new ApiError('FORBIDDEN');
    const body=await readJsonBody(request,8192);
    const db=serviceDatabase();
    if (body.action==='claim') {
      if (Object.keys(body).some(key=>key!=='action')) throw new ApiError('INVALID_REQUEST');
      const {data,error}=await db.rpc('claim_subtitle_job'); databaseError(error); return successResponse(data);
    }
    if (!['complete','fail'].includes(String(body.action)) || typeof body.id!=='string' || typeof body.leaseToken!=='string' || Object.keys(body).some(key=>!['action','id','leaseToken',body.action==='complete'?'result':'reason'].includes(key))) throw new ApiError('INVALID_REQUEST');
    validateMovieId(body.id); validateMovieId(body.leaseToken);
    const reasons=['subtitle_unavailable','quota_exhausted','provider_error','analysis_failed'];
    if (body.action==='fail' && !reasons.includes(String(body.reason))) throw new ApiError('INVALID_REQUEST');
    const {data,error}=await db.rpc('finish_subtitle_job',{p_id:body.id,p_lease_token:body.leaseToken,
      p_result:body.action==='complete'?parseSubtitleResult(body.result):null,p_reason:body.action==='fail'?body.reason:null});
    databaseError(error); return successResponse(data);
  } catch(error) { return errorResponse(error); }
}
