import {onRequestGet} from '../functions/api/clans.js';
import {membersResponse} from '../functions/api/members.js';
import {scheduledCapture,trackingStatus} from '../functions/api/snapshots.js';
import {performanceResponse} from '../functions/api/performance.js';
import {seasonArchiveResponse} from '../functions/api/season.js';
import {alertsResponse} from '../functions/api/alerts.js';
export default {
 async fetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/api/alerts') return request.method==='GET'?alertsResponse(env):new Response('Method not allowed',{status:405});
  if (url.pathname === '/api/season-archive') return request.method==='GET'?seasonArchiveResponse(env):new Response('Method not allowed',{status:405});
  if (url.pathname === '/api/performance') return request.method==='GET'?performanceResponse(request,env):new Response('Method not allowed',{status:405});
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
