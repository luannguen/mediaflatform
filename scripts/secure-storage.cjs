require('@next/env').loadEnvConfig(process.cwd());
const {createClient}=require('@supabase/supabase-js');
async function main(){
 const bucket=process.env.SUPABASE_STORAGE_BUCKET||'media-assets';
 const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 if(process.argv.includes('--apply')){const {error}=await client.storage.updateBucket(bucket,{public:false});if(error)throw error;}
 const {data,error}=await client.storage.getBucket(bucket);if(error)throw error;
 console.log(JSON.stringify({bucket:data.id,public:data.public}));
 if(data.public)throw new Error('Media bucket must be private; run secure-storage.cjs --apply after preparing gateway consumers');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
