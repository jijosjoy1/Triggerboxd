import { sceneRequest, type SceneContext } from '../../../../../../lib/scene-api';
export const runtime='nodejs';
export async function POST(request:Request,context:SceneContext){return sceneRequest(request,context,'report');}
