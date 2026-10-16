"""Manual imports with isolated accounts. No source or model network requests."""
import json,unittest
import test_account_sync as account_fixture
class QuestionsBrowserTests(unittest.TestCase):
    setUpClass=classmethod(account_fixture.AccountSyncTests.setUpClass.__func__)
    tearDownClass=classmethod(account_fixture.AccountSyncTests.tearDownClass.__func__)
    setUp=account_fixture.AccountSyncTests.setUp
    tearDown=account_fixture.AccountSyncTests.tearDown
    device=account_fixture.AccountSyncTests.device
    def fixture(self,mobile=False):
        context,page=self.device(mobile=mobile);self.external=[]
        def reject(route): self.external.append(route.request.url);route.abort()
        context.route('**/api/questions',reject);context.route('**/generativelanguage.googleapis.com/**',reject);context.route('**/www.googleapis.com/**',reject)
        if mobile:
            page.locator('#mobile-nav [data-action="more-menu"]').click();page.locator('#modal [data-page="questions"]').click()
        else: page.locator('#nav [data-page="questions"]').click()
        self.q={'stem':'Quantas câmaras tem o coração?','options':['Duas','Três','Quatro','Cinco'],'answer':2,'explanation':'Há dois átrios e dois ventrículos.','citations':[{'name':'Anatomia.pdf','page':None,'quote':'O coração é composto por quatro câmaras: dois átrios e dois ventrículos.','url':'https://example.org/anatomia.pdf'}]}
        return context,page
    def upload(self,page,payload=None):
        if page.locator('#questions-import').count()==0: page.locator('[data-action="questions-tab"][data-tab="prepare"]').first.click()
        page.locator('#questions-import').set_input_files({'name':'questoes.json','mimeType':'application/json','buffer':json.dumps(payload or {'subject':'Anatomia','questions':[self.q]}).encode()})
    def test_manual_import_correct_persist_and_account_isolation(self):
        _,page=self.fixture();self.upload(page)
        page.locator('[data-q-answer="0"][value="2"]').check();page.locator('[data-action="questions-finish"]').click()
        page.get_by_text('Acertou · Gabarito: C',exact=True).wait_for()
        page.get_by_text('Fonte: Anatomia.pdf · trecho (informada no arquivo)',exact=True).click()
        self.assertTrue(page.get_by_text(self.q['citations'][0]['quote'],exact=True).is_visible())
        page.wait_for_function("PlanningAccount.status==='synced'")
        record=self.database['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']['payload'];self.assertEqual(record['settings']['questionSets'][0]['correct'],1);self.assertEqual(record['sessions'],[])
        page.reload(wait_until='networkidle');page.locator('[data-action="questions-open"]').click();self.assertIn('1/1 acertos',page.locator('#app').inner_text())
        _,other=self.device(owner='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');other.locator('#nav [data-page="questions"]').click();self.assertEqual(other.locator('[data-action="questions-open"]').count(),0)
        self.assertEqual(self.external,[])
    def test_mobile_prompt_import_and_no_provider_controls(self):
        _,page=self.fixture(mobile=True)
        page.locator('[data-action="questions-tab"][data-tab="prepare"]').first.click()
        with page.expect_download() as download: page.locator('[data-action="questions-prompt"]').click()
        self.assertEqual(download.value.suggested_filename,'pedido-chatgpt.txt');self.upload(page);page.locator('[data-q-answer="0"]').first.wait_for()
        self.assertEqual(page.locator('#questions-client').count(),0);self.assertEqual(page.locator('[data-action="questions-generate"]').count(),0)
        self.assertFalse(page.evaluate('document.documentElement.scrollWidth>innerWidth'));self.assertEqual(self.external,[])
    def test_rejects_missing_sources_and_requires_all_answers(self):
        _,page=self.fixture();bad=json.loads(json.dumps(self.q));bad['citations']=[];self.upload(page,{'questions':[bad]})
        page.get_by_text('Cada questão precisa de fonte documental e trecho.',exact=True).first.wait_for();self.assertEqual(page.locator('[data-action="questions-open"]').count(),0)
        self.upload(page);page.locator('[data-action="questions-finish"]').click();self.assertIn('Responda todas',page.locator('#toast').inner_text());self.assertEqual(self.external,[])

    def test_dedicated_workspace_and_all_option_explanations(self):
        _,page=self.fixture()
        comments=['CORRETA. '+('Explicação detalhada da alternativa A. '*8),'INCORRETA. '+('Correção da alternativa B. '*8),'INCORRETA. '+('Correção da alternativa C. '*8),'INCORRETA. '+('Correção da alternativa D. '*8)]
        first=json.loads(json.dumps(self.q));first['answer']=0;first['optionExplanations']=comments
        second=json.loads(json.dumps(first));second['stem']='Segunda questão com outro enunciado?'
        self.upload(page,{'schemaVersion':2,'subject':'Fisiologia cardiovascular','questions':[first,second]})
        page.locator('#questions-workspace').wait_for()
        self.assertEqual(page.locator('#questions-import').count(),0)
        self.assertEqual(page.locator('.q-tabs').count(),0)
        self.assertEqual(page.locator('.q-comment').count(),0)
        page.locator('[data-q-answer="0"][value="1"]').check()
        page.locator('.q-index [data-index="1"]').click()
        page.locator('[data-q-answer="1"][value="0"]').check()
        page.locator('[data-action="questions-finish"]').click()
        self.assertEqual(page.locator('.q-comment').count(),4)
        for i,comment in enumerate(comments): self.assertEqual(page.locator('.q-comment .q-prose').nth(i).inner_text(),comment.strip())
        self.assertIn('Sua resposta',page.locator('.q-comment').nth(1).inner_text())
        self.assertGreaterEqual(page.locator('.q-stem').evaluate('e=>parseFloat(getComputedStyle(e).fontSize)'),19)
        self.assertGreaterEqual(page.locator('.q-prose').first.evaluate('e=>parseFloat(getComputedStyle(e).fontSize)'),16)
        page.locator('[data-action="questions-back"]').click()
        self.assertEqual(page.locator('#questions-workspace').count(),0)
        self.assertTrue(page.locator('.q-library').is_visible())
        self.assertEqual(self.external,[])
