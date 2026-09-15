import { videoWorkerService } from '../src/services/videoWorkerService';
import { jobQueueService } from '../src/services/jobQueueService';
import { workerFleetService } from '../src/services/workerFleetService';
import { uploadSessionService } from '../src/services/uploadSessionService';
import { webhookService } from '../src/services/webhookService';
import { supabaseAdmin } from '../src/lib/supabase/admin';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

async function main() {
  const once=process.argv.includes('--once');
  const workspaceArg=process.argv.indexOf('--workspace-id');
  const workspaceId=workspaceArg>=0?process.argv[workspaceArg+1]:undefined;
  if(workspaceArg>=0&&!workspaceId)throw new Error('--workspace-id requires a value');
  if(process.argv.includes('--http'))throw new Error('Run the durable direct worker; HTTP processing has server request time limits');
  const workerId='daemon_'+randomUUID();
  let running=true; let currentJob:string|null=null; let lastMaintenance=0;
  const stop=()=>{running=false;};process.on('SIGTERM',stop);process.on('SIGINT',stop);
  await workerFleetService.registerWorker({workerId,capabilities:{max_concurrency:1}});
  const heartbeat=setInterval(()=>{void workerFleetService.heartbeat(workerId,currentJob?'busy':'online',currentJob).catch(()=>console.error('Worker fleet heartbeat failed'));},15000);
  try {
    do {
      let job;
      if(workspaceId){const {data,error}=await supabaseAdmin.rpc('claim_processing_job_scoped',{p_worker_id:workerId,p_workspace_id:workspaceId,p_lease_seconds:300,p_job_run_id:randomUUID()});if(error)throw new Error('Queue claim failed');job=data?.[0];}
      else job=await jobQueueService.claimNextJob(workerId);
      if(job){currentJob=job.id;const result=await videoWorkerService.processJob(job.id,workerId);console.log(JSON.stringify({job_id:job.id,status:result.status}));currentJob=null;}
      // Scoped runs must never clean or deliver another workspace's data.
      if(!workspaceId&&!once&&Date.now()-lastMaintenance>60000){await uploadSessionService.cleanupExpiredSessions();lastMaintenance=Date.now();}
      if(!once)await webhookService.dispatchPending(workspaceId);
      if(once)break;
      if(!job)await delay(Math.max(1000,Number(process.env.WORKER_POLL_INTERVAL_MS)||3000));
    } while(running);
  } finally {clearInterval(heartbeat);await workerFleetService.deregisterWorker(workerId);}
}
main().catch(error=>{console.error('Worker stopped:',error instanceof Error?error.message:'Unexpected failure');process.exitCode=1;});
