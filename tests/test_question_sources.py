import copy,importlib.util,json,os,unittest
from unittest.mock import patch
from lib.question_sources import extract,validate_questions,QuestionError,prompt,generate,list_files
from pathlib import Path
spec=importlib.util.spec_from_file_location('questions_api',Path(__file__).resolve().parents[1]/'api/questions.py')
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)

class QuestionSourcesTests(unittest.TestCase):
    def setUp(self):
        self.quote='O coração é composto por quatro câmaras: dois átrios e dois ventrículos.'
        self.source={'id':'document_fixture_123','name':'Anatomia.pdf','url':'https://drive.google.com/file/d/document_fixture_123/view','sha256':'abc','modifiedTime':'2026-10-16T12:00:00Z','locationKind':'pdf','units':[{'id':'2','page':2,'text':self.quote}]}
        self.payload={'questions':[{'stem':'Quantas câmaras tem o coração?','options':['Duas','Três','Quatro','Cinco'],'answer':2,'explanation':self.quote,'citations':[{'sourceId':self.source['id'],'unitId':'2','quote':self.quote}]}]}
    def test_actual_page_overrides_fabricated_page_url_title(self):
        self.payload['questions'][0]['citations'][0].update(page=999,url='javascript:alert(1)',name='Outro')
        ref=validate_questions(self.payload,[self.source])[0]['citations'][0]
        self.assertEqual(ref['page'],2);self.assertEqual(ref['url'],self.source['url']);self.assertEqual(ref['name'],'Anatomia.pdf')
    def test_fabricated_quote_source_unit_and_missing_citation_rejected(self):
        for change in ({'quote':'Esta frase não existe no documento e deve ser recusada.'},{'sourceId':'another_document_id'},{'unitId':'999'}):
            with self.subTest(change=change):
                bad=copy.deepcopy(self.payload);bad['questions'][0]['citations'][0].update(change)
                with self.assertRaises(QuestionError): validate_questions(bad,[self.source])
        self.payload['questions'][0]['citations']=[]
        with self.assertRaises(QuestionError): validate_questions(self.payload,[self.source])
    def test_invalid_answers_duplicates_count_and_incomplete_payload(self):
        for key,value in [('answer',True),('answer',4),('options',['x']*4),('explanation','')]:
            bad=copy.deepcopy(self.payload);bad['questions'][0][key]=value
            with self.assertRaises(QuestionError): validate_questions(bad,[self.source])
        with self.assertRaises(QuestionError): validate_questions(self.payload,[self.source],2)
    def test_txt_has_no_invented_pagination(self):
        meta={'id':self.source['id'],'name':'Anatomia.txt','mimeType':'text/plain','modifiedTime':'now'}
        with patch('lib.question_sources.request',side_effect=[json.dumps(meta).encode(),self.quote.encode(),b'{"modifiedTime":"now"}']): sources=extract('fixture-token',[self.source['id']])
        self.assertIsNone(sources[0]['units'][0]['page'])
    def test_pdf_physical_page_and_scan_rejection(self):
        import fitz
        with fitz.open() as doc:
            doc.new_page();page=doc.new_page();page.insert_text((72,72),'The heart has four chambers: two atria and two ventricles.');raw=doc.tobytes()
        meta={'id':self.source['id'],'name':'Anatomia.pdf','mimeType':'application/pdf','modifiedTime':'now'}
        with patch('lib.question_sources.request',side_effect=[json.dumps(meta).encode(),raw,b'{"modifiedTime":"now"}']): sources=extract('token',[self.source['id']])
        self.assertEqual(sources[0]['units'][0]['page'],2)
        with fitz.open() as doc: doc.new_page();raw=doc.tobytes()
        with patch('lib.question_sources.request',side_effect=[json.dumps(meta).encode(),raw]):
            with self.assertRaisesRegex(QuestionError,'Sem texto'): extract('token',[self.source['id']])
    def test_modified_document_is_rejected(self):
        meta={'name':'a.txt','mimeType':'text/plain','modifiedTime':'before'}
        with patch('lib.question_sources.request',side_effect=[json.dumps(meta).encode(),self.quote.encode(),b'{"modifiedTime":"after"}']):
            with self.assertRaisesRegex(QuestionError,'mudou'): extract('token',[self.source['id']])
    def test_free_tier_gate_never_calls_external_service(self):
        with patch.dict(os.environ,{},clear=True),patch('lib.question_sources.request') as fetch:
            with self.assertRaises(QuestionError): generate([self.source],1,'Medicina','fácil')
            fetch.assert_not_called()
        with patch.dict(os.environ,{},clear=True),patch.object(api,'extract') as read:
            with self.assertRaises(QuestionError): api.execute({'action':'generate'})
            read.assert_not_called()
    def test_api_auth_required_and_approval_checked(self):
        with self.assertRaises(QuestionError): api.verify('')
        with patch.dict(os.environ,{'PLANNING_SUPABASE_URL':'https://fixture.invalid','PLANNING_SUPABASE_PUBLIC_KEY':'public'}),patch.object(api,'request',side_effect=[b'{"id":"alice"}',b'[{"approved":false}]']):
            with self.assertRaises(QuestionError) as raised: api.verify('Bearer fixture')
            self.assertEqual(raised.exception.status,403)
    def test_prompt_has_same_ids_and_only_extracted_units(self):
        value=prompt([self.source],1,'Anatomia','fácil');self.assertIn(self.source['id'],value);self.assertIn(self.quote,value);self.assertIn('unitId',value)
    def test_gemini_success(self):
        response={'candidates':[{'finishReason':'STOP','content':{'parts':[{'text':json.dumps(self.payload)}]}}]}
        with patch.dict(os.environ,{'GEMINI_API_KEY':'fixture','GEMINI_MODEL':'gemini-test','GEMINI_FREE_TIER_CONFIRMED':'true'}),patch('lib.question_sources.request',return_value=json.dumps(response).encode()) as fetch:
            self.assertEqual(len(generate([self.source],1,'Medicina','fácil')),1);self.assertEqual(fetch.call_count,1);self.assertNotIn('fixture',fetch.call_args.args[0])
    def test_folder_injection_and_duplicate_selection_rejected(self):
        with self.assertRaises(QuestionError): list_files('token',"root' or trashed = true")
        with self.assertRaises(QuestionError): extract('token',[self.source['id']]*2)
