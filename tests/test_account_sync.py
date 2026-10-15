"""Two isolated browsers against a fake authenticated Supabase, never live data."""
import base64
import functools
import json
import os
import shutil
import threading
import time
import unittest
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit,parse_qs
from playwright.sync_api import sync_playwright

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass

class AccountSyncTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(Path(__file__).resolve().parents[1])))
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.url=f'http://127.0.0.1:{cls.server.server_port}/'
        cls.playwright=sync_playwright().start()
        executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
        options={'headless':True}
        if executable: options['executable_path']=executable
        cls.browser=cls.playwright.chromium.launch(**options)
    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.playwright.stop();cls.server.shutdown();cls.server.server_close();cls.thread.join()
    def setUp(self):self.contexts=[];self.errors=[];self.database={};self.writes=0;self.deny_write=False;self.force_conflict=False;self.signup_error=None;self.signups=[];self.approvals={};self.document_reads=0;self.profile_missing=False;self.recoveries=[];self.password_updates=[]
    def tearDown(self):
        for context in self.contexts:context.close()
        self.assertEqual(self.errors,[])
    def device(self,owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',legacy=None,mobile=False,auto_login=True,global_storage=None,fixture_email="fixture@example.invalid"):
        context=self.browser.new_context(timezone_id='America/Cuiaba',service_workers='block',viewport={'width':390 if mobile else 1280,'height':844 if mobile else 720},has_touch=mobile,is_mobile=mobile);self.contexts.append(context)
        if global_storage:
            for key,value in global_storage.items():context.add_init_script('localStorage.setItem('+json.dumps(key)+','+json.dumps(json.dumps(value))+')')
        page=context.new_page();page.set_default_timeout(8000);page.on('pageerror',lambda e:self.errors.append(str(e)))
        if legacy is not None:context.add_init_script('localStorage.setItem("planejamento-medicina-2.0-personal-local",'+json.dumps(json.dumps(legacy))+')')
        remote='https://eupkdyhngmrsbvmaondp.supabase.co'
        context.route('**/planning-config.js',lambda route:route.fulfill(content_type='application/javascript',body='window.PLANNING_CONFIG='+json.dumps({'url':remote,'publishableKey':'fixture-public-anon-key','legacyOwnerId':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})+';'))
        def encoded(obj):return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
        token=encoded({'alg':'HS256','typ':'JWT'})+'.'+encoded({'sub':owner,'aud':'authenticated','role':'authenticated','exp':int(time.time())+3600})+'.fixture-signature'
        user={'id':owner,'email':fixture_email,'aud':'authenticated','role':'authenticated','app_metadata':{},'user_metadata':{}}
        def transport(route):
            request=route.request;path=urlsplit(request.url).path;params=parse_qs(urlsplit(request.url).query)
            if path=='/auth/v1/signup':
                self.signups.append(request.post_data_json)
                if self.signup_error:
                    route.fulfill(status=400,content_type='application/json',body=json.dumps({'error_code':self.signup_error,'msg':'internal diagnostic must not be shown'}));return
                user['user_metadata']=request.post_data_json['data'];self.approvals[owner]=False
                result={'access_token':token,'refresh_token':'fixture-refresh','expires_in':3600,'token_type':'bearer','user':user}
            elif path=='/auth/v1/recover':
                self.recoveries.append(request.post_data_json)
                result={}
            elif path=='/auth/v1/token':result={'access_token':token,'refresh_token':'fixture-refresh','expires_in':3600,'token_type':'bearer','user':user}
            elif path=='/auth/v1/user':
                if request.method=='PUT':
                    self.password_updates.append(request.post_data_json)
                result=user
            elif path=='/auth/v1/logout':route.fulfill(status=204,body='');return
            elif path=='/rest/v1/profiles':
                self.assertEqual(request.method,'GET');self.assertEqual(params.get('id'),['eq.'+owner]);self.assertEqual(request.headers['authorization'],'Bearer '+token)
                result=[] if self.profile_missing else [{'id':owner,'name':user['user_metadata'].get('full_name',''),'approved':self.approvals.get(owner,True)}]
            elif path=='/rest/v1/planejamento_documents':
                self.document_reads+=1
                self.assertEqual(request.method,'GET');self.assertEqual(params.get('user_id'),['eq.'+owner]);self.assertEqual(request.headers['authorization'],'Bearer '+token)
                row=self.database.get(owner);result=[{'schema_version':1,**row}] if row else []
            elif path=='/rest/v1/rpc/planejamento_write':
                self.assertEqual(request.method,'POST');self.assertEqual(request.headers['authorization'],'Bearer '+token)
                if self.deny_write:route.fulfill(status=403,content_type='application/json',body=json.dumps({'code':'42501','message':'Denied'}));return
                body=request.post_data_json;row=self.database.get(owner,{'revision':0});revision=row['revision']
                if self.force_conflict and owner in self.database:
                    self.force_conflict=False;row['revision']+=1;row['payload']['tasks'].append({'id':'concurrent','title':'Outro dispositivo','done':False});revision=row['revision']
                if body['expected_revision']!=revision:route.fulfill(status=409,content_type='application/json',body=json.dumps({'code':'PT409','message':'Changed'}));return
                self.writes+=1;row={'revision':revision+1,'payload':body['new_payload']};self.database[owner]=row;result={'schema_version':1,**row}
            else:raise AssertionError('Unexpected account endpoint: '+path)
            route.fulfill(status=200,content_type='application/json',body=json.dumps(result))
        context.route(remote+'/**',transport)
        page.route_web_socket(remote.replace('https://','wss://')+'/**',lambda socket:socket.on_message(lambda message:None))
        page.goto(self.url,wait_until='networkidle')
        if not auto_login:return context,page
        page.locator('#account-login-form [name="email"]').fill('fixture@example.invalid')
        page.locator('#account-login-form [name="password"]').fill('fixture-password')
        page.locator('#account-login-form button[value="login"]').click()
        page.wait_for_function("PlanningAccount.user !== null && PlanningAccount.status === 'synced'")
        return context,page
    def test_signup_requires_name_and_profile_is_escaped_and_persistent(self):
        _,page=self.device(mobile=True,auto_login=False)
        page.locator('[name="email"]').fill('fixture@example.invalid')
        page.locator('[name="password"]').fill('fixture-password')
        page.locator('button[value="signup"]').click()
        self.assertIn('Informe seu nome',page.locator('#account-form-status').inner_text())
        self.assertEqual(self.signups,[])
        name='Gabriel <img src=x onerror=alert(1)>'
        page.locator('[name="fullName"]').fill('  '+name+'  ')
        page.locator('button[value="signup"]').click()
        page.wait_for_function("PlanningAccount.status==='awaiting-approval'")
        self.assertIsNone(page.evaluate('PlanningAccount.user'))
        self.assertEqual(self.document_reads,0)
        self.assertEqual(self.writes,0)
        self.assertIn(name,page.locator('#app').inner_text())
        self.assertEqual(page.locator('#app img').count(),1)
        page.reload(wait_until='networkidle')
        page.wait_for_function("PlanningAccount.status==='awaiting-approval'")
        self.approvals['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']=True
        page.locator('[data-action="account-check-approval"]').click()
        page.wait_for_function("PlanningAccount.user!==null && PlanningAccount.status==='synced'")
        self.assertEqual(self.signups[0]['data'],{'full_name':name})
        self.assertEqual(page.evaluate('PlanningAccount.user.user_metadata.full_name'),name)
        page.locator('[data-action="account-open"]').click()
        self.assertIn(name,page.locator('#modal').inner_text())
        self.assertEqual(page.locator('#modal img').count(),0)
        page.locator('#modal [data-action="close"]').click()
        page.reload(wait_until='networkidle')
        page.wait_for_function("PlanningAccount.user!==null && PlanningAccount.status==='synced'")
        self.assertEqual(page.evaluate('PlanningAccount.user.user_metadata.full_name'),name)
        self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))

    def test_signup_errors_explain_cause_without_server_diagnostics(self):
        _,page=self.device(auto_login=False)
        page.locator('[name="fullName"]').fill('Gabriel')
        page.locator('[name="email"]').fill('fixture@example.invalid')
        for code,expected in [('signup_disabled','temporariamente indisponível'),('weak_password','pelo menos 10 caracteres'),('over_email_send_rate_limit','limite de envio de e-mails')]:
            self.signup_error=code
            page.locator('[name="password"]').fill('fixture-password')
            page.locator('button[value="signup"]').click()
            page.wait_for_function("document.querySelector('#account-form-status').textContent.includes("+json.dumps(expected)+")")
            self.assertNotIn('internal diagnostic',page.locator('#account-form-status').inner_text())
            self.assertIsNone(page.evaluate('PlanningAccount.user'))
            self.assertFalse(page.locator('button[value="signup"]').is_disabled())

    def test_revocation_hides_records_preserves_draft_and_requires_approval_again(self):
        owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        _,page=self.device()
        page.evaluate("data.tasks.push({id:'private',title:'Registro privado',done:false});save()")
        self.wait_cloud(page,1)
        self.approvals[owner]=False
        reads=self.document_reads
        page.evaluate('PlanningAccount.sync()')
        page.wait_for_function("PlanningAccount.status==='awaiting-approval'")
        self.assertIsNone(page.evaluate('PlanningAccount.user'))
        self.assertNotIn('Registro privado',page.locator('#app').inner_text())
        self.assertEqual(self.document_reads,reads)
        self.assertEqual(self.database[owner]['payload']['tasks'][0]['title'],'Registro privado')
        self.approvals[owner]=True
        page.locator('[data-action="account-check-approval"]').click()
        self.wait_cloud(page,1)
        self.assertEqual(page.evaluate('data.tasks[0].title'),'Registro privado')

    def test_missing_profile_blocks_access_instead_of_approving_by_default(self):
        self.profile_missing=True
        _,page=self.device(auto_login=False)
        page.locator('[name="email"]').fill('fixture@example.invalid')
        page.locator('[name="password"]').fill('fixture-password')
        page.locator('button[value="login"]').click()
        page.wait_for_function("PlanningAccount.status==='awaiting-approval'")
        self.assertEqual(self.document_reads,0)
        self.assertIsNone(page.evaluate('PlanningAccount.user'))
        page.locator('[data-action="account-logout"]').click()
        page.wait_for_function("document.querySelector('#account-login-form')!==null")

    def test_individual_semester_preview_sync_and_other_account_stays_empty(self):
        from lib.schedule_parser import analyze
        owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        context,page=self.device(mobile=True)
        self.assertEqual(page.evaluate('academicEvents().length'),0)
        self.assertEqual(page.evaluate('exams().length'),0)
        page.evaluate("goto('materials')")
        self.assertEqual(page.locator('.materials-drive-link').count(),0)
        page.evaluate("data.tasks.push({id:'keep',title:'Preservar tarefa',done:false});save()")
        self.wait_cloud(page,1)
        source=b'data;inicio;fim;atividade;disciplina\n20/10/2026;08:00;10:00;Aula particular;Biologia\n21/10/2026;09:00;11:00;Prova particular;Anatomia\n'
        def analyze_fixture(route):
            self.assertEqual(route.request.method,'POST')
            self.assertTrue(route.request.headers['authorization'].startswith('Bearer '))
            result=analyze(route.request.post_data_buffer,'meu-semestre.csv')
            route.fulfill(content_type='application/json',body=json.dumps(result))
        context.route(self.url+'api/import-schedule',analyze_fixture)
        page.evaluate("goto('settings')")
        page.locator('#semester-upload').set_input_files({'name':'meu-semestre.csv','mimeType':'text/csv','buffer':source})
        page.wait_for_selector('[data-action="semester-import-confirm"]')
        self.assertEqual(page.evaluate('academicEvents().length'),0)
        page.locator('#modal button[data-action="close"]').first.click()
        self.assertEqual(page.evaluate('academicEvents().length'),0)
        page.locator('#semester-upload').set_input_files({'name':'meu-semestre.csv','mimeType':'text/csv','buffer':source})
        page.wait_for_selector('[data-action="semester-import-confirm"]')
        page.locator('[data-action="semester-import-confirm"]').click()
        page.wait_for_function("PlanningAccount.status==='synced' && data.replacement.length===2")
        self.assertEqual(page.evaluate('data.tasks[0].id'),'keep')
        self.assertEqual(page.evaluate('exams().length'),1)
        self.assertEqual(page.evaluate('data.sessions.length'),0)
        self.assertEqual(page.evaluate('data.reviews.length'),0)
        _,second=self.device()
        self.assertEqual(second.evaluate('academicEvents().length'),2)
        self.assertEqual(second.evaluate('data.settings.academicSource.filename'),'meu-semestre.csv')
        _,other=self.device(owner='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',legacy={'tasks':[{'id':'old','title':'Do proprietário','done':False}]})
        self.assertEqual(other.evaluate('events().length'),0)
        self.assertEqual(other.locator('[data-action="account-migrate"]').count(),0)
        other.evaluate("goto('materials')")
        self.assertEqual(other.locator('.materials-drive-link').count(),0)
        page.evaluate("goto('settings')")
        page.locator('#materials-url').fill('https://drive.google.com/drive/folders/minha-pasta')
        page.locator('[data-action="materials-link-save"]').click()
        page.wait_for_function("PlanningAccount.status==='synced'")
        second.evaluate('PlanningAccount.sync()')
        second.wait_for_function("data.settings.materialsUrl==='https://drive.google.com/drive/folders/minha-pasta'")
        self.assertFalse(other.evaluate('Boolean(data.settings.materialsUrl)'))

    def test_antigravity_classes_and_three_tabs_are_preserved_and_private(self):
        old={'planejamento-evaluated-classes':[{'id':'old-class','topic':'Conteúdo antigo','subject':'Fisiologia','date':'2026-10-13','minutes':90,'status':'review'}]}
        _,other=self.device(owner='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',global_storage=old,fixture_email='gabriel.aluno@example.invalid')
        other.evaluate("goto('reviews')")
        self.assertFalse(other.evaluate('WhatsAppNotify.isAdmin()'))
        self.assertEqual(other.evaluate('ClassStatusTracker.getTrackedClasses().length'),0)
        self.assertEqual(other.locator('[data-action="open-day-closing"]').count(),0)
        context,owner=self.device(global_storage=old)
        owner.evaluate("goto('reviews')")
        self.assertEqual(owner.locator('[data-action="set-review-tab"]').count(),3)
        owner.wait_for_function("PlanningAccount.status==='synced' && data.settings.evaluatedClasses.length===1")
        self.assertEqual(owner.evaluate('ClassStatusTracker.getTrackedClasses()[0].topic'),'Conteúdo antigo')
        owner.locator('[data-action="set-review-tab"][data-tab="aulas"]').click()
        owner.locator('[data-action="mark-class-mastered"][data-id="old-class"]').click()
        owner.wait_for_function("PlanningAccount.status==='synced' && data.settings.evaluatedClasses[0].status==='mastered'")
        owner.locator('[data-action="set-review-tab"][data-tab="dominadas"]').first.click()
        owner.wait_for_function("PlanningAccount.status==='synced'")
        _,second=self.device()
        second.evaluate("goto('reviews')")
        self.assertIn('Conteúdo antigo',second.locator('#app').inner_text())
        self.assertEqual(second.evaluate('ClassStatusTracker.getTrackedClasses()[0].status'),'mastered')
        self.assertEqual(second.evaluate('data.settings.reviewTab'),'dominadas')
        self.assertEqual(other.evaluate('ClassStatusTracker.getTrackedClasses().length'),0)
        self.assertEqual(owner.evaluate("JSON.parse(localStorage.getItem('planejamento-evaluated-classes'))[0].status"),'review')
        owner.evaluate("goto('settings')")
        self.assertTrue(owner.locator('[data-action="send-morning-whatsapp"]').is_visible())
        self.assertTrue(owner.locator('[data-action="send-night-whatsapp"]').is_visible())
        self.assertTrue(owner.locator('[data-action="open-day-closing"]').count()>0)
        owner.evaluate('PlanningAccount.logout()');owner.wait_for_function('PlanningAccount.user===null')
        self.assertFalse(owner.evaluate('WhatsAppNotify.isAdmin()'))
        self.assertNotIn('Conteúdo antigo',owner.locator('#app').inner_text())

    def wait_cloud(self,page,count):
        page.wait_for_function("PlanningAccount.status==='synced' && data.tasks.length === "+str(count))
    def test_migration_two_devices_offline_merge_conflict_and_logout(self):
        legacy={'tasks':[{'id':'legacy','title':'Minha tarefa antiga','priority':'1','done':False}]}
        ca,a=self.device(legacy=legacy)
        self.assertIsNone(self.database.get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))
        a.locator('[data-action="account-migrate"]').click();self.wait_cloud(a,1)
        cb,b=self.device(mobile=True);self.assertEqual(b.evaluate('data.tasks[0].id'),'legacy')
        cb.set_offline(True)
        b.evaluate("data.tasks.push({id:'phone',title:'Criada no celular',done:false});save()")
        a.evaluate("data.tasks.push({id:'mac',title:'Criada no Mac',done:false});save()")
        self.wait_cloud(a,2)
        cb.set_offline(False);b.evaluate('PlanningAccount.sync()');self.wait_cloud(b,3)
        a.evaluate('PlanningAccount.sync()');self.wait_cloud(a,3)
        self.assertEqual(set(a.evaluate('data.tasks.map(x=>x.id)')),{'legacy','mac','phone'})
        cb.set_offline(True);b.evaluate("data.tasks.find(x=>x.id==='legacy').title='Editada no celular';save()")
        a.evaluate("data.tasks.find(x=>x.id==='legacy').title='Editada no Mac';save()")
        a.wait_for_function("PlanningAccount.status==='synced' && data.tasks.find(x=>x.id==='legacy').title==='Editada no Mac'")
        cb.set_offline(False);b.evaluate('PlanningAccount.sync()');b.wait_for_function("PlanningAccount.status==='conflict'")
        b.locator('[data-action="account-conflicts"]').click();b.locator('[data-action="account-conflict-local"]').click()
        b.wait_for_function("PlanningAccount.status==='synced'")
        a.evaluate('PlanningAccount.sync()');a.wait_for_function("data.tasks.find(x=>x.id==='legacy').title==='Editada no celular'")
        self.assertEqual(len(self.database['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']['payload']['tasks']),3)
        self.assertFalse('fixture-refresh' in a.evaluate('JSON.stringify(data)'))
        self.assertTrue(b.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        b.evaluate('PlanningAccount.logout()');b.wait_for_function('PlanningAccount.user === null')
        self.assertTrue(b.locator('#account-login-form').is_visible());self.assertNotIn('Editada no celular',b.locator('#app').inner_text())
        a.evaluate('PlanningAccount.logout()');a.wait_for_function('PlanningAccount.user===null')
        self.assertEqual(a.locator('[data-action="account-legacy-backup"]').count(),0)
        self.assertTrue(a.locator('header [data-action="create"]').is_disabled())
        original=a.evaluate("localStorage.getItem('planejamento-medicina-2.0-personal-local')")
        a.evaluate("data.tasks.push({id:'unsigned',title:'Não salvar sem login'});save()")
        self.assertEqual(a.evaluate("localStorage.getItem('planejamento-medicina-2.0-personal-local')"),original)
        _,other=self.device(owner='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');self.assertEqual(other.evaluate('data.tasks.length'),0)
    def test_offline_account_cache_survives_missing_auth_session_and_explicit_logout(self):
        context,page=self.device()
        page.evaluate("data.tasks.push({id:'offline',title:'Continuar offline',done:false});save()")
        self.wait_cloud(page,1)
        page.evaluate("localStorage.removeItem('planejamento-account-v1:eupkdyhngmrsbvmaondp.supabase.co:auth')")
        root=Path(__file__).resolve().parents[1]
        import mimetypes
        def local_shell(route):
            name=urlsplit(route.request.url).path.lstrip('/') or 'index.html'
            if name=='planning-config.js':route.fallback();return
            route.fulfill(content_type=mimetypes.guess_type(name)[0] or 'application/octet-stream',body=(root/name).read_bytes())
        context.route(self.url+'**',local_shell)
        context.set_offline(True);page.reload(wait_until='networkidle')
        page.wait_for_function("PlanningAccount.user!==null && PlanningAccount.status==='offline'")
        self.assertEqual(page.evaluate('data.tasks[0].title'),'Continuar offline')
        page.evaluate("data.tasks[0].done=true;save()")
        self.assertEqual(self.database['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']['payload']['tasks'][0]['done'],False)
        page.evaluate('PlanningAccount.logout()');page.wait_for_function('PlanningAccount.user===null')
        page.reload(wait_until='networkidle');self.assertTrue(page.locator('#account-login-form').is_visible())
        self.assertNotIn('Continuar offline',page.locator('#app').inner_text())

    def test_compare_and_swap_retry_preserves_concurrent_creation(self):
        _,page=self.device()
        page.evaluate("data.tasks.push({id:'first',title:'Primeira',done:false});save()")
        self.wait_cloud(page,1);self.force_conflict=True
        page.evaluate("data.tasks.push({id:'local-new',title:'Nova local',done:false});save()")
        self.wait_cloud(page,3)
        self.assertEqual(set(page.evaluate('data.tasks.map(x=>x.id)')),{'first','local-new','concurrent'})
        self.assertEqual(self.writes,2)

    def test_denied_write_keeps_draft_after_reload_and_retries(self):
        _,page=self.device();self.deny_write=True
        page.evaluate("data.tasks.push({id:'pending',title:'Não perder',done:false});save()")
        page.wait_for_function("PlanningAccount.status==='error'");self.assertEqual(page.evaluate('data.tasks.length'),1)
        page.reload(wait_until='networkidle');page.wait_for_function("PlanningAccount.status==='error'")
        self.assertEqual(page.evaluate('data.tasks[0].title'),'Não perder')
        self.deny_write=False;page.evaluate('PlanningAccount.sync()');self.wait_cloud(page,1)
        self.assertEqual(self.writes,1)

    def test_password_recovery_and_minlength_validation(self):
        _,page=self.device(auto_login=False)
        self.assertEqual(page.locator('[name="password"]').get_attribute('minlength'),'10')
        self.assertIn('mínimo de 10 caracteres',page.locator('#account-login-form').inner_text())
        page.locator('[data-action="account-forgot"]').click()
        self.assertTrue(page.locator('#account-forgot-form').is_visible())
        page.locator('#account-forgot-form [name="email"]').fill('usuario@example.invalid')
        page.locator('#account-forgot-form button[type="submit"]').click()
        page.wait_for_function("document.querySelector('#account-forgot-status').textContent.includes('Enviamos um link')")
        self.assertEqual(self.recoveries[0]['email'],'usuario@example.invalid')
        page.locator('[data-action="account-cancel-forgot"]').click()
        self.assertTrue(page.locator('#account-login-form').is_visible())
