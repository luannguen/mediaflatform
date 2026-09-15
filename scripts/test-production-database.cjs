const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { databaseClient } = require('./lib/database.cjs');

async function main() {
  const c=databaseClient(); await c.connect(); await c.query('BEGIN');
  let checks=0;
  const query=(sql,args)=>c.query(sql,args);
  const one=async(sql,args)=>(await query(sql,args)).rows[0];
  const id=crypto.randomUUID(); const ws='test_ws_'+id; const org='test_org_'+id;
  const expectError=async(sql,args,pattern)=>{
    await query('SAVEPOINT expected_failure');
    let failure;try{await query(sql,args);}catch(error){failure=error;}
    await query('ROLLBACK TO SAVEPOINT expected_failure');
    assert.match(failure?.message||'',pattern);checks++;
  };
  try {
    // Validate unapplied migrations and behavior in one transaction, never touching existing rows.
    for(const name of fs.readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort()) {
      const applied=await one('select 1 from public.platform_migrations where name=$1',[name]);
      if(!applied)await query(fs.readFileSync('supabase/migrations/'+name,'utf8'));
    }
    await query('insert into public.organizations(id,name,slug,owner_user_id) values($1,$1,$1,$2)',[org,id]);
    await query('insert into public.workspaces(id,organization_id,name,slug,quota_storage_bytes,quota_asset_count) values($1,$2,$1,$1,200,2)',[ws,org]);
    const invitee=crypto.randomUUID();
    for(const user of [id,invitee])await query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),'{}')",[user,user+'@example.invalid']);
    await query("insert into public.workspace_memberships(id,workspace_id,user_id,role_id,status) values($1,$2,$3,'role_owner','active')",['mem_'+id,ws,id]);
    const invited=(await one("select public.invite_workspace_member($1,$2,$3,'editor') as value",[ws,id,invitee+'@example.invalid'])).value;
    assert.ok(invited.id);checks++;
    await expectError("select public.respond_workspace_invitation($1,$2,'accepted')",[invited.id,id],/FORBIDDEN|EMAIL|DENIED|NOT_FOUND/);
    await query("select public.respond_workspace_invitation($1,$2,'accepted')",[invited.id,invitee]);
    await query("select public.respond_workspace_invitation($1,$2,'accepted')",[invited.id,invitee]);
    assert.equal((await one('select count(*)::int as n from public.workspace_memberships where workspace_id=$1 and user_id=$2',[ws,invitee])).n,1);checks++;
    await query("insert into public.webhook_endpoints(id,workspace_id,name,url,events,secret_hash,status) values($1,$2,'Fixture','https://example.invalid/webhook',ARRAY['*'],'test-only-secret','active')",['wh_'+id,ws]);
    const session='sess_'+id;
    const insertSession="insert into public.upload_sessions(id,workspace_id,filename,mime_type,size_bytes,status,storage_key,expires_at,requested_by_type,requested_by_id) values($1,$2,'fixture.png','image/png',120,'created',$1,now()+interval '1 hour','user',$3)";
    await query(insertSession,[session,ws,id]);
    await expectError(insertSession,['sess_second_'+id,ws,id],/QUOTA_EXCEEDED/);
    const wrong=(await one('select public.finalize_upload_session($1,$2,$3,null,120,null,null) as value',[session,ws,invitee])).value;
    assert.equal(wrong.success,false);checks++;
    const completed=(await one('select public.finalize_upload_session($1,$2,$3,null,120,null,null) as value',[session,ws,id])).value;
    assert.equal(completed.success,true);assert.equal(completed.asset.status,'uploading');assert.equal(completed.job.status,'queued');checks++;
    const duplicate=(await one('select public.finalize_upload_session($1,$2,$3,null,120,null,null) as value',[session,ws,id])).value;
    assert.equal(duplicate.asset.id,completed.asset.id);assert.equal(duplicate.idempotent,true);checks++;
    assert.equal((await one('select count(*)::int as n from public.webhook_deliveries where webhook_endpoint_id=$1',['wh_'+id])).n,1);checks++;
    const claimed=await one('select * from public.claim_processing_job_scoped($1,$2,300,$3)',['fixture_worker',ws,id]);
    assert.equal(claimed.id,completed.job.id);checks++;
    assert.equal((await one('select public.verify_job_source($1,$2,$3,$4) as ok',[claimed.id,'wrong_worker',id,'a'.repeat(64)])).ok,false);checks++;
    assert.equal((await one('select public.verify_job_source($1,$2,$3,$4) as ok',[claimed.id,'fixture_worker',id,'a'.repeat(64)])).ok,true);checks++;
    const publish=(await one("select public.publish_processed_asset($1,$2,$3,'v_fixture','{}','{}','[]') as result",[claimed.id,'fixture_worker',id])).result;
    assert.equal(publish.success,true);checks++;
    await query("update public.assets set status='trashed' where id=$1",[completed.asset.id]);
    const restored=await one('select * from public.restore_media_asset($1,$2)',[completed.asset.id,ws]);assert.equal(restored.status,'active');checks++;
    const ref='ref_'+id;
    const insertRef="insert into public.asset_references(id,workspace_id,asset_id,source_app,entity_type,entity_id) values($1,$2,$3,'fixture','test','one')";
    await query(insertRef,[ref,ws,completed.asset.id]);
    await expectError('select public.prepare_asset_purge($1,$2,false)',[completed.asset.id,ws],/ASSET_IN_USE/);
    await query('select public.prepare_asset_purge($1,$2,true)',[completed.asset.id,ws]);
    await expectError(insertRef,['ref_second_'+id,ws,completed.asset.id],/ASSET_REFERENCE_FORBIDDEN/);
    await expectError('select public.restore_media_asset($1,$2)',[completed.asset.id,ws],/PURGE_IN_PROGRESS/);
    await query('select public.finish_asset_purge($1,$2)',[completed.asset.id,ws]);
    assert.equal((await one('select count(*)::int as n from public.assets where id=$1',[completed.asset.id])).n,0);checks++;
    await query("insert into public.usage_metrics(id,workspace_id,event_type,bytes_transferred,bytes_saved,latency_ms,format) select $1||'_'||n,$2,case when n%5=0 then 'cache_hit' else 'delivery' end,10,5,7,'webp' from generate_series(1,2005) n",['met_'+id,ws]);
    const analytics=(await one("select public.workspace_media_analytics($1,now()-interval '1 day') as result",[ws])).result;
    assert.equal(analytics.totalRequests,2005);assert.equal(analytics.cacheHits,401);assert.equal(analytics.totalBytesTransferred,20050);assert.equal(analytics.recentEvents.length,20);checks++;
    await query('SET LOCAL ROLE anon');
    await expectError('select id from public.assets limit 1',[],/permission denied/);
    await expectError("select public.claim_next_processing_job('unauthorized')",[],/permission denied/);
    await query('RESET ROLE');
    console.log(`Production database checks: ${checks} passed; all fixtures and unapplied DDL rolled back.`);
  } finally {await query('ROLLBACK');await c.end();}
}
main().catch(error=>{console.error('Database check failed:',error.message);process.exitCode=1;});
