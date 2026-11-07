#!/usr/bin/env python3
"""Apply the Screech development deployment to the existing lab cluster."""
import argparse,base64,json,re,secrets,subprocess
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--image',default='registry.dumont.com.ar:5000/screech:dev-20261107-06')
a=p.parse_args()
if not re.fullmatch(r'[A-Za-z0-9:/.@_-]+',a.image):p.error('invalid image reference')
def run(args,**kwargs):return subprocess.run(['kubectl',*args],text=True,check=True,**kwargs)
def exists(name):return subprocess.run(['kubectl','get','secret',name,'-n','screech-dev'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
def create(obj):run(['create','-f','-'],input=json.dumps(obj))
run(['apply','-f','infra/k8s/namespace.yaml'])
if not exists('regcred'):
    original=json.loads(subprocess.check_output(['kubectl','get','secret','regcred','-n','coffee-api-dev','-o','json'],text=True))
    create({'apiVersion':'v1','kind':'Secret','metadata':{'name':'regcred','namespace':'screech-dev'},'type':original['type'],'data':original['data']})
if not exists('screech-livekit'):
    values={'LIVEKIT_API_KEY':'screech-dev','LIVEKIT_API_SECRET':secrets.token_hex(32)}
    create({'apiVersion':'v1','kind':'Secret','metadata':{'name':'screech-livekit','namespace':'screech-dev'},'type':'Opaque','data':{k:base64.b64encode(v.encode()).decode() for k,v in values.items()}})
manifest=re.sub(r'registry\.dumont\.com\.ar:5000/screech:[A-Za-z0-9._-]+',a.image,Path('infra/k8s/app.yaml').read_text())
run(['apply','-f','-'],input=manifest)
for name in ['livekit','screech']:run(['rollout','status','deployment/'+name,'-n','screech-dev','--timeout=300s'])
run(['get','pods,pvc,services','-n','screech-dev'])
print('IngressRoute configurado: https://voice.masivo.com.ar — verificar HTTPS y medios desde Internet.')
