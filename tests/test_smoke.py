"""Functional checks using an isolated browser and a temporary local server."""
import functools
import json
import os
from pathlib import Path
import shutil
import threading
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
            timezone_id='America/Cuiaba', viewport={'width': 1280, 'height': 720})
        self.page = self.context.new_page()
        self.page.set_default_timeout(5000)
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
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
        self.assertEqual(len(menu), 15)
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


if __name__ == '__main__':
    unittest.main(verbosity=2)
