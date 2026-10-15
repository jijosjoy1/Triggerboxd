const statuses: Record<string, number> = {
  INVALID_REQUEST:400,INVALID_CONTENT_TYPE:415,AUTH_REQUIRED:401,FORBIDDEN:403,ACCOUNT_SUSPENDED:403,
  EMAIL_NOT_VERIFIED:403,NOT_FOUND:404,REVISION_CONFLICT:409,
  IDEMPOTENCY_CONFLICT:409,PAYLOAD_TOO_LARGE:413,MOVIE_NOT_SUPPORTED:422,
  WATCH_CONFIRMATION_REQUIRED:422,RATE_LIMITED:429,UPSTREAM_ERROR:502,
  SERVICE_UNAVAILABLE:503,UPSTREAM_TIMEOUT:504,
};
const messages: Record<string,string> = {
  INVALID_REQUEST:'Check your request and try again.',INVALID_CONTENT_TYPE:'Send this request as JSON.',AUTH_REQUIRED:'Sign in to continue.',
  FORBIDDEN:'This action is not available.',ACCOUNT_SUSPENDED:'This account cannot contribute.',
  EMAIL_NOT_VERIFIED:'Confirm your email before contributing.',NOT_FOUND:'This movie is not available.',
  REVISION_CONFLICT:'Your contribution changed. Reload before saving.',
  IDEMPOTENCY_CONFLICT:'This retry does not match the previous request.',
  PAYLOAD_TOO_LARGE:'The request is too large.',MOVIE_NOT_SUPPORTED:'This movie is outside the current catalogue.',
  WATCH_CONFIRMATION_REQUIRED:'Confirm you watched the film before contributing.',
  RATE_LIMITED:'Please wait before trying again.',UPSTREAM_ERROR:'The movie provider could not respond.',
  SERVICE_UNAVAILABLE:'The service is not configured or is temporarily unavailable.',
  UPSTREAM_TIMEOUT:'The movie provider took too long. Try again.',
};
export class ApiError extends Error {
  readonly code:string;
  readonly retryAfterSeconds?:number;
  constructor(code:string,retryAfterSeconds?:number){super(code);this.code=code;this.retryAfterSeconds=retryAfterSeconds;}
}
export function successResponse(data:unknown,status=200):Response {
  return Response.json({data},{status,headers:{'cache-control':'private, no-store'}});
}
export function errorResponse(error:unknown):Response {
  const value=error && typeof error==='object'?error as {code?:unknown;message?:unknown;retryAfterSeconds?:unknown}:{};
  const candidate=typeof value.code==='string' && statuses[value.code]?value.code:typeof value.message==='string' && statuses[value.message]?value.message:'SERVICE_UNAVAILABLE';
  const headers:Record<string,string>={'cache-control':'private, no-store'};
  if(candidate==='RATE_LIMITED')headers['retry-after']=String(typeof value.retryAfterSeconds==='number'?Math.max(1,Math.min(3600,Math.ceil(value.retryAfterSeconds))):60);
  return Response.json({error:{code:candidate,message:messages[candidate],requestId:crypto.randomUUID()}},{status:statuses[candidate],headers});
}
export async function readJsonBody(request:Request,maxBytes=8192):Promise<Record<string,unknown>> {
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new ApiError('INVALID_REQUEST');
  if(Number(request.headers.get('content-length'))>maxBytes)throw new ApiError('PAYLOAD_TOO_LARGE');
  const reader=request.body?.getReader();
  if(!reader)throw new ApiError('INVALID_REQUEST');
  const parts:Uint8Array[]=[];let length=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxBytes){await reader.cancel();throw new ApiError('PAYLOAD_TOO_LARGE');}parts.push(value);}
    const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
    const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError('INVALID_REQUEST');
    return value as Record<string,unknown>;
  }catch(error){if(error instanceof ApiError)throw error;throw new ApiError('INVALID_REQUEST');}
  finally{reader.releaseLock();}
}
export function validateMovieId(id:string):string {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new ApiError('NOT_FOUND');
  return id;
}
export function idempotencyKey(request:Request):string {
  const key=request.headers.get('idempotency-key');
  if(!key||!/^[a-zA-Z0-9_-]{8,128}$/.test(key))throw new ApiError('INVALID_REQUEST');
  return key;
}
