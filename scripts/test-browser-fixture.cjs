require('@next/env').loadEnvConfig(process.cwd());require('tsx/cjs');
const fs=require('node:fs');const crypto=require('node:crypto');const sharp=require('sharp');
const {databaseClient}=require('./lib/database.cjs');const {supabaseAdmin}=require('../src/lib/supabase/admin.ts');
const {getStorageProvider}=require('../src/lib/storage/factory.ts');const {createSessionToken}=require('../src/lib/auth/session.ts');
const registry='scratch/browser-fixture.json';const state='scratch/browser-state.json';
async function main(){
 const c=databaseClient();await c.connect();
 try {
  if(process.argv.includes('--cleanup')){
   if(!fs.existsSync(registry))return;const f=JSON.parse(fs.readFileSync(registry,'utf8'));
   if(!f.ws.startsWith('test_browser_')||f.org!=='org_'+f.ws||f.key!==`uploads/${f.ws}/fixture.png`)throw new Error('Invalid fixture cleanup scope');
   const {listStorageTree}=require('../src/services/purgeService.ts');
   for(const prefix of ['images','videos','documents','transforms'])for(const key of await listStorageTree(process.env.SUPABASE_STORAGE_BUCKET||'media-assets',prefix+'/'+f.assetId))await getStorageProvider().delete(key);
   await getStorageProvider().delete(f.key);
   await c.query('delete from public.workspaces where id=$1',[f.ws]);await c.query('delete from public.organizations where id=$1',[f.org]);
   const {error}=await supabaseAdmin.auth.admin.deleteUser(f.userId);if(error)throw error;
   fs.unlinkSync(registry);if(fs.existsSync(state))fs.unlinkSync(state);console.log('Browser fixtures cleaned');return;
  }
  if(fs.existsSync(registry))throw new Error('Clean up the previous browser fixture before creating another');
  const ws='test_browser_'+crypto.randomUUID(),org='org_'+ws,key=`uploads/${ws}/fixture.png`,assetId='med_'+crypto.randomUUID().replaceAll('-','');
  const email=ws+'@example.invalid';const {data,error}=await supabaseAdmin.auth.admin.createUser({email,password:crypto.randomBytes(32).toString('base64url'),email_confirm:true,user_metadata:{full_name:'Production verification'}});if(error)throw error;
  const userId=data.user.id;fs.writeFileSync(registry,JSON.stringify({ws,org,key,assetId,userId}));
  await c.query("insert into public.organizations(id,name,slug,owner_user_id) values($1,'Verification',$1,$2)",[org,userId]);
  await c.query("insert into public.workspaces(id,organization_id,name,slug) values($1,$2,'Production verification',$1)",[ws,org]);
  await c.query("insert into public.workspace_memberships(id,workspace_id,user_id,role_id,status) values($1,$2,$3,'role_owner','active')",['mem_'+ws,ws,userId]);
  const buffer=await sharp({create:{width:640,height:360,channels:3,background:'#2378b8'}}).png().toBuffer();
  await getStorageProvider().upload(buffer,key,'image/png');
  await c.query("insert into public.assets(id,workspace_id,asset_type,original_filename,display_name,mime_type,extension,size_bytes,width,height,storage_provider,storage_bucket,storage_key,checksum,visibility,status,processing_status,metadata_json) values($1,$2,'image','fixture.png','Verified media fixture','image/png','png',$3,640,360,'supabase',$4,$5,$6,'workspace','active','ready','{\"checksum_verified\":true}')",[assetId,ws,buffer.length,process.env.SUPABASE_STORAGE_BUCKET||'media-assets',key,crypto.createHash('sha256').update(buffer).digest('hex')]);
  const token=await createSessionToken({userId,email,name:'Production verification',role:'owner',workspaceId:ws,organizationId:org},3600);
  fs.writeFileSync(state,JSON.stringify({cookies:[{name:'mda_session',value:token,domain:'localhost',path:'/',expires:Math.floor(Date.now()/1000)+3600,httpOnly:true,secure:false,sameSite:'Lax'}],origins:[]}));
  console.log('Browser fixture ready; authentication state stored in gitignored scratch directory');
 }finally{await c.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
