"""Authenticated, on-demand question generation. Credentials and files are never logged."""
from http.server import BaseHTTPRequestHandler
import json,os,urllib.parse
from lib.question_sources import QuestionError,request,list_files,extract,prompt,generate,validate_questions

def verify(authorization):
    if not authorization.startswith('Bearer '): raise QuestionError('Entre na sua conta do Planejamento.',401)
    url=os.environ.get('PLANNING_SUPABASE_URL','');key=os.environ.get('PLANNING_SUPABASE_PUBLIC_KEY','')
    if not url or not key: raise QuestionError('Verificação da conta indisponível.',503)
    headers={'Authorization':authorization,'apikey':key}
    user=json.loads(request(url+'/auth/v1/user',headers,30000))
    owner=user.get('id')
    if not owner: raise QuestionError('Entre novamente na sua conta.',401)
    rows=json.loads(request(url+'/rest/v1/profiles?select=approved&id=eq.'+urllib.parse.quote(owner,safe=''),headers,30000))
    if not rows or rows[0].get('approved') is not True: raise QuestionError('Conta ainda não aprovada.',403)
    return owner

def execute(body):
    action=body.get('action')
    if action=='status': return {'geminiReady':bool(os.environ.get('GEMINI_API_KEY') and os.environ.get('GEMINI_MODEL') and os.environ.get('GEMINI_FREE_TIER_CONFIRMED')=='true')}
    if action=='list': return list_files(body.get('driveToken'),body.get('folder','root'),body.get('cursor',''))
    if action not in ('generate','prompt','validate'): raise QuestionError('Operação inválida.',400)
    count=body.get('count',10);subject=body.get('subject','Medicina');difficulty=body.get('difficulty','intermediária')
    if type(count)!=int or not 1<=count<=20 or not isinstance(subject,str) or len(subject)>100 or difficulty not in ('fácil','intermediária','avançada'): raise QuestionError('Confira a quantidade, disciplina e dificuldade.',400)
    if action=='generate' and not (os.environ.get('GEMINI_API_KEY') and os.environ.get('GEMINI_MODEL') and os.environ.get('GEMINI_FREE_TIER_CONFIRMED')=='true'):
        raise QuestionError('Gemini não configurado. Configure uma chave de projeto sem billing e um modelo com cota gratuita no servidor. Use o fluxo ChatGPT enquanto isso.',503)
    sources=extract(body.get('driveToken'),body.get('fileIds'))
    if action=='prompt': return {'prompt':prompt(sources,count,subject,difficulty),'files':[{'id':s['id'],'name':s['name'],'sha256':s['sha256']} for s in sources]}
    questions=generate(sources,count,subject,difficulty) if action=='generate' else validate_questions(body.get('payload'),sources)
    return {'questions':questions,'provider':'gemini' if action=='generate' else 'chatgpt-import','subject':subject}

class handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def reply(self,status,body):
        raw=json.dumps(body,ensure_ascii=False).encode();self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','private, no-store');self.end_headers();self.wfile.write(raw)
    def do_GET(self): self.reply(405,{'error':'Use a aba Questões do Planejamento.'})
    def do_POST(self):
        try:
            verify(self.headers.get('Authorization',''))
            size=int(self.headers.get('Content-Length','0'))
            if size<=0 or size>400000: raise QuestionError('Pedido acima do limite seguro.',413)
            body=json.loads(self.rfile.read(size))
            if not isinstance(body,dict): raise QuestionError('Pedido inválido.',400)
            self.reply(200,execute(body))
        except QuestionError as error: self.reply(error.status,{'error':str(error)})
        except (ValueError,TypeError,KeyError): self.reply(400,{'error':'Pedido inválido ou serviço retornou dados incompletos.'})
        except Exception: self.reply(503,{'error':'Não foi possível concluir. Nenhum resultado foi salvo. Tente novamente mais tarde.'})
