const {chromium}=require('playwright');
// Drives the wizard end to end (CloudShare and AWS paths) in headless Chromium against test/fake-backend.js.
// Run: npm run test:e2e
const fs=require('fs');const OUT=process.argv[2]||require('path').join(__dirname,'out');fs.mkdirSync(OUT,{recursive:true});
async function start(b){const p=await b.newPage({viewport:{width:1100,height:1400}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto('http://localhost:3000');await p.evaluate(()=>localStorage.clear());await p.reload();
 await p.getByText('OneAPI',{exact:false}).first().click();
 await p.getByPlaceholder('yourcompany').fill('paulaiuto');await p.getByPlaceholder('Zidentity Client ID').fill('c');await p.locator('.input-with-reveal input').first().fill('s');
 await p.locator('button.btn-primary').last().click();return {p,errs};}
let LAST;const h2=async p=>{LAST=p;try{return await p.locator('h2').first().innerText({timeout:15000})}catch(e){await p.screenshot({path:OUT+'/fail.png',fullPage:true}).catch(()=>{});console.log('PAGE TEXT:',(await p.locator('body').innerText().catch(()=>'')).slice(0,800));throw e}};
async function zpaSetup(p){
 await p.locator('input[placeholder="e.g. 216196257331281920"]').fill('72064686102675456');await p.locator('h2').first().click();await p.waitForTimeout(1500);
 await p.getByText('Create new connector group').click();await p.getByRole('button',{name:/Create Group/}).click();await p.waitForTimeout(1500);
 await p.getByText('Create new provisioning key via API').click();await p.getByRole('button',{name:/Create Key/}).click();await p.waitForTimeout(1500);
 await p.getByRole('button',{name:'Continue →'}).click();}
async function publish(p,tag){console.log(tag,'step:',await h2(p));const cidBox=p.locator('input[placeholder="e.g. 216196257331281920"]');if(await cidBox.count())await cidBox.fill('72064686102675456');await p.getByRole('button',{name:/Publish Test Apps/}).click();await p.getByText('Published.',{exact:false}).waitFor({timeout:30000}).catch(async err=>{await p.screenshot({path:OUT+'/'+tag+'-publish-stuck.png',fullPage:true});console.log('STUCK:',(await p.locator('.card').first().innerText()).slice(0,1500));throw err;});console.log(tag,'publish:',(await p.locator('.card').first().innerText()).split(String.fromCharCode(10)).filter(l=>l.startsWith('•')).join(' | '));await p.screenshot({path:OUT+'/'+tag+'-publish.png',fullPage:true});await p.getByRole('button',{name:/Continue to Verify Access/}).click();}
async function verify(p,tag){console.log(tag,'step:',await h2(p));await p.getByText('Traffic App Connector online').waitFor({timeout:15000});
 await p.getByPlaceholder('user@example.com').fill('ztest@example.com');await p.getByRole('button',{name:'Check user'}).click();await p.getByText('Private Access service entitlement').waitFor({timeout:15000});
 if(await p.getByRole('button',{name:/Enable Private Access via API/}).count()){await p.getByRole('button',{name:/Enable Private Access via API/}).click();await p.getByText('Private Access is now on for this user',{exact:false}).waitFor({timeout:15000});}
 else await p.getByText('This user should get access',{exact:false}).waitFor({timeout:5000});console.log(tag,'zid:',(await p.locator('.card').first().innerText()).split(String.fromCharCode(10)).filter(l=>/exists in this tenant|Covered by|service entitlement|Services:|Added ztest|IdP with/.test(l)).join(' | '));
 await p.waitForTimeout(1500);if(await p.getByRole('button',{name:'Connect to CloudShare'}).count()){await p.locator('.form-row input').nth(0).fill('ID');await p.locator('.form-row input').nth(1).fill('KEY');await p.getByRole('button',{name:'Connect to CloudShare'}).click();}
 await p.getByRole('button',{name:/Create test client/}).waitFor({timeout:15000});
 console.log(tag,'blueprint picked:',await p.locator('select').first().evaluate(e=>e.options[e.selectedIndex].text));
 await p.getByRole('button',{name:/Create test client/}).click();
 await p.getByRole('button',{name:/Check access from this VM/}).waitFor({timeout:30000});await p.waitForTimeout(1000);
 await p.getByRole('button',{name:/Check access from this VM/}).click();await p.getByText('Reached',{exact:false}).first().waitFor({timeout:30000});
 console.log(tag,'verify:',(await p.locator('.card').first().innerText()).split(String.fromCharCode(10)).filter(l=>/Reached|Client Connector on|online|Verified/.test(l)).join(' | '));
 await p.screenshot({path:OUT+'/'+tag+'-verify.png',fullPage:true});
 await p.getByRole('button',{name:/Continue to Scanner Setup/}).click();}
async function scanToDone(p,tag){
 console.log(tag,'step:',await h2(p));
 await p.getByText('DVWA',{exact:true}).waitFor({timeout:15000});await p.getByText('DVWA',{exact:true}).click();
 await p.getByRole('button',{name:/Create Scan/}).click();await p.getByText('doesn’t document an API').waitFor({timeout:15000});
 await p.screenshot({path:OUT+'/'+tag+'-scan.png',fullPage:true});
 await p.getByRole('button',{name:/create it in the portal/}).click();
 console.log(tag,'step:',await h2(p));
 const link=await p.getByText('Open App Connector Groups').getAttribute('href');console.log(tag,'portal link:',link);
 await p.getByRole('button',{name:/Continue Anyway|Finish/}).click();
 console.log(tag,'step:',await h2(p));await p.screenshot({path:OUT+'/'+tag+'-done.png',fullPage:true});}
(async()=>{const b=await chromium.launch();
 // ── CloudShare path
 {const {p,errs}=await start(b);
  await p.locator('.target-card').nth(1).click();await p.locator('button.btn-primary').click();
  await p.getByPlaceholder('e.g. JLUXXLF2XZM9CAKJ').fill('ID');await p.getByPlaceholder('Your CloudShare API Key').fill('KEY');await p.getByText('Connect to CloudShare').click();
  await p.getByText('has internet access').first().waitFor({timeout:30000});
  await p.getByText('Add a plain RHEL 9 VM for the App Scanner').click();await p.waitForTimeout(1200);await p.getByRole('button',{name:'➕ Add VM'}).click();
  await p.getByText('App Scanner RHEL9 has internet access').waitFor({timeout:60000});
  await p.locator('input[name="testvm"]').first().check();
  await p.getByText('zpa-connector-el9-2026.05 has internet access').waitFor({timeout:60000});
  await p.getByRole('button',{name:'Continue →'}).click();
  console.log('CS step:',await h2(p));
  await p.getByRole('button',{name:'🚀 Deploy Test Apps'}).click();await p.getByText('Test apps are running').waitFor({timeout:120000});
  await p.getByRole('button',{name:'Continue →'}).click();
  await publish(p,'CS');await verify(p,'CS');
  console.log('CS step:',await h2(p));await zpaSetup(p);
  console.log('CS step:',await h2(p));
  await p.getByRole('button',{name:'▶ Run on VM'}).click();await p.getByText('Setup finished').waitFor({timeout:120000});
  await p.getByRole('button',{name:'Continue →'}).click();
  await scanToDone(p,'CS');console.log('CS errors:',errs.length?errs:'none');if(errs.length)throw new Error('page errors on CloudShare path: '+errs.join(' | '));await p.close();}
 // ── AWS path
 {const {p,errs}=await start(b);
  await p.locator('.target-card').nth(0).click();await p.locator('button.btn-primary').click();
  console.log('AWS step:',await h2(p));
  await p.getByText('Paste access keys').click();await p.getByPlaceholder('AKIAIOSFODNN7EXAMPLE').fill('ASIATEMP');await p.getByPlaceholder('IQoJb3JpZ2luX2VjE... (from the AWS access portal)').fill('TOKEN');await p.getByPlaceholder('wJalrXUtnFEMI/K7MDENG/bPxRfi...').fill('secret');
  await p.locator('select').first().selectOption({index:1}).catch(()=>{});
  await p.getByRole('button',{name:/Fetch|Load|Discover/}).click();await p.waitForTimeout(1500);
  const sels=p.locator('select');const n=await sels.count();for(let i=1;i<n;i++){const o=await sels.nth(i).locator('option').count();if(o>1)await sels.nth(i).selectOption({index:1}).catch(()=>{});}
  await p.waitForTimeout(500);await p.getByRole('button',{name:/Continue|Next/}).last().click();
  console.log('AWS step:',await h2(p));
  await p.waitForTimeout(2000);if(!(await p.getByText('Private IP:').count())){await p.getByRole('button',{name:'🚀 Deploy Test Apps'}).click();}else console.log('AWS: existing test apps stack picked up');await p.getByText('Private IP:').waitFor({timeout:30000});
  await p.getByRole('button',{name:'Continue →'}).click();
  await publish(p,'AWS');await verify(p,'AWS');
  console.log('AWS step:',await h2(p));await zpaSetup(p);
  console.log('AWS step:',await h2(p));
  await p.waitForTimeout(2000);if(await p.getByRole('button',{name:/Launch Stack/}).count())await p.getByRole('button',{name:/Launch Stack/}).click();else console.log('AWS: existing scanner stack picked up');await p.getByRole('button',{name:'Continue →'}).waitFor({timeout:30000});
  await p.getByRole('button',{name:'Continue →'}).click();
  await scanToDone(p,'AWS');console.log('AWS errors:',errs.length?errs:'none');if(errs.length)throw new Error('page errors on AWS path: '+errs.join(' | '));await p.close();}
 await b.close();console.log('E2E PASSED')})().catch(e=>{console.error('FAIL',e.message.split('\n').slice(0,4).join(' | '));process.exit(1)});
