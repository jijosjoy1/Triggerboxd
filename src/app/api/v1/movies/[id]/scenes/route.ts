import { sceneRequest, type SceneContext } from '../../../../../../lib/scene-api';
export const runtime='nodejs';
export async function GET(request:Request,context:SceneContext){return sceneRequest(request,context,'list');}
export async function POST(request:Request,context:SceneContext){return sceneRequest(request,context,'reveal');}
export async function PUT(request:Request,context:SceneContext){return sceneRequest(request,context,'put');}
export async function DELETE(request:Request,context:SceneContext){return sceneRequest(request,context,'delete');}
