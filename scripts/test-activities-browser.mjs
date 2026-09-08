import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(process.env.PINKD_PLAYWRIGHT_ROOT + '/package.json')('playwright');
const base = process.env.PINKD_TEST_URL || 'http://127.0.0.1:8102';
const local = ['localhost','127.0.0.1'].includes(new URL(base).hostname);
const preview = new URL(base).hostname === process.env.PINKD_APPROVED_PREVIEW_HOST
  && new URL(base).hostname.endsWith('.vercel.app') && Boolean(process.env.PINKD_PREVIEW_BYPASS);
if (!local && !preview) throw new Error('Only local or explicitly approved protected previews are permitted.');
const user = { id:'00000000-0000-4000-8000-000000000001', aud:'authenticated', role:'authenticated', email:'operator@example.test' };
const wallet = { id:'00000000-0000-4000-8000-000000000002', attendee_name:'Test Guest', attendee_phone:'0000000000', tag_id:'NFC04AA11223344', coin_balance:5000, status:'active' };
const manifest = readFileSync('scripts/apply-activity-staff.sql','utf8');
const games = [...manifest.matchAll(/\('([^']+)','(tier_\d|free|donations)',(\d+),'(fixed|free|donation)'\)/g)].map((m,i)=>({
  id:`00000000-0000-4000-8000-${String(i+10).padStart(12,'0')}`, name:m[1], activity_group:m[2], price:Number(m[3]), pricing_mode:m[4],
  available:true, studio:'General', description:'', awards_pinkredible:['tier_2','tier_3'].includes(m[2]),
}));
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  for (const width of [390,1440]) {
    const context = await browser.newContext({viewport:{width,height:900}});
    const calls=[], errors=[];
    let lostResponse = false;
    let profileRole = 'admin', allowedGroups = [];
    const savedGames = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin===new URL(base).origin) {
        if (!['GET','HEAD'].includes(route.request().method())) return route.abort();
        return route.continue({headers:{...route.request().headers(),...(preview ? {'x-vercel-protection-bypass':process.env.PINKD_PREVIEW_BYPASS} : {})}});
      }
      if (!url.hostname.endsWith('.supabase.co')) return route.abort();
      const name=url.pathname.split('/').at(-1), json=value=>route.fulfill({json:value});
      if(name==='user') return json(user);
      if(name==='profiles') return json({...user,full_name:'Test Operator',role:profileRole});
      if(name==='games') {
        if(route.request().method()==='PATCH') { savedGames.push(route.request().postDataJSON()); return route.fulfill({status:204}); }
        return json(url.searchParams.has('id') ? games.filter(g=>url.searchParams.get('id').includes(g.id)) : games);
      }
      if(name==='staff_permissions') return json(games.filter(g=>allowedGroups.includes(g.activity_group)).map(g=>({id:g.id,game_id:g.id,permission_type:'game',game:g})));
      if(name==='wallets') return json(route.request().headers().accept?.includes('object') ? wallet : [wallet]);
      if(name==='staff_find_wallet') return json([{wallet_id:wallet.id,attendee_name:'Test Guest',band_hint:'344',coin_balance:5000,studio:'General',match_kind:'name'}]);
      if(name==='execute_wallet_operation') {
        calls.push(route.request().postDataJSON());
        if(lostResponse){lostResponse=false; return route.abort();}
        return json({status:'succeeded',transaction_id:'00000000-0000-4000-8000-000000000099',wallet_id:wallet.id,spent_coin_amount:calls.at(-1).p_request.coin_amount,new_coin_balance:5000-calls.at(-1).p_request.coin_amount});
      }
      if(name==='transactions') return json(route.request().headers().accept?.includes('object') ? {id:'00000000-0000-4000-8000-000000000099',wallet_id:wallet.id,type:'games',coin_amount:-333,item_name:'Karaoke',game_id:games.find(g=>g.name==='Karaoke').id} : []);
      return json([]);
    });
    await context.addInitScript(user=>{
      const exp=Math.floor(Date.now()/1000)+3600;
      localStorage.setItem('sb-xdaienqjbybomctsoiro-auth-token',JSON.stringify({access_token:btoa('{}')+'.'+btoa(JSON.stringify({sub:user.id,exp}))+'.test',refresh_token:'test',expires_at:exp,token_type:'bearer',user}));
      window.scanCount=0;
      window.NDEFReader=class { async scan(){window.scanCount++; window.testReader=this;} };
    },user);
    const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/pos');
    await page.getByRole('button',{name:/^(Games|🎮)$/}).click();
    try { await page.getByRole('button',{name:'Donate to Karaoke',exact:true}).waitFor(); }
    catch(error) { console.error(await page.locator('body').innerText(), errors); throw error; }
    for(const group of ['Tier 1','Tier 2','Tier 3','Free','Donations']) await page.getByRole('region',{name:group,exact:true}).waitFor();
    assert.equal(await page.getByRole('region',{name:'Free',exact:true}).getByRole('button').count(),0);
    assert.equal(await page.evaluate(()=>window.scanCount),0);
    await page.screenshot({path:`/tmp/pinkd-activities-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'Donate to Karaoke',exact:true}).click();
    const input=page.getByLabel('Donation in coins');
    assert.equal(await input.inputValue(),'150'); assert.equal(await page.evaluate(()=>window.scanCount),0);
    for(const value of ['', '149','150.5','-1']){
      await input.fill(value); assert.equal(await page.getByRole('button',{name:'Continue to band'}).isDisabled(),true);
    }
    await input.fill('333');
    await page.screenshot({path:`/tmp/pinkd-donation-${width}.png`});
    await page.getByRole('button',{name:'Continue to band'}).dblclick();
    await page.waitForFunction(()=>Boolean(window.testReader?.onreading));
    await page.evaluate(()=>{window.lateRead=window.testReader.onreading;});
    await page.getByText("Can't scan? Find by phone or name",{exact:true}).click();
    // Prove the seven-second timeout cannot clear this donation while staff searches.
    await page.waitForTimeout(width===390 ? 31000 : 8000);
    await page.evaluate(()=>window.lateRead?.({serialNumber:'04:AA:11:22:33:44'}));
    assert.equal(calls.length,0);
    await page.getByPlaceholder('Phone, name or order ref').fill('Test');
    await page.getByRole('button',{name:/Test Guest.*band/}).click();
    await page.getByRole('button',{name:'Use this band',exact:true}).dblclick();
    await page.getByRole('heading',{name:'Last sale',exact:true}).waitFor();
    assert.equal(calls.length,1); assert.equal(calls[0].p_request.coin_amount,333);
    assert.equal(calls[0].p_request.game_id,games.find(g=>g.name==='Karaoke').id);
    assert.match(calls[0].p_request.reference,/via:phone-lookup/);
    assert.equal(await page.evaluate(()=>window.scanCount),1);
    await page.reload(); await page.getByRole('heading',{name:'Last sale',exact:true}).waitFor(); assert.equal(calls.length,1);
    await page.getByRole('button',{name:/^(Games|🎮)$/}).click();
    // A lost response freezes the original identity; recovery cannot invent a second sale.
    await page.getByRole('button',{name:'Donate to Busk for a Cause',exact:true}).click();
    await page.getByRole('button',{name:'Continue to band'}).click();
    await page.waitForFunction(()=>Boolean(window.testReader?.onreading));
    lostResponse=true;
    await page.evaluate(()=>window.testReader.onreading({serialNumber:'04:AA:11:22:33:44'}));
    await page.getByText('Payment status unknown',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Check / Retry safely'}).click();
    await page.getByText('Payment status unknown',{exact:true}).waitFor({state:'hidden'});
    await page.waitForFunction(id=>sessionStorage.getItem('pinkd.wallet-operation.v1:'+id)===null,user.id);
    await page.getByRole('heading',{name:'Last sale',exact:true}).waitFor();
    assert.deepEqual(calls[1],calls[2]); assert.equal(calls.length,3);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    for(const groups of [['tier_1'],['tier_2'],['tier_3'],['free','donations']]) {
      profileRole='staff'; allowedGroups=groups;
      await page.reload();
      const expected=games.filter(g=>groups.includes(g.activity_group));
      await page.getByText(expected[0].name,{exact:true}).first().waitFor();
      for(const g of games) {
        const count=await page.getByRole('button',{name:`${g.pricing_mode==='donation'?'Donate to':'Select'} ${g.name}`,exact:true}).count();
        assert.equal(count,groups.includes(g.activity_group)&&g.pricing_mode!=='free'?1:0,g.name);
      }
    }
    profileRole='admin';
    await page.goto(base+'/dashboard');
    await page.getByRole('tab',{name:'Setup',exact:true}).click();
    await page.getByRole('tab',{name:'Coins & POS',exact:true}).click();
    await page.getByLabel('Karaoke coin price').fill('200');
    await page.getByRole('button',{name:'Save Games',exact:true}).click();
    await page.getByText('Game Prices Saved',{exact:true}).waitFor();
    assert.equal(savedGames.length,15);
    assert.ok(savedGames.some(g=>g.pricing_mode==='donation' && g.price===200));
    const karaokeGroup=page.getByRole('combobox',{name:'Karaoke activity group',exact:true});
    await karaokeGroup.scrollIntoViewIfNeeded();
    await page.screenshot({path:`/tmp/pinkd-activity-admin-${width}.png`});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) console.error(await page.evaluate(()=>[...document.querySelectorAll('main *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,cls:el.className,text:el.textContent.slice(0,60),right:el.getBoundingClientRect().right})).slice(-20)));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    console.log(`PASS ${width}px: groups/free controls, amount validation, lookup timeout, late NFC, double confirm, reload, lost-response recovery`);
    await context.close();
  }
} finally { await browser.close(); }
