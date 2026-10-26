const { chromium } = require('@playwright/test');
const { mkdirSync, readFileSync } = require('node:fs');
(async()=>{
 const { examples } = await import('../src/examples.js');mkdirSync('examples/screenshots',{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined});
 try{for(const example of examples){
  if(process.env.APPTRON_EXAMPLES && !process.env.APPTRON_EXAMPLES.split(',').includes(example.id))continue;
  if(example.needsRelay&&!process.env.APPTRON_RELAY)continue;
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto('http://127.0.0.1:4173/apptron/');await page.waitForFunction(()=>window.ApptronOnline);await page.evaluate(()=>ApptronOnline.initialized);
  if(process.env.APPTRON_RELAY)await page.evaluate(value=>localStorage.setItem('apptron:relay',value),process.env.APPTRON_RELAY);
  await page.evaluate(src=>ApptronOnline.setSource(src),readFileSync(`examples/${example.id}.txtar`,'utf8'));await page.locator('#run').click();
  await page.waitForFunction(()=>ApptronOnline.host.running,{},{timeout:180000});
  await page.waitForFunction(()=>{const t=ApptronOnline.host.frame?.contentWindow.apptron?.terminal;if(!t)return false;return Array.from({length:t.buffer.active.length},(_,i)=>t.buffer.active.getLine(i)?.translateToString()).join('\n').includes('guest:/project')},{},{timeout:90000});
  const commands={'hello-shell':'sh hello.sh','go-hello':'source /etc/goprofile && go run hello.go','c-make':'make && ./hello'};
  if(commands[example.id]){await page.evaluate(cmd=>ApptronOnline.host.sendKey(cmd+'\r'),commands[example.id]);await page.waitForFunction(expected=>{const terminal=ApptronOnline.host.frame?.contentWindow.apptron?.terminal;if(!terminal)return false;const t=terminal.buffer.active;return Array.from({length:t.length},(_,i)=>t.getLine(i)?.translateToString()).join('\n').includes(expected)},example.id==='go-hello'?'Hello from Go in your browser!':example.id==='c-make'?'Hello from C in Apptron!':'Kernel:',{timeout:180000});}
  await page.locator('#terminal iframe').screenshot({path:`examples/screenshots/${example.id}.png`});console.log(`Captured ${example.id}`);await page.close();
 }}finally{await browser.close();}
})();
