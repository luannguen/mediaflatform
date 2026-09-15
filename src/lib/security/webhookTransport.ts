import dns from 'node:dns/promises';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { AppError } from '@/lib/errors/app-error';

const blocked = new BlockList();
for (const [network, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.168.0.0',16],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]] as const) blocked.addSubnet(network,prefix);

export function validateWebhookUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw AppError.badRequest('A valid HTTPS webhook URL is required'); }
  if (url.protocol!=='https:' || url.username || url.password || url.hash || (url.port && url.port!=='443') || isIP(url.hostname) || url.hostname.startsWith('[')) throw AppError.badRequest('Webhook URLs require a public HTTPS hostname on port 443');
  return url;
}

/** DNS resolution is pinned into the TLS connection; redirects never follow. */
export async function sendWebhook(raw: string, body: string, headers: Record<string,string>): Promise<number> {
  const url=validateWebhookUrl(raw);
  const resolver = new dns.Resolver({ timeout: 5000, tries: 1 });
  const addresses=await resolver.resolve4(url.hostname);
  if (!addresses.length || addresses.some(ip=>blocked.check(ip))) throw new Error('Webhook destination is not public');
  const address=addresses[0];
  return new Promise((resolve,reject)=>{
    const request=https.request(url,{method:'POST',headers:{...headers,'Content-Length':String(Buffer.byteLength(body))},agent:false,lookup:(_host,_opts,cb)=>cb(null,address,4)},response=>{
      const status=response.statusCode || 0;
      response.destroy(); resolve(status);
    });
    const timeout=setTimeout(()=>request.destroy(new Error('Webhook request timed out')),10000);
    request.on('error',reject); request.on('close',()=>clearTimeout(timeout)); request.end(body);
  });
}
