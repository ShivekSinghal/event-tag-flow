import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Isolated UI fixtures only: no customer records, login tokens or production writes.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.ATTENDANCE_PREVIEW_URL || 'http://127.0.0.1:8090';
const output = process.env.ATTENDANCE_SCREENSHOTS || '/tmp/pinkd-attendance-preview';
const hookModule = await (await fetch(`${base}/src/hooks/use-event-admissions.ts`)).text();
const queryModule = hookModule.match(/from "([^"]*@tanstack_react-query[^\"]*)"/)[1];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
let writes = 0;
const guest = (index, studio, name) => ({
  item_id:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`, admission_index:1,
  event_number:1,label:'Wednesday, Sept 9 @ 6:00 PM',order_id:`10000000-0000-4000-8000-${String(index).padStart(12,'0')}`,
  order_ref:`TEST000${index}`,package_name:'1 Intensive',studio,booker_name:'Sample Booker',booker_phone:'9999999999',
  booker_email:'sample@example.com',payment_status:'paid',payment_provider:'cashfree',
  attendee_name:name,attendee_phone:name?'8888888888':null,checked_in_at:null,checked_in_by:null,
});
const guests = [guest(1,'Noida Sector 43 (NDA)','Sample Guest'),guest(2,'Rajouri Garden (RG)','Second Guest'),guest(3,'Noida Sector 43 (NDA)',null)];
const studios = () => [...new Set(guests.map(g=>g.studio))].map(studio=>({studio,event_number:1,
  sold:guests.filter(g=>g.studio===studio).length,checked_in:guests.filter(g=>g.studio===studio&&g.checked_in_at).length}));
const live = () => ({generated_at:new Date().toISOString(),sessions:[1,2,3,4].map(session_number=>({session_number,
  label:`Session ${session_number}`,sold:session_number===1?3:0,on_hold:0,capacity:120,available:session_number===1?117:120})),
  party:{sold:0,on_hold:0},totals:{intensive_admissions:3,party_admissions:0,total_admissions:3,paid_orders:3,event_revenue_inr:4500},
  warnings:{session_assignment_items:0,unknown_package_items:0,pax_items:0,incomplete_session_catalog:false}});
const context = await browser.newContext({ viewport:{width:1440,height:1000} });
await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.includes('/rest/v1/rpc/')) {
    const body=route.request().postDataJSON()??{};
    let result;
    if(url.pathname.endsWith('/get_event_live_sales')) result=live();
    else if(url.pathname.endsWith('/get_event_admission_report')) result={generated_at:new Date().toISOString(),studios:studios(),attendees:body.p_event_number===1?guests:[]};
    else if(url.pathname.endsWith('/set_event_admission_checkin')) {
      writes++;
      const row=guests.find(g=>g.item_id===body.p_item_id);
      assert.ok(row); row.attendee_name ||= body.p_attendee_name; row.attendee_phone ||= body.p_attendee_phone;
      row.checked_in_at=body.p_checked_in?(row.checked_in_at||new Date().toISOString()):null;
      row.checked_in_by=body.p_checked_in?'Preview Admin':null; result=row;
    } else throw new Error(`Unexpected RPC ${url.pathname}`);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});
  }
  if(url.pathname==='/src/main.tsx') return route.fulfill({contentType:'application/javascript',body:`
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import {QueryClient,QueryClientProvider} from '${queryModule}';
    import EventLiveSales from '/src/components/admin/EventLiveSales.tsx';
    import '/src/index.css';
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(QueryClientProvider,{client:new QueryClient()},React.createElement('main',{style:{padding:'24px'}},React.createElement(EventLiveSales))));`});
  if(url.pathname==='/src/contexts/AuthContext.tsx') return route.fulfill({contentType:'application/javascript',body:"export const useAuth=()=>({user:{id:'preview-admin'},isAdmin:true});"});
  if(url.origin!==new URL(base).origin) return route.abort();
  return route.continue();
});
const page=await context.newPage();
const errors=[]; page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto(base);
  await page.getByRole('heading',{name:'Studio Breakdown'}).waitFor();
  await page.screenshot({path:`${output}/desktop-studios.png`,fullPage:true});
  await page.getByRole('button',{name:'Noida Sector 43 (NDA), Intensive 1: 0 entered of 2 booked',exact:true}).click();
  await page.getByRole('heading',{name:'Intensive 1 Attendance'}).waitFor();
  assert.equal(await page.getByLabel('Studio filter').inputValue(),'Noida Sector 43 (NDA)');
  await page.getByLabel('Search attendees').fill('TEST0001');
  assert.equal(await page.getByRole('button',{name:'Check in',exact:true}).count(),1);
  await page.getByRole('button',{name:'Check in',exact:true}).click();
  await page.getByRole('button',{name:'Confirm check-in',exact:true}).click();
  await page.getByRole('button',{name:'Undo',exact:true}).waitFor();
  assert.equal(writes,1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await page.getByRole('button',{name:'Confirm undo',exact:true}).click();
  await page.getByRole('button',{name:'Check in',exact:true}).waitFor();
  assert.equal(writes,2);
  await page.getByLabel('Search attendees').fill('TEST0003');
  await page.getByRole('button',{name:'Check in',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Confirm check-in',exact:true}).isDisabled(),true);
  await page.getByLabel('Guest name',{exact:true}).fill('Third Guest');
  await page.getByLabel('Guest phone',{exact:true}).fill('7777777777');
  await page.getByRole('button',{name:'Confirm check-in',exact:true}).click();
  await page.getByRole('button',{name:'Undo',exact:true}).waitFor();
  await page.getByLabel('Search attendees').fill('');
  await page.getByLabel('Studio filter').selectOption('all');
  await page.getByLabel('Check-in filter').selectOption('entered');
  assert.equal(await page.getByRole('button',{name:'Undo',exact:true}).count(),1);
  await page.getByLabel('Check-in filter').selectOption('all');
  await page.getByRole('button',{name:'Open full-screen preview',exact:true}).click();
  await page.screenshot({path:`${output}/desktop-attendees.png`,fullPage:true});
  await page.getByRole('button',{name:'Exit full-screen preview',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.getByRole('button',{name:'Check in',exact:true}).first().isVisible(),true);
  await page.screenshot({path:`${output}/mobile-attendees.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'page must not overflow horizontally');
  await page.getByRole('button',{name:'Back to sales',exact:true}).click();
  await page.getByRole('button',{name:'Party',exact:true}).click();
  await page.getByRole('heading',{name:'Party Attendance'}).waitFor();
  assert.equal(await page.getByText('No guests match these filters.').last().isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,writes,screenshots:output,coverage:'studio drill-down, search, filter, check-in, undo, missing details, full-screen, mobile, party empty state',data:'isolated fixtures only'}));
} catch (error) {
  console.error(JSON.stringify({errors,body:await page.locator('body').innerText()}));
  await page.screenshot({path:`${output}/failure.png`,fullPage:true});
  throw error;
} finally { await browser.close(); }
