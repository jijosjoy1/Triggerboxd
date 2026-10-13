import {representationRequest,type RepresentationContext} from '../../../../../../../lib/representation-api';
export const runtime='nodejs';
export const GET=(r:Request,c:RepresentationContext)=>representationRequest(r,c,'own');
