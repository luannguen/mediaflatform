const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {build}=require('esbuild');
(async()=>{
 const root=__dirname;
 for(const [format,outfile] of [['cjs','index.js'],['esm','index.mjs']])await build({entryPoints:[path.join(root,'index.ts')],outfile:path.join(root,'dist',outfile),bundle:true,format,platform:'neutral',target:'es2020',sourcemap:true});
 execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'-p',path.join(root,'tsconfig.json')],{stdio:'inherit',windowsHide:true});
})().catch(e=>{console.error(e.message);process.exitCode=1;});
