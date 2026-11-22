import {onRequestGet} from '../functions/api/clans.js';
import {membersResponse} from '../functions/api/members.js';
import {scheduledCapture,trackingStatus} from '../functions/api/snapshots.js';
export default {
 async fetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/api/tracking-status') return trackingStatus(env);
  if (url.pathname === '/api/members') return membersResponse(request,env);
  if (url.pathname === '/api/clans') {
   if (request.method !== 'GET') return new Response('Method not allowed', {status:405,headers:{Allow:'GET'}});
   return onRequestGet();
  }
  if (url.pathname.startsWith('/api/')) return Response.json({error:'Not found'}, {status:404});
  return env.ASSETS.fetch(request);
 },
 async scheduled(controller,env,ctx){
  ctx.waitUntil(scheduledCapture(env,new Date(controller.scheduledTime)));
 }
};
