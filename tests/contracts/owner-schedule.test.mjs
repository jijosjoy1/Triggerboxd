import test from 'node:test';
import assert from 'node:assert/strict';
import {runOwnerNotificationSchedule} from '../../src/lib/owner-schedule.mjs';

test('schedule skips before invoking the app when sending secrets are missing',async()=>{
  let called=false;
  const result=await runOwnerNotificationSchedule({fetch:async()=>{called=true;}},{},{});
  assert.equal(called,false);assert.equal(result.skipped,true);
});
test('schedule invokes only the existing internal dispatcher and preserves runtime bindings',async()=>{
  const env={APP_ORIGIN:'https://triggerboxd.com',EMAIL_API_KEY:'test-only-key',EMAIL_FROM:'alerts@triggerboxd.com',INTERNAL_DISPATCH_SECRET:'x'.repeat(48)};
  const context={};let calls=0;
  const result=await runOwnerNotificationSchedule({fetch:async(request,bindings,ctx)=>{
    calls++;assert.equal(request.url,'https://triggerboxd.com/api/v1/internal/notifications/dispatch/');assert.equal(request.method,'POST');
    assert.equal(request.headers.get('x-internal-dispatch-secret'),env.INTERNAL_DISPATCH_SECRET);
    assert.equal(bindings,env);assert.equal(ctx,context);
    return Response.json({data:{configured:true,sent:2}});
  }},env,context);
  assert.equal(calls,1);assert.equal(result.sent,2);
});
test('schedule reports dispatch failures without including response payloads',async()=>{
  const env={APP_ORIGIN:'https://triggerboxd.com',EMAIL_API_KEY:'test-only-key',EMAIL_FROM:'alerts@triggerboxd.com',INTERNAL_DISPATCH_SECRET:'x'.repeat(48)};
  await assert.rejects(runOwnerNotificationSchedule({fetch:async()=>new Response('private provider details',{status:503})},env,{}),/^Error: OWNER_NOTIFICATION_DISPATCH_FAILED$/);
});
