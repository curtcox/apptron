const {test,expect}=require('@playwright/test');
const corpus=require('../fixtures/legacy-links.json');
test.use({serviceWorkers:'block'});
test('harvested pre-kit source, compressed, document, example and CID links retain their snapshots',async({page})=>{
 await page.route('https://256t.us/**',route=>route.fulfill({body:corpus.example.source,contentType:'application/json'}));
 for(const entry of corpus.cases){
  const url=new URL(entry.href);await page.goto('./'+url.search+url.hash);await page.locator('body[data-ready="true"]').waitFor();
  expect(await page.evaluate(()=>ApptronOnline.getSource()),entry.label).toBe(entry.src??(entry.raw?JSON.parse(entry.raw).src:corpus.example.source));
  await expect(page.locator('#terminal iframe')).toHaveCount(0);
 }
});
