#!/usr/bin/env python3
"""Apply the dedicated sync migration using a secure management-token environment.
Never prints, persists or ships administrative credentials.
"""
import base64
import json
import os
from pathlib import Path
import urllib.request
import urllib.error

ROOT=Path(__file__).resolve().parents[1]
PROJECT='eupkdyhngmrsbvmaondp'
ORIGIN='https://planejamento-medicina-independente.vercel.app'
TOKEN=os.environ.get('SUPABASE_ACCESS_TOKEN')
if not TOKEN:raise SystemExit('Configure SUPABASE_ACCESS_TOKEN nos segredos do ambiente; não envie por chat.')

def management(path,method='GET',payload=None):
    body=None if payload is None else json.dumps(payload).encode()
    req=urllib.request.Request('https://api.supabase.com/v1/projects/'+PROJECT+path,data=body,method=method,headers={'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=45) as response:return json.load(response)
    except urllib.error.HTTPError as error:
        # Responses may contain secrets. Report only operation and status.
        raise SystemExit('Supabase recusou '+method+' '+path+' (HTTP '+str(error.code)+').') from None

project=management('')
if project.get('id')!=PROJECT:raise SystemExit('Projeto Supabase diferente do solicitado.')
keys=management('/api-keys')
public=None
for key in keys:
    if key.get('name')=='anon' and key.get('api_key'):
        candidate=key['api_key']
        try:role=json.loads(base64.urlsafe_b64decode(candidate.split('.')[1]+'===')).get('role')
        except (ValueError,IndexError):continue
        if role=='anon':public=candidate;break
if public is None:raise SystemExit('Não foi encontrada uma chave pública anon. Nenhuma chave administrativa será usada no app.')
management('/database/query','POST',{'query':(ROOT/'supabase/migrations/001_planejamento_sync.sql').read_text()})
check=management('/database/query','POST',{'query':"select c.relrowsecurity as rls_enabled,has_table_privilege('anon','public.planejamento_documents','SELECT') as anonymous_read,has_table_privilege('authenticated','public.planejamento_documents','UPDATE') as direct_write,has_function_privilege('authenticated','public.planejamento_write(bigint,jsonb)','EXECUTE') as authenticated_rpc from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='planejamento_documents';"})
row=check[0] if isinstance(check,list) and check else {}
if not row.get('rls_enabled') or row.get('anonymous_read') or row.get('direct_write') or not row.get('authenticated_rpc'):
    raise SystemExit('As permissões de sincronização não passaram na conferência. O login ainda não será ativado.')
auth=management('/config/auth')
redirects=set(filter(None,(auth.get('uri_allow_list') or '').split(',')))
redirects.add(ORIGIN+'/**')
management('/config/auth','PATCH',{'site_url':ORIGIN,'uri_allow_list':','.join(sorted(redirects))})
config={'url':'https://'+PROJECT+'.supabase.co','publishableKey':public}
(ROOT/'planning-config.js').write_text('/* Public client key only; account access is enforced by Supabase RLS. */\nwindow.PLANNING_CONFIG='+json.dumps(config,separators=(',',':'))+';\n')
print('Migração aplicada, RLS e permissões conferidas; login configurado para o site existente.')
print('Somente a URL e a chave pública anon foram salvas na configuração do aplicativo.')
