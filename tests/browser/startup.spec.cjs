const {test}=require('@playwright/test');
const {initialize}=require('./startup.cjs');
test('editor and verified filesystem worker initialize before a VM starts',async({page})=>{
 test.setTimeout(60000);await initialize(page);
});
