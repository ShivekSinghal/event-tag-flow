import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

if (!process.env.PINKD_PLAYWRIGHT_ROOT) throw new Error('Set PINKD_PLAYWRIGHT_ROOT to the directory containing the playwright package.');
const require = createRequire(process.env.PINKD_PLAYWRIGHT_ROOT + '/package.json');
const {chromium}=require('playwright');
const base=process.env.PINKD_TEST_URL || 'http://127.0.0.1:8092';
if (!['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Browser test is localhost-only.');
const user={id:'00000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated',email:'operator@example.test'};
const wallet='00000000-0000-0000-0000-000000000002';
const pack='00000000-0000-0000-0000-000000000003';
const operation={version:1,id:'00000000-0000-0000-0000-000000000004',operator:user.id,
  request:{kind:'spend',wallet_id:wallet,coin_amount:750,transaction_type:'food',item_name:'Test food',reference:'TEST'}};
const browser=await chromium.launch({channel:'chrome',headless:true});
await mkdir('/tmp/pinkd-wallet-retry-screens',{recursive:true});
try {
  for(const width of [390,1440]){
    const context=await browser.newContext({viewport:{width,height:900}});
    const calls=[],errors=[];
    let failNext=true,failVoid=true,profileRole='admin';
    const voidCalls=[];
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin===new URL(base).origin)return route.continue();
      if(!url.hostname.endsWith('.supabase.co'))return route.abort();
      const json=body=>route.fulfill({json:body});
      if(url.pathname.endsWith('/void_pos_sale')){
        voidCalls.push(route.request().postDataJSON());
        if(failVoid){failVoid=false;return route.abort();}
        return json({status:'succeeded',transaction_id:'00000000-0000-0000-0000-000000000006',
          voided_transaction_id:'00000000-0000-0000-0000-000000000005',new_coin_balance:2000,credited_coin_amount:750});
      }
      if(url.pathname.endsWith('/transactions'))return json({id:'00000000-0000-0000-0000-000000000005',wallet_id:wallet,
        type:'food',coin_amount:-750,item_name:'Test food',reference:'TEST'});
      if(url.pathname.endsWith('/execute_wallet_operation')){
        calls.push(route.request().postDataJSON());
        if(profileRole==='staff')return json({status:'rejected',message:'Insufficient coins'});
        if(failNext){failNext=false;return route.abort();}
        return json({status:'succeeded',transaction_id:'00000000-0000-0000-0000-000000000005',new_coin_balance:1250});
      }
      if(url.pathname==='/auth/v1/user')return json(user);
      if(url.pathname.includes('/profiles'))return json({...user,role:profileRole,full_name:'Test operator'});
      if(url.pathname.includes('/staff_permissions'))return json([{id:pack,permission_type:'food',game_id:null}]);
      if(url.pathname.includes('/wallets'))return json({id:wallet,tag_id:'NFC04ABCD11223344',attendee_name:'Test guest',attendee_phone:'0000000000',coin_balance:2000,status:'active'});
      if(url.pathname.includes('/coin_packages'))return json([{id:pack,inr_amount:2000,coin_amount:2000,active:true,display_order:0}]);
      return json([]);
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({user,operation})=>{
      const exp=Math.floor(Date.now()/1000)+3600;
      const access_token=btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+btoa(JSON.stringify({sub:user.id,role:'authenticated',aud:'authenticated',exp}))+'.test';
      localStorage.setItem('sb-xdaienqjbybomctsoiro-auth-token',JSON.stringify({access_token,refresh_token:'synthetic-test',expires_at:exp,expires_in:3600,token_type:'bearer',user}));
      if(!sessionStorage.getItem('test.initialized')){
        sessionStorage.setItem('pinkd.wallet-operation.v1:'+user.id,JSON.stringify(operation));
        sessionStorage.setItem('test.initialized','1');
      }
    },{user,operation});
    await page.goto(base+'/pos');
    await page.getByText('Payment status unknown',{exact:true}).waitFor();
    assert.equal(await page.locator('fieldset').evaluate(el=>el.disabled),true);
    assert.equal(await page.locator('fieldset button').first().isDisabled(),true);
    await page.getByRole('button',{name:'Check / Retry safely'}).click();
    await page.getByText('Payment status unknown',{exact:true}).waitFor();
    await page.reload();
    await page.getByText('Payment status unknown',{exact:true}).waitFor();
    await page.goto(base+'/topup');
    await page.getByText('Payment status unknown',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Scan NFC Tag'}).isDisabled(),true);
    await page.goto(base+'/pos');
    await page.getByText('Payment status unknown',{exact:true}).waitFor();
    await page.screenshot({path:`/tmp/pinkd-wallet-retry-screens/pending-${width}.png`});
    await page.getByRole('button',{name:'Check / Retry safely'}).click();
    await page.getByRole('heading',{name:'Last sale',exact:true}).waitFor();
    assert.deepEqual(calls[0],calls[1]);
    assert.equal(await page.locator('fieldset').evaluate(el=>el.disabled),false);
    await page.screenshot({path:`/tmp/pinkd-wallet-retry-screens/confirmed-${width}.png`});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
    await page.reload();
    await page.getByRole('heading',{name:'Last sale',exact:true}).waitFor();
    await page.getByRole('button',{name:'Void last sale'}).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByRole('button',{name:'Confirm coin refund'}).isDisabled(),true);
    await page.getByLabel('Reason for void').fill('Wrong item selected');
    await page.getByRole('dialog').evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished));});
    await page.screenshot({path:`/tmp/pinkd-wallet-retry-screens/void-confirm-${width}.png`});
    await page.getByRole('button',{name:'Confirm coin refund'}).click();
    await page.getByText('Void status unknown',{exact:true}).waitFor();
    await page.reload();
    await page.getByText('Void status unknown',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Check / Retry safely'}).click();
    await page.getByText('Sale voided',{exact:true}).waitFor();
    await page.getByRole('heading',{name:'Last sale (voided)',exact:true}).waitFor();
    assert.deepEqual(voidCalls[0],voidCalls[1]);assert.equal(voidCalls.length,2);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
    await page.screenshot({path:`/tmp/pinkd-wallet-retry-screens/voided-${width}.png`});
    // A restricted staff profile sees the receipt and insufficient-balance notice, but no admin actions.
    profileRole='staff';
    await page.evaluate(({user,operation})=>sessionStorage.setItem('pinkd.wallet-operation.v1:'+user.id,JSON.stringify(operation)),{user,operation});
    await page.reload();await page.getByText('Payment status unknown',{exact:true}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'Admin sale controls'}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Void last sale'}).count(),0);
    await page.getByRole('button',{name:'Check / Retry safely'}).click();
    await page.getByText('Insufficient Pink\'d Coins',{exact:true}).waitFor();
    assert.equal(await page.getByRole('link',{name:'Open Top Up'}).count(),0);
    await page.getByRole('heading',{name:'Last sale (voided)',exact:true}).waitFor();
    await page.screenshot({path:`/tmp/pinkd-wallet-retry-screens/staff-insufficient-${width}.png`});
    profileRole='admin';
    // Exercise the real Top Up screen with synthetic browser NFC fallback and mocked API.
    await page.goto(base+'/topup');
    page.once('dialog',dialog=>dialog.accept('04:AB:CD:11:22:33:44'));
    await page.getByRole('button',{name:'Scan NFC Tag'}).click();
    await page.getByText('Test guest',{exact:true}).waitFor();
    await page.getByRole('button',{name:/₹2,000/}).click();
    await page.getByLabel('Confirmed Payment Reference').fill('RECEIPT-TEST');
    await page.getByRole('button',{name:/Credit 2,000/}).click();
    await page.getByText('Payment confirmed',{exact:true}).waitFor();
    assert.equal(calls.at(-1).p_request.kind,'topup');
    assert.equal(calls.at(-1).p_request.reference,'RECEIPT-TEST');
    assert.deepEqual(errors,[]);
    console.log(`${width}px: pending, failure, refresh, safe retry, persistent receipt, admin void and top-up passed; all external I/O mocked`);
    await context.close();
  }
} finally {await browser.close();}
