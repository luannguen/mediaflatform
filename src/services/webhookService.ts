import { WebhookEndpoint, WebhookDelivery } from '@/types/database';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { AppError } from '@/lib/errors/app-error';
import { generateId } from '@/lib/ids/generator';
import { validateWebhookUrl, sendWebhook } from '@/lib/security/webhookTransport';
import crypto from 'node:crypto';
export interface CreateWebhookInput {workspaceId?:string; applicationId?:string; name:string; url:string; events:string[];}
const publicEndpoint=(row: WebhookEndpoint): WebhookEndpoint=>{const {secret_hash,...safe}=row;return safe as WebhookEndpoint;};
export const webhookService={
 async listEndpoints(workspaceId:string):Promise<WebhookEndpoint[]> {
  const {data,error}=await supabaseAdmin.from('webhook_endpoints').select('*').eq('workspace_id',workspaceId);
  if(error)throw AppError.serviceUnavailable('Webhook endpoints unavailable');
  return (data||[]).map(publicEndpoint);
 },
 async createEndpoint(input:CreateWebhookInput) {
  validateWebhookUrl(input.url);
  if(!input.workspaceId || !input.name || input.name.length>100 || !Array.isArray(input.events) || !input.events.length || input.events.length>30 || input.events.some(e=>typeof e!=='string' || !/^(\*|(?:asset|image|video|document)\.[a-z_]+)$/.test(e)))throw AppError.badRequest('Invalid webhook configuration');
  if(input.applicationId){const {data,error}=await supabaseAdmin.from('applications').select('id').eq('id',input.applicationId).eq('workspace_id',input.workspaceId).maybeSingle();if(error||!data)throw AppError.forbidden('Application does not belong to this workspace');}
  const secret='whsec_'+crypto.randomBytes(32).toString('hex');
  const {data,error}=await supabaseAdmin.from('webhook_endpoints').insert({id:generateId('wh'),workspace_id:input.workspaceId,application_id:input.applicationId||null,name:input.name,url:input.url,events:input.events,secret_hash:secret,status:'active'}).select('*').single();
  if(error)throw AppError.serviceUnavailable('Could not create webhook endpoint');
  return {endpoint:publicEndpoint(data),secret};
 },
 async dispatchEvent(workspaceId:string,eventType:string,dataPayload:any,options?:{eventId?:string}) {
  // Core asset events are captured in the committing database transaction.
  if(['asset.created','asset.updated','asset.trashed','asset.restored','asset.deleted','image.processed','video.processed','document.processed'].includes(eventType))return;
  const {error}=await supabaseAdmin.rpc('enqueue_media_event',{p_workspace:workspaceId,p_type:eventType,p_data:dataPayload,p_event_id:options?.eventId||crypto.randomUUID()});
  if(error)throw AppError.serviceUnavailable('Could not queue webhook event');
 },
 async listDeliveries(endpointId:string|undefined,workspaceId:string):Promise<WebhookDelivery[]> {
  const endpoints=await this.listEndpoints(workspaceId); const ids=endpoints.map(e=>e.id);
  if(endpointId&&!ids.includes(endpointId))throw AppError.forbidden('Webhook endpoint does not belong to this workspace');
  if(!ids.length)return [];
  const {data,error}=await supabaseAdmin.from('webhook_deliveries').select('*').in('webhook_endpoint_id',endpointId?[endpointId]:ids).order('created_at',{ascending:false}).limit(100);
  if(error)throw AppError.serviceUnavailable('Webhook deliveries unavailable');
  return data||[];
 },
 async replayDelivery(deliveryId:string,workspaceId:string):Promise<WebhookDelivery> {
  const endpoints=await this.listEndpoints(workspaceId);
  const {data:original,error}=await supabaseAdmin.from('webhook_deliveries').select('*').eq('id',deliveryId).in('webhook_endpoint_id',endpoints.map(e=>e.id)).maybeSingle();
  if(error||!original)throw AppError.notFound('Webhook delivery not found');
  const {data,error:insertError}=await supabaseAdmin.from('webhook_deliveries').insert({id:generateId('evt'),webhook_endpoint_id:original.webhook_endpoint_id,event_type:original.event_type,event_id:original.event_id,payload:original.payload,status:'pending',attempt_count:0,next_attempt_at:new Date().toISOString()}).select('*').single();
  if(insertError)throw AppError.serviceUnavailable('Could not queue webhook replay');
  return data;
 },
 async dispatchPending(workspaceId?:string):Promise<boolean> {
  const {data,error}=await supabaseAdmin.rpc('claim_webhook_delivery',{p_workspace:workspaceId||null});
  if(error)throw AppError.serviceUnavailable('Webhook queue unavailable');
  const delivery=data?.[0];if(!delivery)return false;
  const {data:endpoint,error:endpointError}=await supabaseAdmin.from('webhook_endpoints').select('*').eq('id',delivery.webhook_endpoint_id).eq('status','active').maybeSingle();
  if(endpointError)throw AppError.serviceUnavailable('Webhook endpoint unavailable');
  let status=0;
  try {
   if(endpoint){const body=JSON.stringify(delivery.payload);const signature=crypto.createHmac('sha256',endpoint.secret_hash).update(body).digest('hex');status=await sendWebhook(endpoint.url,body,{'Content-Type':'application/json','X-Media-Event':delivery.event_type,'X-Media-Delivery':delivery.id,'X-Media-Event-Id':delivery.event_id,'X-Media-Signature':signature});}
  }catch{/* Record bounded, retryable failure without endpoint URLs or secrets. */}
  const delivered=status>=200&&status<300;
  const next=new Date(Date.now()+Math.min(3600000,10000*2**delivery.attempt_count)).toISOString();
  const {error:saveError}=await supabaseAdmin.from('webhook_deliveries').update({status:delivered?'delivered':delivery.attempt_count>=8||!endpoint?'failed':'pending',http_status:status||null,response_summary:status?'HTTP '+status:'Delivery unavailable',next_attempt_at:delivered?null:next,lease_token:null,lease_expires_at:null}).eq('id',delivery.id).eq('lease_token',delivery.lease_token);
  if(saveError)throw AppError.serviceUnavailable('Webhook outcome could not be saved');
  return true;
 }
};
