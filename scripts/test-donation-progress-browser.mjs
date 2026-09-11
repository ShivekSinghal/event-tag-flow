import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(process.env.PINKD_PLAYWRIGHT_ROOT+'/package.json')('playwright');
const base=process.env.PINKD_TEST_URL||'http://127.0.0.1:8115';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Mocked tests are local-only.');
const user={id:'00000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',email:'preview@example.test'};
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for(const width of [375,390,1440]) {
    const context=await browser.newContext({viewport:{width,height:width<600?844:1000}});
    let amount=24000,fail=false,role='admin',requests=0;
    const errors=[];
    await context.routeWebSocket('**/*',socket=>socket.close());
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin===base)return route.continue();
      if(!url.hostname.endsWith('.supabase.co'))return route.abort();
      const name=url.pathname.split('/').at(-1);
      if(name==='user')return route.fulfill({json:user});
      if(name==='profiles')return route.fulfill({json:{...user,full_name:'Preview Admin',role}});
      if(name==='get_donation_collection_progress') {
        requests++;
        if(fail)return route.fulfill({status:500,json:{message:'Simulated offline'}});
        return route.fulfill({json:{total_inr:amount,goal_inr:1000000,collection_count:3,unpriced_topups:0,generated_at:new Date().toISOString()}});
      }
      return route.fulfill({json:[]});
    });
    await context.addInitScript(user=>{
      const exp=Math.floor(Date.now()/1000)+3600;
      localStorage.setItem('sb-xdaienqjbybomctsoiro-auth-token',JSON.stringify({access_token:btoa('{}')+'.'+btoa(JSON.stringify({sub:user.id,exp}))+'.test',refresh_token:'test',expires_at:exp,token_type:'bearer',user}));
    },user);
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/donation-progress');
    const total=page.getByTestId('collection-total');
    const settled=value=>page.waitForFunction(value=>document.querySelector('[data-testid="collection-total"]')?.textContent===value,value,{timeout:10000});
    const update=async value=>{amount=value;await page.getByRole('button',{name:'Refresh total',exact:true}).click();};
    await settled('24,000');
    assert.equal(await page.locator('.collection-flying').count(),0);
    assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuemax'),'1000000');
    assert.equal(await page.locator('.collection-logo img').evaluate(el=>el.complete&&el.naturalWidth>0),true);
    await page.screenshot({path:'/tmp/pinkd-collections-'+width+'.png',fullPage:true});
    await update(24500);await page.locator('.collection-flying[data-tier="standard"]').waitFor();
    assert.equal(await total.innerText(),'24,000');await settled('24,500');
    await update(24500);await page.waitForTimeout(500);assert.equal(await page.locator('.collection-flying').count(),0);
    await update(27500);await page.locator('.collection-flying[data-tier="ripple"]').waitFor();await settled('27,500');
    await update(42500);await page.locator('.collection-flying[data-tier="celebration"]').waitFor();await page.locator('.collection-confetti').waitFor();
    await page.screenshot({path:'/tmp/pinkd-collections-celebration-'+width+'.png',fullPage:true});await settled('42,500');
    fail=true;await update(42500);await page.getByText('Updates paused. Last confirmed total is retained. Please retry.').waitFor();assert.equal(await total.innerText(),'42,500');
    fail=false;await update(40000);await settled('40,000');assert.equal(await page.locator('.collection-flying').count(),0);
    await page.emulateMedia({reducedMotion:'reduce'});await update(50000);await settled('50,000');assert.equal(await page.locator('.collection-flying').count(),0);
    await page.emulateMedia({reducedMotion:'no-preference'});await update(60000);await page.locator('.collection-flying').waitFor();await update(62000);await settled('62,000');
    if(width===1440) {
      for(let i=1;i<=8;i++){await update(62000+i*500);await page.waitForTimeout(500);}
      assert.ok(Number((await total.innerText()).replaceAll(',',''))>62000);await settled('66,000');
    }
    await page.emulateMedia({reducedMotion:'reduce'});await update(1000500);await settled('10,00,500');
    assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'1000000');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole('button',{name:'Fullscreen',exact:true}).click();await page.getByRole('button',{name:'Exit fullscreen',exact:true}).waitFor();
    await page.screenshot({path:'/tmp/pinkd-collections-fullscreen-'+width+'.png'});
    await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();
    const before=requests;await page.waitForTimeout(15500);assert.ok(requests>before);
    role='staff';await page.reload();await page.getByRole('alert').filter({hasText:'Admin access'}).waitFor();
    const denied=requests;await page.waitForTimeout(600);assert.equal(requests,denied);
    assert.deepEqual(errors,[]);console.log('PASS '+width+'px: animation tiers, duplicate and racing totals, refunds, offline, reduced motion, fullscreen, polling, admin-only access');
    await context.close();
  }
}finally{await browser.close();}
