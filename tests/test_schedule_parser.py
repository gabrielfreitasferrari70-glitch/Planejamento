import importlib.util
import io
import json
import os
from pathlib import Path
import threading
import unittest
import urllib.request
import urllib.error
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from openpyxl import Workbook
from lib.schedule_parser import analyze

ROOT=Path(__file__).resolve().parents[1]
CSV=b'data;inicio;fim;atividade;disciplina\n20/10/2026;08:00;10:00;Aula de Bioquimica;Bioquimica\n21/10/2026;09:00;11:00;Prova de Anatomia;Anatomia\n'

class ScheduleParserTests(unittest.TestCase):
    def test_original_pdf_extracts_complete_semester_without_duplicates(self):
        result=analyze((ROOT/'data/uc2-2026-2.pdf').read_bytes(),'semestre.pdf')
        original=json.loads((ROOT/'academic.json').read_text())
        self.assertEqual(len(result['events']),193)
        self.assertEqual(result['source']['counts']['exam'],9)
        self.assertEqual({(x['date'],x['from'],x['to']) for x in result['events']},{(x['date'],x['from'],x['to']) for x in original})
        self.assertEqual(len({x['id'] for x in result['events']}),193)
        self.assertNotIn('sourceUrl',result['source'])
    def test_csv_named_columns_and_excel_are_equivalent(self):
        csv=analyze(CSV,'semestre.csv')
        workbook=Workbook();sheet=workbook.active
        for row in [['data','inicio','fim','atividade','disciplina'],['20/10/2026','08:00','10:00','Aula de Bioquimica','Bioquimica'],['21/10/2026','09:00','11:00','Prova de Anatomia','Anatomia']]:sheet.append(row)
        buffer=io.BytesIO();workbook.save(buffer)
        excel=analyze(buffer.getvalue(),'semestre.xlsx')
        self.assertEqual(csv['events'],excel['events'])
        self.assertEqual(csv['source']['counts'],{'class':1,'exam':1})
    def test_weekly_grid_preserves_free_periods_and_deduplicates(self):
        source='Horario,20/10/2026,21/10/2026\n08:00-10:00,Livre,Prova de Anatomia\n08:00-10:00,Livre,Prova de Anatomia\n'
        result=analyze(source.encode(),'grade.csv')
        self.assertEqual(len(result['events']),2)
        self.assertEqual(result['source']['counts'],{'free':1,'exam':1})
    def test_invalid_dates_hours_and_unrecognized_content_are_rejected(self):
        for body in [CSV.replace(b'20/10/2026',b'31/02/2026'),CSV.replace(b'08:00',b'25:00'),CSV.replace(b'10:00',b'07:00'),b'qualquer texto sem cronograma']:
            with self.assertRaises(ValueError):analyze(body,'semestre.csv')

class ImportEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec=importlib.util.spec_from_file_location('import_schedule',ROOT/'api/import-schedule.py')
        cls.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.module)
    def setUp(self):
        self.approved=False;self.lookups=[]
        self.env=patch.dict(os.environ,{'PLANNING_SUPABASE_URL':'https://fixture.invalid','PLANNING_SUPABASE_PUBLIC_KEY':'fixture-public'})
        self.env.start()
        def lookup(request,**kwargs):
            self.lookups.append(request.full_url)
            self.assertEqual(request.get_header('Authorization'),'Bearer fixture-token')
            result={'id':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'} if request.full_url.endswith('/auth/v1/user') else [{'approved':self.approved}]
            return io.BytesIO(json.dumps(result).encode())
        self.lookup=patch.object(self.module.urllib.request,'urlopen',side_effect=lookup);self.lookup.start()
        self.server=ThreadingHTTPServer(('127.0.0.1',0),self.module.handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.lookup.stop();self.env.stop()
    def request(self,authorized=True):
        # HTTPConnection avoids mocking the test's own network transport.
        from http.client import HTTPConnection
        connection=HTTPConnection('127.0.0.1',self.server.server_port)
        headers={'Content-Type':'application/octet-stream','X-File-Name':'semestre.csv'}
        if authorized:headers['Authorization']='Bearer fixture-token'
        connection.request('POST','/api/import-schedule',CSV,headers)
        response=connection.getresponse();result=response.status,json.loads(response.read());connection.close();return result
    def test_pending_and_anonymous_accounts_cannot_analyze_documents(self):
        self.assertEqual(self.request(False)[0],401)
        self.assertEqual(self.lookups,[])
        self.assertEqual(self.request()[0],403)
    def test_approved_account_receives_preview_only(self):
        self.approved=True
        status,result=self.request()
        self.assertEqual(status,200)
        self.assertEqual(len(result['events']),2)
        self.assertTrue(all('/auth/v1/user' in url or '/rest/v1/profiles?' in url for url in self.lookups))

if __name__=='__main__':unittest.main()
