"""Authenticated schedule analysis. Uploads are transient and never logged or stored."""
from http.server import BaseHTTPRequestHandler
import json,os,urllib.request,urllib.error
from urllib.parse import unquote
from lib.schedule_parser import analyze

class handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def reply(self,status,body):
        raw=json.dumps(body,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','private, no-store')
        self.end_headers();self.wfile.write(raw)
    def do_POST(self):
        authorization=self.headers.get('Authorization','')
        if not authorization.startswith('Bearer '): return self.reply(401,{'error':'Entre na sua conta para importar a planilha.'})
        url=os.environ.get('PLANNING_SUPABASE_URL','')
        key=os.environ.get('PLANNING_SUPABASE_PUBLIC_KEY','')
        if not url or not key: return self.reply(503,{'error':'A importação está temporariamente indisponível. Tente novamente mais tarde.'})
        headers={'apikey':key,'Authorization':authorization}
        try:
            with urllib.request.urlopen(urllib.request.Request(url+'/auth/v1/user',headers=headers),timeout=10) as response: user=json.load(response)
            owner=user.get('id')
            if not owner: return self.reply(401,{'error':'Entre novamente na sua conta.'})
            with urllib.request.urlopen(urllib.request.Request(url+'/rest/v1/profiles?select=approved&id=eq.'+owner,headers=headers),timeout=10) as response: profiles=json.load(response)
            if not profiles or profiles[0].get('approved') is not True: return self.reply(403,{'error':'Sua conta ainda aguarda aprovação do administrador.'})
        except urllib.error.HTTPError as error:
            return self.reply(401 if error.code in [401,403] else 503,{'error':'Não foi possível verificar seu acesso. Entre novamente ou tente mais tarde.'})
        except (OSError,ValueError): return self.reply(503,{'error':'Não foi possível verificar sua conta. Tente novamente.'})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size<=0 or size>3000000: return self.reply(413,{'error':'Envie um arquivo de até 3 MB.'})
            filename=unquote(self.headers.get('X-File-Name','')).split('/')[-1].split('\\')[-1]
            result=analyze(self.rfile.read(size),filename)
            if len(json.dumps(result).encode())>1300000: return self.reply(413,{'error':'O cronograma gerado é muito grande para sincronizar. Divida o arquivo.'})
            return self.reply(200,result)
        except ValueError as error: return self.reply(422,{'error':str(error)})
        except Exception: return self.reply(422,{'error':'Não foi possível interpretar este arquivo. Confira o formato ou use a versão Excel/CSV.'})
    def do_GET(self): self.reply(405,{'error':'Envie a planilha pelo formulário de importação.'})
