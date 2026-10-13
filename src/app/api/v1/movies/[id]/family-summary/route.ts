import {representationRequest,type RepresentationContext} from '../../../../../../lib/representation-api';
export const runtime='nodejs';
export const POST=(r:Request,c:RepresentationContext)=>representationRequest(r,c,'family');
