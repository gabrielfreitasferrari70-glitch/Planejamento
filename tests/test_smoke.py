"""Functional checks using an isolated browser and a temporary local server."""
import functools
import base64
import json
import os
from pathlib import Path
import shutil
import threading
import time
from urllib.parse import urlsplit, parse_qs
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class SiteSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1]
        handler = functools.partial(QuietHandler, directory=str(root))
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/'
        cls.playwright = sync_playwright().start()
        executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
        options = {'headless': True}
        if executable:
            options['executable_path'] = executable
        cls.browser = cls.playwright.chromium.launch(**options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.context = self.browser.new_context(
            timezone_id='America/Cuiaba', viewport={'width': 1280, 'height': 720},service_workers='block')
        self.page = self.context.new_page()
        self.page.set_default_timeout(5000)
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        # Core local-mode checks; authenticated sync has its own isolated suite.
        self.context.route('**/planning-config.js',lambda route:route.fulfill(content_type='application/javascript',body='window.PLANNING_CONFIG={};'))
        # Empty-state checks use a fixture; the semester test loads real assets.
        self.page.route('**/academic.json', lambda route: route.fulfill(
            content_type='application/json', body='[]'))

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], 'Uncaught JavaScript errors')

    def open(self):
        self.page.goto(self.url, wait_until='networkidle')

    def nav(self, target):
        self.page.locator(f'#nav [data-page="{target}"]').click()

    def saved(self):
        return self.page.evaluate('JSON.parse(localStorage.getItem(STORAGE))')

    def test_static_assets_and_empty_schedule(self):
        self.open()
        for name in ['index.html', 'styles.css', 'insights.css', 'app.js',
                     'insights.js', 'legacy-import.js', 'cloud-drive.js',
                     'favicon.svg', 'academic.json']:
            response = self.context.request.get(self.url + name)
            self.assertEqual(response.status, 200, name)
        self.assertIsInstance(self.context.request.get(self.url + 'academic.json').json(), list)
        self.assertIn('Nenhum cronograma importado', self.page.locator('#source-alert').inner_text())
        self.page.locator('#source-alert button').click()
        self.assertEqual(self.page.locator('#heading').inner_text(), 'Configurações')
        self.assertNotIn('Leitura de dados reais: concluída', self.page.locator('#app').inner_text())

    def test_all_desktop_sections_at_small_height(self):
        self.open()
        menu = self.page.evaluate('MENU.map(x=>[x[0],x[2]])')
        self.assertEqual(len(menu), 14)
        for target, title in menu:
            self.nav(target)
            self.assertEqual(self.page.locator('#heading').inner_text(), title)
            self.assertTrue(self.page.locator('#app').inner_text().strip())
            self.assertIn('Nenhum cronograma importado', self.page.locator('#source-alert').inner_text())
            self.assertEqual(self.page.locator(f'#nav [data-page="{target}"]').get_attribute('aria-current'), 'page')

    def test_all_mobile_sections_and_report_shortcut(self):
        for width, height in [(390, 844), (320, 568)]:
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': height})
                self.open()
                self.page.locator('#mobile-nav [data-page="reports"]').click()
                self.assertEqual(self.page.locator('#heading').inner_text(), 'Desempenho')
                menu = self.page.evaluate('MENU.map(x=>[x[0],x[2]])')
                for target, title in menu:
                    self.page.locator('#mobile-nav [data-action="more-menu"]').click()
                    self.page.locator(f'#modal [data-page="{target}"]').click()
                    self.assertEqual(self.page.locator('#heading').inner_text(), title)
                    self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'), target)

    def test_schedule_failure_survives_navigation(self):
        self.page.route('**/academic.json', lambda route: route.fulfill(status=404, body='Not found'))
        self.open()
        for target in ['tasks', 'radar', 'mistakes', 'settings']:
            self.nav(target)
            self.assertIn('Não foi possível carregar o cronograma', self.page.locator('#source-alert').inner_text())

    def test_invalid_schedule_is_reported(self):
        self.page.route('**/academic.json', lambda route: route.fulfill(
            content_type='application/json', body=json.dumps([
                {'date': '2026-02-31', 'title': 'Invalid fixture'}])))
        self.open()
        self.assertIn('Não foi possível carregar o cronograma', self.page.locator('#source-alert').inner_text())
        self.assertEqual(self.page.evaluate('academicEvents().length'), 0)

    def test_semester_source_and_calendar(self):
        import hashlib
        from datetime import date

        self.page.unroute('**/academic.json')
        self.open()
        records = self.context.request.get(self.url+'academic.json').json()
        source = self.context.request.get(self.url+'academic-source.json').json()
        self.assertEqual(source['semester'], '2026/2')
        self.assertEqual(source['weeks'], 18)
        self.assertEqual(len(records), 193)
        self.assertEqual(source['events'], len(records))
        self.assertEqual(len(set(x['id'] for x in records)), len(records))
        for record in records:
            self.assertEqual(date.fromisoformat(record['date']).isoformat(), record['date'])
            self.assertLess(record['from'], record['to'])
        exams = [x for x in records if x['type']=='exam']
        self.assertEqual(len(exams), 9)  # Seven exams plus two yellow seminar blocks.
        final = [x for x in exams if x['title']=='PROVA FINAL']
        self.assertEqual(len(final), 1)
        self.assertEqual(final[0]['date'], '2026-12-14')
        self.assertEqual(final[0]['sourcePages'], [18, 19])
        pdf = self.context.request.get(self.url+'data/uc2-2026-2.pdf')
        self.assertEqual(pdf.status, 200)
        self.assertEqual(hashlib.sha256(pdf.body()).hexdigest(), source['sha256'])
        # The schedule strip stays on Cronograma; elsewhere it only appears when action is needed.
        self.assertTrue(self.page.locator('#source-alert').evaluate("el => el.classList.contains('hidden')"))
        self.nav('calendar')
        self.assertIn('193 blocos', self.page.locator('#source-alert').inner_text())
        self.assertIn('Semestre 2026/2', self.page.locator('#source-alert').inner_text())
        self.page.evaluate("weekOffset=Math.round((Date.parse('2026-08-17T12:00:00Z')-Date.parse(weekDates()[0]+'T12:00:00Z'))/604800000)")
        self.nav('week')
        self.assertTrue(self.page.locator('.cal-event').filter(has_text='ACOLHIMENTO').count())
        self.assertTrue(self.page.locator('.cal-event.free').count())
        self.assertIn('Horário livre', self.page.locator('#app').inner_text())
        self.nav('settings')
        self.assertTrue(self.page.get_by_role('link', name='Ver planilha do semestre (PDF) ↗').is_visible())

    def test_semester_is_distinct_from_week_and_filters_assessments(self):
        self.page.unroute('**/academic.json')
        self.open()
        self.nav('week')
        self.assertEqual(self.page.locator('.cal-day').count(), 7)
        self.page.locator('[data-action="next-week"]').click()
        week_offset = self.page.evaluate('weekOffset')
        self.nav('calendar')
        self.assertEqual(self.page.locator('.cal-day').count(), 0)
        self.assertEqual(self.page.locator('.semester-month').count(), 5)
        self.assertIn('193 de 193 blocos exibidos', self.page.locator('#app').inner_text())
        self.page.locator('#semester-type').select_option('exam')
        self.assertEqual(self.page.locator('.semester-event').count(), 9)
        self.page.locator('#semester-month').select_option('2026-12')
        self.assertEqual(self.page.locator('.semester-event').count(), 4)
        self.page.locator('.semester-event').filter(has_text='PROVA FINAL').click()
        self.assertTrue(self.page.get_by_role('dialog').is_visible())
        self.assertIn('PROVA FINAL', self.page.locator('#modal').inner_text())
        self.page.keyboard.press('Escape')
        self.page.locator('#semester-type').select_option('welcome')
        self.assertIn('Nenhuma atividade corresponde aos filtros', self.page.locator('#app').inner_text())
        self.page.locator('header [data-action="search"]').click()
        self.page.locator('#search-input').fill('PROVA FINAL')
        self.page.locator('#search-results [data-action="search-go"]').click()
        self.assertEqual(self.page.locator('#semester-month').input_value(), '2026-12')
        self.assertEqual(self.page.locator('#semester-type').input_value(), 'all')
        self.assertTrue(self.page.locator('.semester-event').filter(has_text='PROVA FINAL').is_visible())
        self.nav('week')
        self.assertEqual(self.page.evaluate('weekOffset'), week_offset)
        self.assertEqual(self.page.locator('.cal-day').count(), 7)

    def test_mobile_semester_filters_and_personal_agenda(self):
        self.page.unroute('**/academic.json')
        self.page.set_viewport_size({'width': 320, 'height': 568})
        self.open()
        self.page.evaluate("data.tasks.push({id:'personal',title:'Minha tarefa pessoal',scheduled:weekDates()[2],start:'18:00',end:'19:00',done:false})")
        self.page.locator('#mobile-nav [data-action="more-menu"]').click()
        self.page.locator('#modal [data-page="calendar"]').click()
        self.assertNotIn('Minha tarefa pessoal', self.page.locator('#app').inner_text())
        self.page.locator('#semester-month').select_option('2026-12')
        self.page.locator('#semester-type').select_option('exam')
        self.assertEqual(self.page.locator('.semester-event').count(), 4)
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        self.page.locator('#mobile-nav [data-page="week"]').click()
        self.assertIn('Minha tarefa pessoal', self.page.locator('#app').inner_text())

    def test_free_period_does_not_block_the_planner(self):
        self.open()
        result = self.page.evaluate("""() => {
          const day=dayAdd(today(),1),weekday=new Date(day+'T12:00:00Z').getUTCDay();
          data.settings.availability={[weekday]:{from:'07:30',to:'11:30'}};
          data.tasks=[{id:'test',title:'Estudo',estimate:'60',priority:'1',date:day,done:false}];
          seed=[{id:'free',title:'Livre para Estudo',type:'free',date:day,from:'07:30',to:'11:30'}];
          const free=suggest().suggestions.length;
          seed[0].type='class';
          return {free,busy:suggest().suggestions.length};
        }""")
        self.assertEqual(result, {'free': 1, 'busy': 0})

    def test_phone_and_ipad_touch_navigation_and_calendar(self):
        self.context.close()
        self.context=self.browser.new_context(timezone_id='America/Cuiaba',service_workers='block',is_mobile=True,has_touch=True,viewport={'width':390,'height':844})
        self.page=self.context.new_page();self.page.set_default_timeout(5000)
        self.page.on('pageerror',lambda error:self.errors.append(str(error)))
        self.context.route('**/planning-config.js',lambda route:route.fulfill(content_type='application/javascript',body='window.PLANNING_CONFIG={};'))
        self.page.route('**/academic.json',lambda route:route.fulfill(content_type='application/json',body='[]'))
        for width,height in [(390,844),(768,1024),(1024,768)]:
            with self.subTest(width=width,height=height):
                self.page.set_viewport_size({'width':width,'height':height});self.open()
                for target in ['today','week','calendar','tasks','planner','settings','materials','reviews']:
                    if width<=650:
                        self.page.locator('#mobile-nav [data-action="more-menu"]').click()
                        self.page.locator(f'#modal [data-page="{target}"]').click()
                    else:self.nav(target)
                    self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'),target)
                if width<=650:
                    self.assertGreaterEqual(self.page.locator('#mobile-nav button').first.bounding_box()['height'],44)
                self.page.evaluate("goto('week')")
                self.assertEqual(self.page.locator('.cal-day').count(),7)
                self.assertTrue(self.page.evaluate("document.querySelector('.calendar').scrollWidth <= document.querySelector('.calendar-scroller').clientWidth"))

    def test_pwa_install_metadata_offline_reload_and_history(self):
        self.context.close()
        self.context=self.browser.new_context(timezone_id='America/Cuiaba',service_workers='allow',viewport={'width':390,'height':844})
        self.page=self.context.new_page();self.page.set_default_timeout(10000)
        self.page.on('pageerror',lambda error:self.errors.append(str(error)))
        self.context.route('**/planning-config.js',lambda route:route.fulfill(content_type='application/javascript',body='window.PLANNING_CONFIG={};'))
        self.open()
        manifest=self.context.request.get(self.url+'manifest.webmanifest').json()
        self.assertEqual(manifest['display'],'standalone')
        self.assertEqual(manifest['scope'],'/')
        self.assertEqual(len(manifest['icons']),3)
        self.assertEqual(self.page.locator('link[rel="apple-touch-icon"]').count(),1)
        self.page.wait_for_function('navigator.serviceWorker.controller !== null')
        self.page.evaluate("data.tasks.push({id:'offline-task',title:'Minha tarefa offline',priority:'1',done:false});save();goto('tasks')")
        self.page.evaluate("goto('settings')")
        self.page.go_back()
        self.assertEqual(self.page.locator('#heading').inner_text(),'Tarefas')
        # On phones the install shortcut lives in the "Mais" menu, keeping the header compact.
        self.assertFalse(self.page.locator('header [data-action="app-install"]').is_visible())
        self.page.locator('#mobile-nav [data-action="more-menu"]').click()
        self.page.locator('#modal [data-action="app-install"]').click()
        self.assertTrue(self.page.get_by_role('dialog').is_visible())
        self.page.keyboard.press('Escape')
        self.page.evaluate("data.settings.materialsUrl='https://drive.google.com/drive/folders/test-materials-folder';data.replacement=seed;save()")
        self.context.set_offline(True)
        self.page.reload(wait_until='domcontentloaded')
        self.page.wait_for_function("academicEvents().length===193")
        self.assertIn('Minha tarefa offline',self.page.locator('#app').inner_text())
        self.assertTrue(self.page.locator('#app-offline').is_visible())
        self.page.locator('[data-action="toggle"]').click()
        self.assertTrue(self.saved()['tasks'][0]['done'])
        self.page.evaluate("goto('calendar')")
        self.assertEqual(self.page.locator('.semester-event').count(),193)
        self.page.evaluate("goto('materials')")
        self.assertEqual(self.page.locator('.materials-drive-link').get_attribute('href'),'https://drive.google.com/drive/folders/test-materials-folder')
        cached=self.page.evaluate("async()=>{const cache=await caches.open('planejamento-shell-v4');return (await cache.keys()).map(req=>req.url)}")
        self.assertTrue(all(url.startswith(self.url) for url in cached))
        self.assertFalse(any('mr_reviews' in url or '/auth/' in url or '.pdf' in url for url in cached))
        self.context.set_offline(False)
        self.page.wait_for_function('navigator.onLine')
        self.assertFalse(self.page.locator('#app-offline').is_visible())

    def test_planner_selects_blocks_saves_and_releases_without_losing_tasks(self):
        self.open()
        self.page.evaluate("""() => {
          const day=dayAdd(today(),1),weekday=new Date(day+'T12:00:00Z').getUTCDay();
          data.settings.availability={[weekday]:{from:'18:00',to:'20:00'}};
          data.tasks=[{id:'a',title:'Revisar fisiologia',subject:'Fisiologia',estimate:'40',priority:'3',date:day,done:false},{id:'b',title:'Resolver questões',estimate:'30',priority:'1',done:false},{id:'c',title:'Tarefa sem duração',priority:'1',done:false}];
          save();
        }""")
        self.nav('planner')
        self.assertEqual(self.page.locator('.planner-day').count(),7)
        self.assertEqual(self.page.locator('[data-planner-id]').count(),2)
        self.assertIn('duração estimada',self.page.locator('.planner-missed').inner_text())
        self.page.locator('[data-planner-id="b"]').uncheck()
        self.page.locator('[data-action="apply"]').click()
        records={x['id']:x for x in self.saved()['tasks']}
        self.assertEqual(records['a']['start'],'18:00')
        self.assertNotIn('scheduled',records['b'])
        self.assertNotIn('scheduled',records['c'])
        self.assertEqual(self.page.locator('.planner-slot.existing').count(),1)
        self.page.locator('[data-action="task-unschedule"]').click()
        self.assertEqual(len(self.saved()['tasks']),3)
        self.assertNotIn('scheduled',self.saved()['tasks'][0])
        # A new commitment invalidates a previously displayed suggestion.
        self.page.evaluate("data.events.push({id:'busy',type:'class',title:'Novo compromisso',date:dayAdd(today(),1),from:'18:00',to:'20:00'})")
        self.page.locator('[data-action="apply"]').click()
        self.assertFalse(any(x.get('scheduled') for x in self.saved()['tasks']))
        self.page.set_viewport_size({'width':320,'height':568})
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))

    def test_settings_availability_validation_and_optional_connections(self):
        self.open();self.nav('settings')
        self.page.evaluate('save()')
        self.assertEqual(self.page.locator('.availability-row').count(),7)
        self.assertFalse(self.page.locator('#settings-connections').is_visible())
        self.page.locator('#start-1').fill('18:00')
        self.page.locator('[data-action="save-availability"]').click()
        self.assertEqual(self.saved()['settings']['availability'],{})
        self.page.locator('#end-1').fill('20:00')
        self.page.locator('[data-action="save-availability"]').click()
        self.assertEqual(self.saved()['settings']['availability']['1'],{'from':'18:00','to':'20:00'})
        self.page.locator('[data-action="availability-clear"][data-day="1"]').click()
        self.page.locator('[data-action="save-availability"]').click()
        self.assertEqual(self.saved()['settings']['availability'],{})
        self.page.locator('#settings-connections').locator('..').locator('summary').click()
        self.assertTrue(self.page.locator('#oauth-client-id').is_visible())
        self.assertTrue(self.page.locator('[data-action="drive-auth"]').is_visible())
        self.page.set_viewport_size({'width':320,'height':568})
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))

    def test_tasks_optional_deadline_edit_and_study_are_distinct(self):
        self.open();self.nav('tasks')
        self.page.locator('#app').get_by_role('button',name='＋ Nova tarefa',exact=True).click()
        form=self.page.locator('#record-form')
        self.assertEqual(form.locator('[name="date"]').input_value(),'')
        form.locator('[name="title"]').fill('Resolver 20 questões')
        form.locator('[name="subject"]').fill('Fisiologia')
        form.locator('[name="estimate"]').fill('40')
        form.locator('[name="priority"]').select_option('3')
        form.locator('button[type="submit"]').click()
        task_id=self.saved()['tasks'][0]['id']
        self.assertIn('Sem prazo definido',self.page.locator('.task-card').inner_text())
        self.page.evaluate("data.tasks[0].scheduled=dayAdd(today(),1);data.tasks[0].start='18:00';data.tasks[0].end='18:40';save();render()")
        self.page.locator('[data-action="task-edit"]').click()
        self.assertEqual(form.locator('[name="priority"]').input_value(),'3')
        form.locator('[name="title"]').fill('Resolver e corrigir 20 questões')
        form.locator('button[type="submit"]').click()
        record=self.saved()['tasks'][0]
        self.assertEqual(record['id'],task_id)
        self.assertEqual(record['start'],'18:00')
        self.assertEqual(len(self.saved()['tasks']),1)
        self.page.locator('[data-action="task-week"]').click()
        self.assertTrue(self.page.locator('.cal-event').filter(has_text='Resolver e corrigir 20 questões').is_visible())
        self.nav('tasks')
        self.page.locator('[data-action="task-study"]').click()
        self.assertEqual(form.locator('[name="topic"]').input_value(),'Resolver e corrigir 20 questões')
        self.assertEqual(form.locator('[name="minutes"]').input_value(),'40')
        self.assertEqual(len(self.saved()['sessions']),0)
        self.page.keyboard.press('Escape')
        self.page.locator('[data-action="toggle"]').click()
        self.assertTrue(self.saved()['tasks'][0]['done'])
        self.assertEqual(len(self.saved()['sessions']),0)
        self.page.locator('[data-action="task-filter"][data-filter="done"]').click()
        self.assertEqual(self.page.locator('.task-completed').count(),1)
        self.page.locator('[data-action="toggle"]').click()
        self.assertFalse(self.saved()['tasks'][0]['done'])
        self.page.locator('[data-action="task-filter"][data-filter="pending"]').click()
        self.page.set_viewport_size({'width':320,'height':568})
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))

    def test_exam_colors_follow_local_date_without_claiming_completion(self):
        self.open()
        self.page.evaluate("""data.events=[
          {id:'past',type:'exam',date:dayAdd(today(),-1),title:'Prova passada'},
          {id:'today',type:'exam',date:today(),title:'Prova hoje'},
          {id:'future',type:'exam',date:dayAdd(today(),10),title:'Prova futura'}]""")
        self.nav('exams')
        self.assertEqual(self.page.locator('.exam-past').count(),1)
        self.assertEqual(self.page.locator('.exam-upcoming').count(),2)
        self.assertEqual(self.page.locator('.exam-past .tag.good').inner_text(),'Data passada')
        self.assertEqual(self.page.locator('.exam-upcoming .tag.pending').count(),2)

    def medreview_fixture(self, wrong_account=False, unavailable=False):
        """Fake remote authentication/history; never sends credentials to MedReview."""
        root = Path(__file__).resolve().parents[1]
        config_text = (root/'medreview-config.js').read_text().split('window.MEDREVIEW_CONFIG=',1)[1].strip().rstrip(';')
        config = json.loads(config_text)
        owner = config['expectedUserId']
        user_id = 'another-user' if wrong_account else owner
        user = {'id':user_id,'email':'fixture@example.invalid','aud':'authenticated','role':'authenticated','app_metadata':{},'user_metadata':{}}
        def encoded(data):
            return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip('=')
        token = encoded({'alg':'HS256','typ':'JWT'})+'.'+encoded({'sub':user_id,'aud':'authenticated','role':'authenticated','exp':int(time.time())+3600})+'.fixture-signature'
        date = time.strftime('%Y-%m-%d',time.gmtime(time.time()-4*3600))
        reviews = [{'id':f'r{i}','user_id':owner,'card_id':f'c{i}','reviewed_at':date+'T10:00:00Z','rating':'good'} for i in range(100)]
        cards = [{'id':f'c{i}','deck_id':'a' if i<70 else 'b'} for i in range(100)]
        decks = [{'id':'a','title':'Cardiovascular','parent':'folder'},{'id':'b','title':'Renal','parent':'folder'},{'id':'folder','title':'Fisiologia','parent':None}]
        self.medreview_calls = []
        def transport(route):
            request=route.request;path=urlsplit(request.url).path;params=parse_qs(urlsplit(request.url).query)
            if path=='/auth/v1/token':
                result={'access_token':token,'refresh_token':'fixture-refresh','expires_in':3600,'token_type':'bearer','user':user}
            elif path=='/auth/v1/user':result=user
            elif path=='/auth/v1/logout':
                route.fulfill(status=204,body='');return
            elif path.startswith('/rest/v1/'):
                self.assertEqual(request.method,'GET')
                self.medreview_calls.append(path)
                if path.endswith('mr_reviews'):
                    self.assertEqual(params.get('user_id'),['eq.'+owner])
                    if unavailable:
                        route.fulfill(status=403,content_type='application/json',body=json.dumps({'message':'Denied','code':'42501'}));return
                    result=reviews
                elif path.endswith('mr_cards'):result=cards
                elif path.endswith('mr_decks'):
                    ids=params.get('id',[''])[0]
                    result=[d for d in decks if d['id'] in ids]
                else:raise AssertionError('Unexpected remote table')
            else:raise AssertionError('Unexpected remote endpoint: '+path)
            route.fulfill(status=200,content_type='application/json',body=json.dumps(result))
        self.context.route(config['url']+'/**',transport)
        self.page.route_web_socket(config['url'].replace('https://','wss://')+'/**',lambda socket:socket.on_message(lambda message:None))
        self.open();self.nav('reviews')
        self.page.locator('[data-action="medreview-connect"]').click()
        self.page.locator('#medreview-auth-form [name="email"]').fill('fixture@example.invalid')
        self.page.locator('#medreview-auth-form [name="password"]').fill('test-fixture-password')
        self.page.locator('#medreview-auth-form button[type="submit"]').click()

    def test_medreview_authenticated_daily_distribution_and_logout(self):
        self.medreview_fixture()
        self.page.wait_for_function('MedReviewConnection.summary?.total === 100')
        day=self.page.locator('.medreview-day')
        self.assertEqual(day.count(),1)
        self.assertIn('100',day.inner_text())
        self.assertEqual(self.page.locator('.mr-activity-day').count(),14)
        self.assertEqual(self.page.locator('.mr-source').count(),2)
        day.click()
        detail=self.page.locator('#modal')
        self.assertIn('Fisiologia',detail.inner_text())
        self.assertIn('Cardiovascular',detail.inner_text())
        self.assertIn('70 revisões',detail.inner_text())
        self.assertIn('Renal',detail.inner_text())
        self.assertIn('30 revisões',detail.inner_text())
        self.assertIn('70%',detail.inner_text())
        self.assertIn('não representam uma nota',detail.inner_text())
        self.page.set_viewport_size({'width':320,'height':568})
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        self.page.set_viewport_size({'width':1280,'height':720})
        self.page.keyboard.press('Escape')
        self.page.locator('[data-action="medreview-sync"]').click()
        self.page.wait_for_function("MedReviewConnection.status === 'connected'")
        self.assertEqual(self.page.evaluate('MedReviewConnection.summary.total'),100)
        self.assertNotIn('fixture-refresh',self.page.evaluate('JSON.stringify(data)'))
        self.page.locator('[data-action="medreview-disconnect"]').click()
        self.assertIsNone(self.page.evaluate('MedReviewConnection.summary'))
        self.assertEqual(self.page.locator('[data-action="medreview-day"]').count(),0)

    def test_medreview_other_account_is_rejected_without_reading_history(self):
        self.medreview_fixture(wrong_account=True)
        self.page.wait_for_function("MedReviewConnection.status === 'error'")
        self.assertEqual(self.medreview_calls,[])
        self.assertIsNone(self.page.evaluate('MedReviewConnection.summary'))
        self.assertEqual(self.page.locator('[data-action="medreview-day"]').count(),0)

    def test_medreview_read_denied_does_not_display_false_zero_totals(self):
        self.medreview_fixture(unavailable=True)
        self.page.wait_for_function("MedReviewConnection.status === 'error'")
        self.assertIsNone(self.page.evaluate('MedReviewConnection.summary'))
        self.assertIn('não liberou a leitura',self.page.locator('#app').inner_text())
        self.assertIn('—',self.page.locator('.medreview-stats').inner_text())

    def test_csv_import_persistence_and_reset(self):
        self.open()
        self.nav('settings')
        # Synthetic fixture, used only inside a disposable test browser.
        csv = (',12/10/2026,13/10/2026,14/10/2026,15/10/2026,16/10/2026\n'
               '08:00-09:00,Teste de importação,Livre,Livre,Livre,Livre\n')
        self.page.on('dialog', lambda dialog: dialog.accept())
        self.page.locator('#csv-upload').set_input_files({
            'name': 'test.csv', 'mimeType': 'text/csv', 'buffer': csv.encode()})
        self.page.wait_for_function('data.replacement.length === 1')
        self.assertIn('1 eventos no cronograma importado', self.page.locator('#source-alert').inner_text())
        self.page.reload(wait_until='networkidle')
        self.assertEqual(len(self.saved()['replacement']), 1)
        self.nav('settings')
        self.page.locator('[data-action="reset-schedule"]').click()
        self.assertEqual(self.saved()['replacement'], [])
        self.assertIn('Nenhum cronograma importado', self.page.locator('#source-alert').inner_text())

    def test_personal_records_and_backup_roundtrip(self):
        self.open()
        self.nav('tasks')
        self.page.locator('header [data-action="create"]').click()
        self.page.locator('#record-form [name="title"]').fill('Tarefa de teste')
        self.page.locator('#record-form button[type="submit"]').click()
        self.page.reload(wait_until='networkidle')
        self.nav('tasks')
        self.assertTrue(self.page.get_by_text('Tarefa de teste', exact=True).is_visible())
        self.page.locator('[data-action="toggle"]').click()
        self.assertTrue(self.saved()['tasks'][0]['done'])
        self.nav('settings')
        self.page.locator('#intervals').fill('7,25')
        self.page.locator('[data-action="save-settings"]').click()
        self.nav('studies')
        self.page.get_by_role('button', name='＋ Nova sessão', exact=True).click()
        for name, value in [('subject', 'Teste'), ('topic', 'Teste local'),
                            ('minutes', '30'), ('questions', '10'), ('correct', '8')]:
            self.page.locator(f'#record-form [name="{name}"]').fill(value)
        self.page.locator('#record-form button[type="submit"]').click()
        self.assertEqual(len(self.saved()['sessions']), 1)
        self.assertEqual(len(self.saved()['reviews']), 2)
        self.assertEqual(self.page.evaluate('metrics().accuracy'), 80)
        self.page.locator('header [data-action="theme"]').click()
        self.page.reload(wait_until='networkidle')
        self.assertEqual(self.page.locator('html').get_attribute('data-theme'), 'dark')
        self.nav('settings')
        with self.page.expect_download() as download:
            self.page.locator('[data-action="backup"]').click()
        backup = Path(download.value.path()).read_bytes()
        self.assertEqual(len(json.loads(backup)['payload']['sessions']), 1)
        self.page.evaluate('localStorage.clear()')
        self.page.reload(wait_until='networkidle')
        self.nav('settings')
        self.page.on('dialog', lambda dialog: dialog.accept())
        self.page.locator('#json-upload').set_input_files({
            'name': 'backup.json', 'mimeType': 'application/json', 'buffer': backup})
        self.page.wait_for_function('data.sessions.length === 1')
        self.assertEqual(len(self.saved()['reviews']), 2)
        self.assertTrue(self.saved()['tasks'][0]['done'])


    def test_today_screen_orders_the_queue_and_starts_focus(self):
        self.open()
        self.assertEqual(self.page.locator('#heading').inner_text(), 'Hoje')
        self.page.evaluate("""() => {
          const t=today(), d=n=>dayAdd(t,n);
          data.tasks=[
            {id:'later',title:'Tarefa sem prazo',subject:'Anatomia',priority:'3',done:false},
            {id:'due-today',title:'Entregar relatório',subject:'Tutoria',priority:'1',date:t,done:false},
            {id:'late-task',title:'Lista atrasada',subject:'Bioquímica',priority:'1',date:d(-1),estimate:'50',done:false}];
          data.reviews=[{id:'old-review',topic:'Néfron',subject:'Fisiologia',due:d(-3),done:false},
                        {id:'future-review',topic:'Plexo',subject:'Anatomia',due:d(4),done:false}];
          save(); goto('today');
        }""")
        queue = self.page.evaluate('todayQueue().map(x=>x.id)')
        self.assertEqual(queue, ['old-review', 'late-task', 'due-today'])
        hero = self.page.locator('.today-next').inner_text()
        self.assertIn('Revisar: Néfron', hero)
        self.assertIn('atrasada há 3 dias', hero)
        self.assertEqual(self.page.locator('.today-list .today-item').count(), 2)
        self.assertIn('Atrasada · 1 dia', self.page.locator('.today-list').inner_text())
        self.assertNotIn('Plexo', self.page.locator('.today-list').inner_text())
        self.page.locator('.today-list [data-id="late-task"]').click()
        self.assertTrue(next(x for x in self.saved()['tasks'] if x['id']=='late-task')['done'])
        self.page.locator('.today-next [data-action="focus-start"]').click()
        self.assertEqual(self.page.locator('#heading').inner_text(), 'Foco')
        self.assertEqual(self.page.locator('#focus-subject').input_value(), 'Fisiologia')
        self.assertEqual(self.page.locator('#focus-topic').input_value(), 'Néfron')

    def test_today_empty_account_and_legacy_dashboard_link(self):
        self.page.goto(self.url + '#dashboard', wait_until='networkidle')
        self.assertEqual(self.page.locator('#heading').inner_text(), 'Hoje')
        self.assertIn('Nada pendente para hoje', self.page.locator('.today-next').inner_text())
        self.assertIn('Seu cronograma ainda não foi importado', self.page.locator('.today-now').inner_text())
        self.page.locator('.today-more > summary').click()
        self.assertTrue(self.page.locator('#today-more-panels').get_by_text('Radar das próximas provas').is_visible())
        self.page.evaluate('render()')
        self.assertTrue(self.page.locator('#today-more').evaluate('el => el.open'))

    def test_theme_follows_system_until_chosen(self):
        self.page.emulate_media(color_scheme='dark')
        self.open()
        self.assertEqual(self.page.locator('html').get_attribute('data-theme'), 'dark')
        self.page.emulate_media(color_scheme='light')
        self.page.wait_for_function("document.documentElement.dataset.theme==='light'")
        self.page.locator('header [data-action="theme"]').click()
        self.assertEqual(self.page.locator('html').get_attribute('data-theme'), 'dark')
        self.page.emulate_media(color_scheme='light')
        self.page.reload(wait_until='networkidle')
        self.assertEqual(self.page.locator('html').get_attribute('data-theme'), 'dark')


if __name__ == '__main__':
    unittest.main(verbosity=2)
