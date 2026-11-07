#!/usr/bin/env python3
"""Build a Dockerfile in Kubernetes without a local Docker daemon.
Registry auth stays inside Kubernetes; source excludes .env, data and binaries.
"""
import argparse,datetime,json,subprocess,tarfile,tempfile
from pathlib import Path

def run(args,**kwargs):
    return subprocess.run(args,text=True,check=True,**kwargs)
def apply(obj):
    run(['kubectl','apply','-f','-'],input=json.dumps(obj))
p=argparse.ArgumentParser()
p.add_argument('--image',required=True)
p.add_argument('--namespace',default='screech-dev')
a=p.parse_args()
namespace=a.namespace
job='screech-build-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
# Copy existing registry credentials without printing them or writing to disk.
secret=json.loads(subprocess.check_output(['kubectl','get','secret','regcred','-n','coffee-api-dev','-o','json'],text=True))
apply({'apiVersion':'v1','kind':'Secret','metadata':{'name':'regcred','namespace':namespace},'type':secret['type'],'data':secret['data']})
with tempfile.TemporaryDirectory() as directory:
    archive=Path(directory)/'source.tgz'
    with tarfile.open(archive,'w:gz') as tar:
        for name in ['Dockerfile','package.json','package-lock.json','tsconfig.json','server','scripts','web/index.html','web/vite.config.ts','web/src','web/public']:
            tar.add(name,arcname=name,filter=lambda info: None if '__pycache__' in Path(info.name).parts or info.name.endswith('.pyc') else info)
    run(['kubectl','create','configmap',job,'-n',namespace,'--from-file=source.tgz='+str(archive)])
apply({'apiVersion':'batch/v1','kind':'Job','metadata':{'name':job,'namespace':namespace,'labels':{'app.kubernetes.io/part-of':'screech'}},'spec':{'ttlSecondsAfterFinished':3600,'backoffLimit':0,'activeDeadlineSeconds':1200,'template':{'spec':{
    'restartPolicy':'Never','automountServiceAccountToken':False,
    'hostAliases':[{'ip':'10.10.50.13','hostnames':['registry.dumont.com.ar']}],
    'initContainers':[{'name':'source','image':'busybox:1.37','command':['sh','-c','tar xzf /source/source.tgz -C /workspace'],'volumeMounts':[{'name':'source','mountPath':'/source','readOnly':True},{'name':'workspace','mountPath':'/workspace'}]}],
    'containers':[{'name':'build','image':'gcr.io/kaniko-project/executor:v1.23.2','args':['--dockerfile=/workspace/Dockerfile','--context=dir:///workspace','--destination='+a.image,'--insecure','--insecure-pull','--insecure-registry=registry.dumont.com.ar:5000','--skip-unused-stages=true'],'resources':{'requests':{'cpu':'250m','memory':'512Mi'},'limits':{'cpu':'2','memory':'2Gi'}},'volumeMounts':[{'name':'workspace','mountPath':'/workspace'},{'name':'registry','mountPath':'/kaniko/.docker','readOnly':True}]}],
    'volumes':[{'name':'source','configMap':{'name':job}},{'name':'workspace','emptyDir':{}},{'name':'registry','secret':{'secretName':'regcred','items':[{'key':'.dockerconfigjson','path':'config.json'}]}}]
}}}})
uid=subprocess.check_output(['kubectl','get','job',job,'-n',namespace,'-o','jsonpath={.metadata.uid}'],text=True)
run(['kubectl','patch','configmap',job,'-n',namespace,'--type=merge','-p',json.dumps({'metadata':{'ownerReferences':[{'apiVersion':'batch/v1','kind':'Job','name':job,'uid':uid}]}})])
print('Build job:',job)
