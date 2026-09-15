require('@next/env').loadEnvConfig(process.cwd());
require('tsx/cjs');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const sharp=require('sharp');
const {databaseClient}=require('./lib/database.cjs');
const {supabaseAdmin}=require('../src/lib/supabase/admin.ts');
const {generateApiKey}=require('../src/lib/security/api-key.ts');
const {videoWorkerService}=require('../src/services/videoWorkerService.ts');
const {listStorageTree,purgeService}=require('../src/services/purgeService.ts');
const {getStorageProvider}=require('../src/lib/storage/factory.ts');
const base=process.env.TEST_BASE_URL||'http://localhost:3100';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('HTTP integration checks require a local application');

function pdfFixture(){
  const stream='0.1 0.4 0.8 rg 20 20 180 120 re f\nBT /F1 22 Tf 25 170 Td (Production PDF fixture) Tj ET\n';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`];
  let text='%PDF-1.7\n';const offsets=[0];
  objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const start=Buffer.byteLength(text);text+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;return Buffer.from(text);
}
async function main(){
 const c=databaseClient();await c.connect();
 const suffix=crypto.randomUUID(); const ws='test_ws_'+suffix,other='test_other_'+suffix,org='test_org_'+suffix;
 const app='app_'+suffix,account='sa_'+suffix,keyId='key_'+suffix;
 const userIds=[];const assetIds=[];const password=crypto.randomBytes(24).toString('base64url');
 const key=generateApiKey();let cookie='';let checks=0;
 const request=async(path,method='GET',body,headers={})=>{
  const response=await fetch(base+path,{method,headers:{'X-Media-Api-Key':key.rawKey,...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,redirect:'manual'});
  const data=await response.json().catch(()=>null);return {response,data};
 };
 const expect=async(path,method,body,status,headers)=>{const r=await request(path,method,body,headers);assert.equal(r.response.status,status,`${method} ${path}: ${JSON.stringify(r.data)}`);checks++;return r;};
 try{
  const email='production-check-'+suffix+'@example.invalid';
  const {data:auth,error:authError}=await supabaseAdmin.auth.admin.createUser({email,password,email_confirm:true});if(authError)throw authError;userIds.push(auth.user.id);
  await c.query('insert into public.organizations(id,name,slug,owner_user_id) values($1,$1,$1,$2)',[org,auth.user.id]);
  for(const id of [ws,other])await c.query('insert into public.workspaces(id,organization_id,name,slug) values($1,$2,$1,$1)',[id,org]);
  await c.query("insert into public.workspace_memberships(id,workspace_id,user_id,role_id,status) values($1,$2,$3,'role_owner','active')",['mem_'+suffix,ws,auth.user.id]);
  await c.query('insert into public.applications(id,workspace_id,name,slug) values($1,$2,$1,$1)',[app,ws]);
  await c.query('insert into public.service_accounts(id,workspace_id,application_id,name) values($1,$2,$3,$1)',[account,ws,app]);
  await c.query("insert into public.api_keys(id,workspace_id,service_account_id,name,key_prefix,key_hash,scopes) values($1,$2,$3,'Fixture',$4,$5,ARRAY['*'])",[keyId,ws,account,key.keyPrefix,key.keyHash]);
  await expect('/api/v1/assets','GET',undefined,401,{'X-Media-Api-Key':'','X-Dev-Bypass':'media_dev_testing'});
  await expect('/api/v1/demo/session','POST',{},404);
  const login=await expect('/api/v1/auth/login','POST',{email,password},200,{'X-Media-Api-Key':''});cookie=login.response.headers.get('set-cookie').split(';')[0];assert.equal(login.data.data.workspace.id,ws);
  await expect('/api/v1/workspaces/'+other+'/members','GET',undefined,403,{Cookie:cookie,'X-Media-Api-Key':''});
  await expect('/api/v1/jobs/process','POST',{},403,{Cookie:cookie,'X-Media-Api-Key':''});
  await expect('/api/v1/folders','POST',{name:'CSRF fixture'},403,{Cookie:cookie,Origin:'https://untrusted.example','X-Media-Api-Key':''});
  await c.query("insert into public.webhook_endpoints(id,workspace_id,name,url,events,secret_hash) values($1,$2,'Fixture','https://example.invalid/hooks',ARRAY['*'],'fixture-never-delivered')",['wh_'+suffix,ws]);
  const endpoints=await expect('/api/v1/webhooks','GET',undefined,200);assert.equal(endpoints.data.data[0].secret_hash,undefined);checks++;
  const idem='fixture-'+suffix;
  const folders=await Promise.all([request('/api/v1/folders','POST',{name:'Replay fixture'},{'Idempotency-Key':idem}),request('/api/v1/folders','POST',{name:'Replay fixture'},{'Idempotency-Key':idem})]);
  assert.ok(folders.some(r=>r.response.status===201));assert.ok(folders.every(r=>[201,409].includes(r.response.status)),JSON.stringify(folders.map(r=>r.data)));checks++;
  const replay=await expect('/api/v1/folders','POST',{name:'Replay fixture'},201,{'Idempotency-Key':idem});assert.equal(replay.response.headers.get('Idempotency-Replayed'),'true');checks++;
  await expect('/api/v1/folders','POST',{name:'Different payload'},409,{'Idempotency-Key':idem});
  const upload=async(buffer,mime,filename)=>{
   const created=await expect('/api/v1/uploads/sessions','POST',{filename,file_size:buffer.length,mime_type:mime},201);
   const {session,capability}=created.data.data;
   const put=await fetch(capability.uploadUrl,{method:capability.method,headers:capability.headers,body:buffer});assert.ok(put.ok,'Storage PUT failed: '+put.status);checks++;
   const done=await expect('/api/v1/uploads/sessions/'+session.id+'/complete','POST',{checksum:crypto.createHash('sha256').update(buffer).digest('hex')},201);
   const result=done.data.data;assetIds.push(result.asset.id);
   assert.equal(result.asset.status,'uploading');checks++;
   const pending=await fetch(base+'/api/v1/delivery/'+result.asset.id,{headers:{'X-Media-Api-Key':key.rawKey}});assert.equal(pending.status,425);checks++;
   const worker='fixture_'+suffix;const run=crypto.randomUUID();
   const {data:jobs,error}=await supabaseAdmin.rpc('claim_processing_job_scoped',{p_worker_id:worker,p_workspace_id:ws,p_lease_seconds:300,p_job_run_id:run});if(error)throw error;assert.equal(jobs[0].id,result.job.id);
   const job=await videoWorkerService.processJob(jobs[0].id,worker);return {result,job};
  };
  const png=await sharp({create:{width:320,height:180,channels:3,background:'#217bc1'}}).png().toBuffer();
  const image=await upload(png,'image/png','fixture.png');assert.equal(image.job.status,'completed');checks++;
  const privateResponse=await fetch(base+'/api/v1/delivery/'+image.result.asset.id);assert.equal(privateResponse.status,401);checks++;
  const imageResponse=await fetch(base+'/api/v1/delivery/'+image.result.asset.id+'?w=160',{headers:{'X-Media-Api-Key':key.rawKey}});assert.equal(imageResponse.status,200);assert.match(imageResponse.headers.get('cache-control'),/private/);assert.equal((await sharp(Buffer.from(await imageResponse.arrayBuffer())).metadata()).width,160);checks++;
  const pdf=await upload(pdfFixture(),'application/pdf','fixture.pdf');assert.equal(pdf.job.status,'completed');checks++;
  const {data:pdfAsset}=await supabaseAdmin.from('assets').select('*').eq('id',pdf.result.asset.id).single();assert.equal(pdfAsset.metadata_json.document.page_count,1);
  const preview=await getStorageProvider().download(pdfAsset.metadata_json.document.thumbnail_key);assert.ok(preview.length>1000);fs.mkdirSync('scratch/test-artifacts',{recursive:true});fs.writeFileSync('scratch/test-artifacts/pdf-preview.webp',preview);checks++;
  const videoPath='scratch/test-artifacts/video.mp4';
  require('node:child_process').execFileSync(require('@ffmpeg-installer/ffmpeg').path,['-y','-f','lavfi','-i','testsrc=size=320x240:rate=15','-t','2','-pix_fmt','yuv420p',videoPath],{windowsHide:true,stdio:'pipe',timeout:30000});
  const video=await upload(fs.readFileSync(videoPath),'video/mp4','fixture.mp4');assert.equal(video.job.status,'completed',JSON.stringify(video.job));checks++;
  const playlist=await fetch(base+'/api/v1/delivery/video/'+video.result.asset.id+'/master.m3u8',{headers:{'X-Media-Api-Key':key.rawKey}});assert.equal(playlist.status,200);assert.match(await playlist.text(),/#EXTM3U/);checks++;
  const publicUrl=supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET||'media-assets').getPublicUrl(image.result.asset.storage_key).data.publicUrl;
  assert.equal((await fetch(publicUrl)).ok,false,'Private bucket allowed public source access');checks++;
  const invalid=await upload(Buffer.from('This is not a PNG image. Its filename and MIME are deceptive.'),'image/png','spoof.png');assert.notEqual(invalid.job.status,'completed');checks++;
  await expect('/api/v1/assets/'+image.result.asset.id,'DELETE',undefined,200);
  await expect('/api/v1/assets/'+image.result.asset.id+'/restore','POST',{},200);
  // Exercise recursive storage inventory beyond the provider's usual default page of 100.
  const nestedPrefix='transforms/'+image.result.asset.id+'/nested';
  for(let offset=0;offset<105;offset+=15)await Promise.all(Array.from({length:Math.min(15,105-offset)},(_,i)=>getStorageProvider().upload(Buffer.from('fixture'),nestedPrefix+'/'+(offset+i)+'.txt','text/plain')));
  assert.equal((await listStorageTree(process.env.SUPABASE_STORAGE_BUCKET||'media-assets',nestedPrefix)).length,105);checks++;
  const storage=getStorageProvider(),originalDelete=storage.delete;
  try{storage.delete=async()=>false;await assert.rejects(()=>purgeService.purgeAssetArtifactGraph(image.result.asset.id,ws),/deletion failed/);}finally{storage.delete=originalDelete;}
  const retained=(await c.query('select metadata_json from public.assets where id=$1',[image.result.asset.id])).rows[0];assert.equal(retained.metadata_json.purge_pending,true);checks++;
  const purged=await purgeService.purgeAssetArtifactGraph(image.result.asset.id,ws);assert.equal(purged.success,true);assert.ok(purged.storageKeysDeleted.length>105);assert.equal((await listStorageTree(process.env.SUPABASE_STORAGE_BUCKET||'media-assets',nestedPrefix)).length,0);checks++;
  const outbox=await expect('/api/v1/webhooks/deliveries','GET',undefined,200);assert.ok(outbox.data.data.length>=4);checks++;
  const log=(await c.query('select count(*)::int as n from public.api_request_logs where workspace_id=$1',[ws])).rows[0];assert.ok(log.n>=10);checks++;
  console.log('Production HTTP/media checks passed: '+checks);
 } finally {
  // Cleanup exactly this run's fixture graph, never drain the existing queue or send webhooks.
  const {rows:sessions}=await c.query('select storage_key from public.upload_sessions where workspace_id=$1',[ws]);
  for(const row of sessions)await getStorageProvider().delete(row.storage_key);
  for(const assetId of assetIds)for(const prefix of ['images','videos','documents','transforms'])for(const key of await listStorageTree(process.env.SUPABASE_STORAGE_BUCKET||'media-assets',prefix+'/'+assetId))await getStorageProvider().delete(key);
  await c.query('delete from public.webhook_endpoints where workspace_id = any($1::text[])',[[ws,other]]);
  await c.query('delete from public.workspaces where id = any($1::text[])',[[ws,other]]);
  await c.query('delete from public.organizations where id=$1',[org]);
  for(const userId of userIds){const {error}=await supabaseAdmin.auth.admin.deleteUser(userId);if(error)throw error;}
  await c.end();
 }
}
main().catch(error=>{console.error('HTTP/media check failed:',error.message);process.exitCode=1;});
