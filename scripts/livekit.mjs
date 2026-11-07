import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {livekitConfig} from './livekit-config.mjs';
const directory=mkdtempSync(join(tmpdir(),'screech-livekit-'));
try {
  const filename=join(directory,'config.yaml');
  // JSON is also valid YAML; encoding keeps secrets and URLs safely quoted.
  writeFileSync(filename,JSON.stringify(livekitConfig()),{mode:0o600});
  const child=spawn(process.env.LIVEKIT_BINARY??'.local/bin/livekit-server',['--config',filename],{stdio:'inherit'});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
  child.on('error',error=>{console.error(error.message);rmSync(directory,{recursive:true,force:true});process.exitCode=1});
  child.on('exit',(code)=>{rmSync(directory,{recursive:true,force:true});process.exitCode=code??1});
} catch(error) {rmSync(directory,{recursive:true,force:true});throw error;}
