"""UI + authenticated transport with isolated fake accounts and no real credentials."""
import json,unittest
import test_account_sync as account_fixture

class QuestionsBrowserTests(unittest.TestCase):
    setUpClass=classmethod(account_fixture.AccountSyncTests.setUpClass.__func__)
    tearDownClass=classmethod(account_fixture.AccountSyncTests.tearDownClass.__func__)
    setUp=account_fixture.AccountSyncTests.setUp
    tearDown=account_fixture.AccountSyncTests.tearDown
    device=account_fixture.AccountSyncTests.device
    # Reuse account fixture methods, not the inherited suite of unrelated tests.
    def fixture(self,mobile=False):
        context,page=self.device(mobile=mobile)
        self.calls=[];self.delay_generate=False
        self.question={'stem':'Quantas câmaras tem o coração?','options':['Duas','Três','Quatro','Cinco'],'answer':2,'explanation':'Há dois átrios e dois ventrículos.','citations':[{'sourceId':'document_fixture_123','name':'Anatomia.pdf','page':2,'unitId':'2','quote':'O coração é composto por quatro câmaras: dois átrios e dois ventrículos.','url':'https://drive.google.com/file/d/document_fixture_123/view','modifiedTime':'2026-10-16','locationKind':'pdf','sha256':'fixture'}]}
        def transport(route):
            body=route.request.post_data_json;self.calls.append(body)
            self.assertTrue(route.request.headers.get('authorization','').startswith('Bearer '))
            a=body['action']
            if a=='list': result={'files':[{'id':'document_fixture_123','name':'Anatomia.pdf','mimeType':'application/pdf'}]}
            elif a=='status':result={'geminiReady':False}
            elif a in ('generate','validate'):result={'provider':'gemini' if a=='generate' else 'chatgpt-import','questions':[self.question]}
            elif a=='prompt':result={'prompt':'fixture prompt for document_fixture_123'}
            else:raise AssertionError(a)
            route.fulfill(content_type='application/json',body=json.dumps(result))
        context.route('**/api/questions',transport)
        page.evaluate("window.google={accounts:{oauth2:{initTokenClient:opts=>({requestAccessToken:()=>opts.callback({access_token:'fixture-drive-secret',expires_in:3600})})}}}")
        if mobile:
            page.locator('#mobile-nav [data-action="more-menu"]').click()
            page.locator('#modal [data-page="questions"]').click()
        else:
            page.wait_for_function("MENU.some(x=>x[0]==='questions')")
            page.locator('#nav [data-page="questions"]').click()
        return context,page
    def connect(self,page):
        page.locator('#questions-client').fill('123456789012-fixture.apps.googleusercontent.com')
        page.locator('[data-action="questions-connect"]').click()
        page.locator('[data-q-file]').wait_for()
        page.locator('[data-q-file]').check()
    def test_question_flow_persists_and_never_stores_google_token(self):
        context,page=self.fixture();self.connect(page)
        page.locator('#questions-count').fill('1');page.locator('#questions-count').press('Tab')
        page.locator('[data-action="questions-generate"]').click()
        page.locator('[data-q-answer="0"][value="2"]').check()
        page.locator('[data-action="questions-finish"]').click()
        page.get_by_text('Acertou · Gabarito: C',exact=True).wait_for()
        page.get_by_text('Fonte: Anatomia.pdf · página 2',exact=True).click()
        self.assertTrue(page.get_by_text(self.question['citations'][0]['quote'],exact=True).is_visible())
        page.wait_for_function("PlanningAccount.status==='synced'")
        payload=self.database['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']['payload']
        self.assertEqual(payload['settings']['questionSets'][0]['correct'],1)
        self.assertNotIn('fixture-drive-secret',json.dumps(payload))
        self.assertEqual(payload['sessions'],[])
        page.reload(wait_until='networkidle');page.locator('[data-action="questions-open"]').click()
        self.assertIn('1/1 acertos',page.locator('#app').inner_text())
        # Different approved account starts with no simulations and no Drive token.
        _,other=self.device(owner='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
        other.locator('#nav [data-page="questions"]').click()
        self.assertEqual(other.locator('[data-action="questions-open"]').count(),0)
    def test_mobile_prompt_import_and_disconnect(self):
        context,page=self.fixture(mobile=True);self.connect(page)
        with page.expect_download() as download: page.locator('[data-action="questions-prompt"]').click()
        self.assertEqual(download.value.suggested_filename,'pedido-chatgpt.txt')
        page.locator('#questions-import').set_input_files({'name':'questions.json','mimeType':'application/json','buffer':json.dumps({'questions':[self.question]}).encode()})
        page.locator('[data-q-answer="0"]').first.wait_for()
        self.assertEqual(self.calls[-1]['action'],'validate')
        page.locator('[data-action="questions-disconnect"]').click()
        page.locator('[data-action="questions-generate"]').click()
        self.assertIn('Conecte o Drive',page.locator('#app').inner_text())
        self.assertEqual(len([x for x in self.calls if x['action']=='generate']),0)
        self.assertFalse(page.evaluate('document.documentElement.scrollWidth>innerWidth'))
    def test_missing_configuration_and_unfinished_answers(self):
        _,page=self.fixture();page.locator('[data-action="questions-status"]').click()
        page.get_by_text('Gemini ainda não configurado no servidor.',exact=True).wait_for()
        self.connect(page);page.locator('[data-action="questions-generate"]').click()
        page.locator('[data-action="questions-finish"]').click()
        self.assertIn('Responda todas',page.locator('#toast').inner_text())
        self.assertFalse(page.get_by_text('Gabarito:',exact=True).is_visible())

