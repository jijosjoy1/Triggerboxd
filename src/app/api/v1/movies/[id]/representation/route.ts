import {representationRequest,type RepresentationContext} from '../../../../../../lib/representation-api';
export const runtime='nodejs';
export const GET=(r:Request,c:RepresentationContext)=>representationRequest(r,c,'list');
export const POST=(r:Request,c:RepresentationContext)=>representationRequest(r,c,'reveal');
export const PATCH=(r:Request,c:RepresentationContext)=>representationRequest(r,c,'put');
export const DELETE=(r:Request,c:RepresentationContext)=>representationRequest(r,c,'delete');
