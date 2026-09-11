import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.env.PINKD_PLAYWRIGHT_ROOT + '/package.json')('playwright');
const base = process.env.PINKD_TEST_URL || 'http://127.0.0.1:8092';
if (!['localhost','127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local mocks only');
const user = { id:'00000000-0000-4000-8000-000000000001', aud:'authenticated', role:'authenticated', email:'projector@example.test' };
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  for (const [width,height] of [[1920,1080],[1366,768],[390,844]]) {
    const context = await browser.newContext({viewport:{width,height}});
    let total=9000, fail=false;
    const errors=[];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(base).origin) return route.continue();
      if (!url.hostname.endsWith('.supabase.co')) return route.abort();
      const name=url.pathname.split('/').at(-1);
      if (name==='user') return route.fulfill({json:user});
      if (name==='profiles') return route.fulfill({json:{...user,full_name:'Projector Admin',role:'admin'}});
      if (name==='get_dare_board_progress') {
        const makeEntry=(n,first_name,coins,studio)=>({transaction_id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,created_at:`2026-09-11T16:0${n}:00Z`,first_name,coins,studio,item_name:'Spin the Wheel',source:'tier_1',voided:false});
        const entries=[makeEntry(1,'Rohan',9000,'SD'),...(total>9000?[makeEntry(2,'Mira',1000,'RG'),makeEntry(3,'Asha',15000,'NDA'),makeEntry(4,'Dev',1000,'GGN')]:[])];
        const older=route.request().postDataJSON()?.p_before_id;
        return fail
        ? route.fulfill({status:503,json:{message:'Unavailable'}})
        : route.fulfill({json:{total_coins:total,tier_1_coins:total-3000,food_coins:1000,bar_coins:2000,counted_sales:entries.length,as_of:new Date().toISOString(),
          milestone_pickers:total>9000?[{...entries[1],milestone:10000},{...entries[2],milestone:25000}]:[],
          latest_transactions:entries.slice(-3).reverse(),recent_transactions:older?[entries[0]]:entries.slice(-3).reverse(),log_has_more:total>9000&&!older}});
      }
      return route.fulfill({json:[]});
    });
    await context.addInitScript(user => {
      const exp=Math.floor(Date.now()/1000)+3600;
      localStorage.setItem('sb-xdaienqjbybomctsoiro-auth-token',JSON.stringify({access_token:btoa('{}')+'.'+btoa(JSON.stringify({sub:user.id,exp}))+'.test',refresh_token:'test',expires_at:exp,token_type:'bearer',user}));
    },user);
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const finishAnimations = () => page.locator('.dare-board').evaluate(async el => {
      await Promise.all(el.getAnimations({subtree:true}).filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));
    });
    await page.goto(base+'/dare-board');
    await page.getByTestId('dare-total').getByText('9,000').waitFor();
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await page.getByRole('list',{name:'Milestones'}).getByRole('button').count(),11);
    if(width>1000) {
      await page.getByRole('button',{name:'Project fullscreen'}).click();
      await page.waitForFunction(()=>Boolean(document.fullscreenElement));
      assert.equal(await page.locator('.dare-board').evaluate(el=>el.scrollHeight>el.clientHeight+1),false,'projected board must fit');
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await finishAnimations();
    await page.screenshot({path:`/tmp/dare-board-${width}.png`,fullPage:width<1000});
    const image=await page.locator('.dare-logo').evaluate(el=>el.complete && el.naturalWidth>0);assert.ok(image);
    const backgroundOK=await page.evaluate(()=>new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(true);img.onerror=()=>resolve(false);img.src='/dare-board-background.png';}));assert.ok(backgroundOK);
    total=26000;
    if (width!==1920) await page.getByRole('button',{name:'Refresh progress'}).click();
    await page.getByRole('dialog').getByText('10,000',{exact:true}).waitFor();
    await page.getByRole('dialog').getByText('Mira',{exact:true}).waitFor();
    assert.equal(await page.getByRole('dialog').getByText('Dev',{exact:true}).count(),0);
    await finishAnimations();
    await page.screenshot({path:`/tmp/dare-board-unlock-${width}.png`});
    await page.getByRole('button',{name:'Next unlocked dare'}).click();
    await page.getByRole('dialog').getByText('25,000',{exact:true}).waitFor();
    await page.getByRole('dialog').getByText('Asha',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Back to the board'}).evaluate(el=>el===document.activeElement),true);
    await page.getByRole('button',{name:'Back to the board'}).click();
    if(width>1000) assert.equal(await page.locator('.dare-board').evaluate(el=>el.scrollHeight>el.clientHeight+1),false,'picker and contribution feed must fit projector');
    await page.getByRole('button',{name:'Transaction log'}).click();
    const log=page.getByRole('dialog',{name:'Contribution log'});
    await log.getByText('Mira',{exact:true}).waitFor();
    assert.equal(await log.getByText(/Card picker/).count(),2);
    await page.screenshot({path:`/tmp/dare-board-log-${width}.png`});
    await log.getByRole('button',{name:'Older contributions'}).click();
    await log.getByText('Rohan',{exact:true}).waitFor();
    assert.equal(await log.getByRole('button',{name:'Older contributions'}).isDisabled(),true);
    await log.getByRole('button',{name:'Newer contributions'}).click();
    await log.getByText('Mira',{exact:true}).waitFor();
    await log.getByRole('button',{name:'Close contribution log'}).click();
    total=9000;
    await page.getByRole('button',{name:'Refresh progress'}).click();
    await page.getByTestId('dare-total').getByText('9,000').waitFor();
    assert.ok(await page.getByRole('button',{name:'10,000 coins: locked',exact:true}).isDisabled());
    total=26000;
    await page.getByRole('button',{name:'Refresh progress'}).click();
    await page.getByTestId('dare-total').getByText('26,000').waitFor();
    assert.equal(await page.getByRole('dialog').count(),0,'void bounce must not auto-celebrate twice');
    await page.reload();
    await page.getByTestId('dare-total').getByText('26,000').waitFor();
    assert.equal(await page.getByRole('dialog').count(),0,'historical milestones must not auto-play on refresh');
    await page.getByRole('button',{name:'25,000 coins: open unlocked dare',exact:true}).click();
    await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({state:'hidden'});
    fail=true;await page.getByRole('button',{name:'Refresh progress'}).click();
    await page.getByRole('alert').getByText(/last confirmed total/).waitFor();
    assert.equal(await page.getByTestId('dare-total').innerText(),'26,000');
    assert.ok(await page.getByRole('button',{name:'25,000 coins: open unlocked dare',exact:true}).isDisabled());
    await page.reload();await page.getByRole('alert').getByText(/backend setup/).waitFor();
    assert.equal(await page.getByTestId('dare-total').innerText(),'--','no invented zero on initial error');
    assert.deepEqual(errors,[]);
    console.log(`Dare Board ${width}x${height}: layout, unlock queue, voids, refresh, replay, offline passed`);
    await context.close();
  }
} finally { await browser.close(); }
