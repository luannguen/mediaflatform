import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../src/lib/security/resourceAuthorization';
import { safeRedirect } from '../src/lib/auth/redirect';
import { inspectSvgSafety } from '../src/lib/media/svgSanitizer';
import { validateDeclaredVsDetectedMime } from '../src/lib/media/magicByteValidator';
import { validateUploadLimits } from '../src/lib/security/uploadPolicy';
import { getDeliveryPolicy } from '../src/lib/media/deliveryPolicy';
import { getTransformCacheKey } from '../src/lib/media/transformPolicy';
import { validateWebhookUrl } from '../src/lib/security/webhookTransport';
import { createSessionToken, verifySessionToken } from '../src/lib/auth/session';
import { MediaPlatformClient } from '../packages/sdk/index';
import type { Asset } from '../src/types/database';
import type { AuthPrincipal } from '../src/lib/security/auth-guard';

const asset={id:'med_fixture',workspace_id:'ws_one',status:'active',visibility:'private',mime_type:'image/png',asset_type:'image',display_name:'Fixture',original_filename:'fixture.png',extension:'png'} as Asset;
const principal={type:'api_key',workspaceId:'ws_one',scopes:['assets:delete']} as AuthPrincipal;

test('delete permission does not authorize purge or changing visibility',()=>{
 assert.equal(authorize(principal,'asset.delete',asset).allowed,true);
 assert.equal(authorize(principal,'asset.purge',asset).allowed,false);
 assert.equal(authorize(principal,'asset.change_visibility',asset).allowed,false);
});
test('worker and foreign workspace identities cannot mutate assets',()=>{
 assert.equal(authorize({...principal,type:'worker_service',scopes:['*']},'asset.update',asset).allowed,false);
 assert.equal(authorize({...principal,workspaceId:'ws_other',scopes:['*']},'asset.update',asset).allowed,false);
});
test('redirects cannot escape the application origin',()=>{
 for(const value of ['https://evil.example','//evil.example','/\\evil.example','/\nevil.example','javascript:alert(1)'])assert.equal(safeRedirect(value),'/');
 assert.equal(safeRedirect('/library?filter=image'),'/library?filter=image');
});
test('SVG active content and external resources are rejected',()=>{
 for(const value of ['<svg onbegin="x"/>','<svg><image href="https://evil.example/x"/></svg>','<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>','<svg><style>@import url(x)</style></svg>','<svg><a href="&#106;avascript:x"/></svg>'])assert.equal(inspectSvgSafety(value).isSafe,false);
 assert.equal(inspectSvgSafety('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>').isSafe,true);
});
test('upload size and byte signatures cannot be forged by MIME or filename',()=>{
 for(const size of [-1,0,NaN,Infinity,0.5,26*1024*1024])assert.throws(()=>validateUploadLimits('image',size));
 validateUploadLimits('image',1024);
 assert.throws(()=>validateDeclaredVsDetectedMime('image/png',Buffer.from('%PDF-1.7 invalid'),'photo.png'));
});
test('delivery caches preserve privacy and require revalidation after visibility changes',()=>{
 assert.match(getDeliveryPolicy(asset).cacheControl,/private.*no-store/);
 const policy=getDeliveryPolicy({...asset,visibility:'public'});
 assert.match(policy.cacheControl,/max-age=0.*must-revalidate/);
 assert.match(policy.headers['Content-Security-Policy'],/sandbox/);
});
test('transform cache distinguishes watermark placement and focal crop',()=>{
 const base={width:300,height:200,watermark_text:'Fixture'};
 assert.notEqual(getTransformCacheKey(asset.id,'v1',{...base,watermark_pos:'top-left'}),getTransformCacheKey(asset.id,'v1',{...base,watermark_pos:'bottom-right'}));
 assert.notEqual(getTransformCacheKey(asset.id,'v1',{width:300,fit:'smart'}),getTransformCacheKey(asset.id,'v1',{width:300,fit:'cover'}));
});
test('webhook transport rejects credentials, IP literals and insecure schemes',()=>{
 for(const url of ['http://example.com','https://127.0.0.1','https://[::1]','https://user:secret@example.com','https://example.com:8080'])assert.throws(()=>validateWebhookUrl(url));
 assert.equal(validateWebhookUrl('https://example.com/hook').hostname,'example.com');
});
test('session signatures reject tampering and expiration',async()=>{
 process.env.SESSION_SECRET='unit-test-secret-with-no-production-use';
 const input={userId:'fixture',email:'fixture@example.invalid',name:'Fixture',role:'viewer' as const,workspaceId:'ws_one',organizationId:'org_one'};
 const token=await createSessionToken(input,60);
 assert.equal((await verifySessionToken(token))?.userId,'fixture');
 assert.equal(await verifySessionToken(token.slice(0,-8)+'tampered'),null);
 const now=Date.now;const future=now()+61000;
 try { Date.now=()=>future;assert.equal(await verifySessionToken(token),null); } finally { Date.now=now; }
});
test('SDK uploads through sessions for both small and large files and carries no API key to Storage',async()=>{
 const original=globalThis.fetch;
 try{
  const calls:{url:string;init?:RequestInit}[]=[];
  globalThis.fetch=async(input,init)=>{
   const url=String(input);calls.push({url,init});
   if(url.endsWith('/uploads/sessions'))return Response.json({data:{session:{id:'sess_fixture'},capability:{uploadUrl:'https://storage.example.invalid/upload',method:'PUT',headers:{'Content-Type':'image/png'}}}});
   if(url.includes('storage.example.invalid'))return new Response(null,{status:200});
   return Response.json({data:{asset:{id:'med_fixture'}}});
  };
  const sdk=new MediaPlatformClient({baseUrl:'https://api.example.invalid',apiKey:'fixture-only'});
  for(const size of [64,5*1024*1024]){
   calls.length=0;
   await sdk.assets.upload(new Blob([new Uint8Array(size)],{type:'image/png'}));
   assert.equal(calls.length,3);assert.ok(calls[0].url.endsWith('/uploads/sessions'));
   assert.equal(new Headers(calls[1].init?.headers).has('X-Media-Api-Key'),false);
   assert.ok(calls[2].url.endsWith('/sess_fixture/complete'));
  }
 }finally{globalThis.fetch=original;}
});
test('SDK does not retry an unfenced mutation after a network failure',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async()=>{calls++;throw new Error('Connection interrupted');};
  const sdk=new MediaPlatformClient({baseUrl:'https://api.example.invalid',apiKey:'fixture-only',maxRetries:3});
  await assert.rejects(()=>sdk.deleteAsset('med_fixture'));
  assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});

test('SDK list preserves the documented asset list and pagination total',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({success:true,data:[{id:'med_fixture'}],meta:{pagination:{total:2501}}});
  const result=await new MediaPlatformClient({baseUrl:'https://api.example.invalid',apiKey:'fixture-only'}).assets.list({limit:1});
  assert.deepEqual(result,{assets:[{id:'med_fixture'}],total:2501});
 }finally{globalThis.fetch=original;}
});
