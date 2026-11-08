import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let state={session:null,user:null,profile:null,household:null,members:[],tasks:[],events:[],assets:[],plans:[],records:[],taskFilter:'active',assetFilter:'all',channels:[]};
let signupMode=false, editorMode=null, editingId=null;

function toast(msg){const e=$('#toast');e.textContent=msg;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2600)}
function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function localInput(d){if(!d)return'';const x=new Date(d);x.setMinutes(x.getMinutes()-x.getTimezoneOffset());return x.toISOString().slice(0,16)}
function weekEnd(){const d=new Date();const day=d.getDay()||7;d.setDate(d.getDate()+(7-day));d.setHours(23,59,59,999);return d}
function statusClass(date,done=false,noDate=false){if(done)return'status-green';if(noDate||!date)return'status-gray';const x=new Date(date),n=new Date();if(x<n)return'status-red';if(x<=weekEnd())return'status-orange';return'status-blue'}
function dateText(v,allDay=false){if(!v)return'Sans échéance';const d=new Date(v);return d.toLocaleString('fr-FR',allDay?{dateStyle:'medium'}:{dateStyle:'medium',timeStyle:'short'})}
function startOfToday(){const d=new Date();d.setHours(0,0,0,0);return d}
function endOfToday(){const d=new Date();d.setHours(23,59,59,999);return d}
function activeTask(t){return !t.deleted_at&&t.status==='open'}
function taskIcon(){return'✅'}
function empty(text){return `<div class="empty">${esc(text)}</div>`}

async function init(){
 if('serviceWorker'in navigator) navigator.serviceWorker.register('./service-worker.js').catch(console.warn);
 const {data:{session}}=await supabase.auth.getSession(); await handleSession(session);
 supabase.auth.onAuthStateChange((_e,s)=>setTimeout(()=>handleSession(s),0));
 bindUI();
}
async function handleSession(session){
 state.session=session;state.user=session?.user||null;
 $('#auth-view').classList.toggle('hidden',!!session);$('#app-view').classList.toggle('hidden',!session);
 if(!session)return;
 $('#account-email').textContent=session.user.email||'';
 await loadContext();
}
async function loadContext(){
 setSync('Synchronisation…');
 const uid=state.user.id;
 const [{data:profile},{data:members,error}]=await Promise.all([
  supabase.from('profiles').select('*').eq('id',uid).maybeSingle(),
  supabase.from('household_members').select('household_id,role,households(*)').eq('user_id',uid)
 ]);
 if(error){toast(error.message);setSync('Erreur');return}
 state.profile=profile;const membership=members?.[0];state.household=membership?.households||null;
 $('#onboarding').classList.toggle('hidden',!!state.household);$('#settings-household').textContent=state.household?.name||'Non configuré';
 if(!state.household){renderAll();setSync('Synchronisé');return}
 await loadData();subscribeRealtime();setSync('Synchronisé');
}
async function loadData(){
 const h=state.household.id;
 const results=await Promise.all([
  supabase.from('household_members').select('*,profiles(*)').eq('household_id',h),
  supabase.from('tasks').select('*').eq('household_id',h).order('due_at',{ascending:true,nullsFirst:false}),
  supabase.from('events').select('*').eq('household_id',h).is('deleted_at',null).order('starts_at'),
  supabase.from('assets').select('*').eq('household_id',h).is('deleted_at',null).order('name'),
  supabase.from('maintenance_plans').select('*').eq('household_id',h).is('deleted_at',null).order('next_due_at',{ascending:true,nullsFirst:false}),
  supabase.from('maintenance_records').select('*').eq('household_id',h).order('performed_at',{ascending:false})
 ]);
 const err=results.find(r=>r.error)?.error;if(err){toast(err.message);return}
 [state.members,state.tasks,state.events,state.assets,state.plans,state.records]=results.map(r=>r.data||[]);renderAll();
}
function subscribeRealtime(){state.channels.forEach(c=>supabase.removeChannel(c));state.channels=[];if(!state.household)return;
 ['tasks','events','assets','maintenance_plans','maintenance_records','household_members'].forEach(table=>{
  const c=supabase.channel(`${table}-${state.household.id}`).on('postgres_changes',{event:'*',schema:'public',table,filter:`household_id=eq.${state.household.id}`},()=>loadData()).subscribe();state.channels.push(c);
 });
}
function setSync(v){$('#sync-state').textContent=v}

function renderAll(){
 const name=state.profile?.display_name?.split(' ')[0]||'';$('#hello-label').textContent=`Bonjour${name?' '+name:''}`;$('#today-label').textContent=new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
 renderDashboard();renderTasks();renderAgenda();renderAssets();
}
function unified(){
 const list=[];state.tasks.filter(activeTask).forEach(t=>list.push({kind:'task',icon:'✅',title:t.title,date:t.due_at,data:t}));
 state.events.forEach(e=>list.push({kind:'event',icon:'📅',title:e.title,date:e.starts_at,data:e}));
 state.plans.filter(p=>p.active).forEach(p=>{const a=state.assets.find(x=>x.id===p.asset_id);list.push({kind:'plan',icon:a?.asset_type==='vehicle'?'🚗':'🏠',title:p.title,date:p.next_due_at,data:p})});
 return list.sort((a,b)=>(a.date?new Date(a.date):Infinity)-(b.date?new Date(b.date):Infinity));
}
function renderDashboard(){const items=unified(),now=new Date(),sd=startOfToday(),ed=endOfToday(),we=weekEnd();const overdue=items.filter(x=>x.date&&new Date(x.date)<sd),today=items.filter(x=>x.date&&new Date(x.date)>=sd&&new Date(x.date)<=ed),week=items.filter(x=>x.date&&new Date(x.date)>ed&&new Date(x.date)<=we);
 $('#count-overdue').textContent=overdue.length;$('#count-today').textContent=today.length;$('#count-week').textContent=today.length+week.length;
 $('#priority-list').innerHTML=(overdue.slice(0,4).map(itemHTML).join('')||empty('Aucune action en retard.'));
 $('#today-list').innerHTML=(today.slice(0,4).map(itemHTML).join('')||empty('Rien de prévu aujourd’hui.'));
 $('#week-list').innerHTML=(week.slice(0,5).map(itemHTML).join('')||empty('Aucune autre action cette semaine.'));
}
function itemHTML(x){const done=x.kind==='task'&&x.data.status==='completed';return `<article class="item"><span class="item-icon">${x.icon}</span><div><div class="item-title ${statusClass(x.date,done,!x.date)}">${esc(x.title)}</div><div class="item-meta">${dateText(x.date)}</div></div>${x.kind==='task'?`<div class="item-actions"><button class="mini" data-complete="${x.data.id}" type="button">Terminer</button><button class="mini" data-edit-task="${x.data.id}" type="button">Modifier</button></div>`:''}</article>`}
function renderTasks(){let list=state.tasks;if(state.taskFilter==='active')list=list.filter(activeTask);if(state.taskFilter==='completed')list=list.filter(t=>t.status==='completed'&&!t.deleted_at);if(state.taskFilter==='trash')list=list.filter(t=>t.deleted_at);if(state.taskFilter==='all')list=list.filter(t=>!t.deleted_at);
 $('#tasks-list').innerHTML=list.length?list.map(t=>`<article class="item"><span class="item-icon">${taskIcon()}</span><div><div class="item-title ${statusClass(t.due_at,t.status==='completed',!t.due_at)}">${esc(t.title)}</div><div class="item-meta">${dateText(t.due_at)} · ${t.status==='completed'?'Terminée':'À faire'}</div></div><div class="item-actions">${activeTask(t)?`<button class="mini" data-complete="${t.id}" type="button">Terminer</button><button class="mini" data-edit-task="${t.id}" type="button">Modifier</button><button class="mini" data-trash-task="${t.id}" type="button">Supprimer</button>`:''}${t.deleted_at?`<button class="mini" data-restore-task="${t.id}" type="button">Restaurer</button>`:''}</div></article>`).join(''):empty('Aucune tâche dans cette vue.')}
function renderAgenda(){const items=unified();$('#agenda-list').innerHTML=items.length?items.map(itemHTML).join(''):empty('Aucun élément dans l’agenda.')}
function renderAssets(){let a=state.assets;if(state.assetFilter!=='all')a=a.filter(x=>x.asset_type===state.assetFilter);$('#assets-list').innerHTML=a.length?a.map(x=>{const plans=state.plans.filter(p=>p.asset_id===x.id&&!p.deleted_at);return `<article class="item"><span class="item-icon">${x.asset_type==='vehicle'?'🚗':'🏠'}</span><div><div class="item-title">${esc(x.name)}</div><div class="item-meta">${esc(x.category||'Sans catégorie')} · ${plans.length} entretien(s)</div></div><div class="item-actions"><button class="mini" data-add-plan="${x.id}" type="button">＋ Entretien</button></div></article>${plans.map(p=>`<article class="item"><span class="item-icon">🔧</span><div><div class="item-title ${statusClass(p.next_due_at,false,!p.next_due_at)}">${esc(p.title)}</div><div class="item-meta">${dateText(p.next_due_at)}${p.next_due_mileage!=null?' · '+p.next_due_mileage+' km':''}</div></div><div class="item-actions"><button class="mini" data-done-plan="${p.id}" type="button">Effectué</button></div></article>`).join('')}`}).join(''):empty('Aucun équipement enregistré.')}

function showScreen(name){$$('.screen').forEach(x=>x.classList.add('hidden'));$(`#screen-${name}`).classList.remove('hidden');$$('.nav-btn').forEach(x=>x.classList.toggle('active',x.dataset.screen===name));window.scrollTo({top:0,behavior:'smooth'})}
function field(label,name,type='text',value='',extra=''){return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`}
function openEditor(mode,id=null){editorMode=mode;editingId=id;let html='',title='Ajouter';
 if(mode==='task'){const t=state.tasks.find(x=>x.id===id);title=t?'Modifier la tâche':'Nouvelle tâche';html=field('Nom de la tâche','title','text',t?.title||'','required maxlength="200"')+`<label>Description<textarea name="description">${esc(t?.description||'')}</textarea></label>`+field('Échéance','due_at','datetime-local',localInput(t?.due_at))+`<label>Responsable<select name="assignee"><option value="unassigned">Non attribué</option><option value="everyone">Les deux</option>${state.members.map(m=>`<option value="${m.user_id}" ${t?.assigned_user_id===m.user_id?'selected':''}>${esc(m.profiles?.display_name||'Membre')}</option>`).join('')}</select></label><label class="check-row"><input type="checkbox" name="notifications_enabled" ${t?.notifications_enabled?'checked':''}> Activer les notifications</label><p class="help">La réception en arrière-plan sera activée dans la phase Notifications.</p>`}
 if(mode==='event'){title='Nouvel événement';html=field('Titre','title','text','','required maxlength="200"')+field('Début','starts_at','datetime-local','','required')+field('Fin','ends_at','datetime-local')+field('Lieu','location')+`<label>Description<textarea name="description"></textarea></label>`}
 if(mode==='asset'){title='Nouvel équipement';html=`<label>Type<select name="asset_type"><option value="home">🏠 Maison</option><option value="vehicle">🚗 Véhicule</option></select></label>`+field('Nom','name','text','','required maxlength="200"')+field('Catégorie','category')+field('Marque','make')+field('Modèle','model')+field('Kilométrage actuel','current_mileage','number','','min="0"')+`<label>Notes<textarea name="notes"></textarea></label>`}
 if(mode==='plan'){title='Nouvel entretien';html=`<input type="hidden" name="asset_id" value="${id}">`+field('Opération','title','text','','required maxlength="200"')+field('Prochaine date','next_due_at','datetime-local')+field('Prochain kilométrage','next_due_mileage','number','','min="0"')+field('Intervalle en mois','interval_months','number','','min="1"')}
 $('#editor-title').textContent=title;$('#editor-fields').innerHTML=html;$('#editor-dialog').showModal();
}
async function saveEditor(fd){if(!state.household)return;const h=state.household.id,u=state.user.id;let res;
 if(editorMode==='task'){const ass=fd.get('assignee');const row={household_id:h,title:fd.get('title').trim(),description:fd.get('description')||null,due_at:fd.get('due_at')?new Date(fd.get('due_at')).toISOString():null,assignee_type:ass==='unassigned'?'unassigned':ass==='everyone'?'everyone':'member',assigned_user_id:!['unassigned','everyone'].includes(ass)?ass:null,notifications_enabled:fd.get('notifications_enabled')==='on',updated_by:u};if(editingId)res=await supabase.from('tasks').update(row).eq('id',editingId);else res=await supabase.from('tasks').insert({...row,created_by:u})}
 if(editorMode==='event')res=await supabase.from('events').insert({household_id:h,title:fd.get('title').trim(),description:fd.get('description')||null,location:fd.get('location')||null,starts_at:new Date(fd.get('starts_at')).toISOString(),ends_at:fd.get('ends_at')?new Date(fd.get('ends_at')).toISOString():null,created_by:u});
 if(editorMode==='asset')res=await supabase.from('assets').insert({household_id:h,asset_type:fd.get('asset_type'),name:fd.get('name').trim(),category:fd.get('category')||null,make:fd.get('make')||null,model:fd.get('model')||null,current_mileage:fd.get('current_mileage')?Number(fd.get('current_mileage')):null,notes:fd.get('notes')||null,created_by:u});
 if(editorMode==='plan')res=await supabase.from('maintenance_plans').insert({household_id:h,asset_id:fd.get('asset_id'),title:fd.get('title').trim(),schedule_type:fd.get('next_due_mileage')?'date_or_mileage':'date',next_due_at:fd.get('next_due_at')?new Date(fd.get('next_due_at')).toISOString():null,next_due_mileage:fd.get('next_due_mileage')?Number(fd.get('next_due_mileage')):null,interval_months:fd.get('interval_months')?Number(fd.get('interval_months')):null,created_by:u});
 if(res?.error)throw res.error;toast('Enregistré');await loadData();
}
async function completeTask(id){const {error}=await supabase.from('tasks').update({status:'completed',completed_at:new Date().toISOString(),completed_by:state.user.id,updated_by:state.user.id,next_reminder_at:null}).eq('id',id);if(error)toast(error.message);else{toast('Tâche terminée');await loadData()}}
async function trashTask(id){if(!confirm('Supprimer cette tâche et arrêter ses futurs rappels ?'))return;const {error}=await supabase.from('tasks').update({deleted_at:new Date().toISOString(),deleted_by:state.user.id,next_reminder_at:null,updated_by:state.user.id}).eq('id',id);if(error)toast(error.message);else await loadData()}
async function restoreTask(id){const {error}=await supabase.from('tasks').update({deleted_at:null,deleted_by:null,updated_by:state.user.id}).eq('id',id);if(error)toast(error.message);else await loadData()}
async function completePlan(id){const p=state.plans.find(x=>x.id===id);if(!p)return;const mileage=prompt('Kilométrage lors de l’entretien (laisser vide si non applicable)');const {error}=await supabase.from('maintenance_records').insert({household_id:state.household.id,asset_id:p.asset_id,maintenance_plan_id:p.id,mileage:mileage?Number(mileage):null,performed_by:state.user.id,created_by:state.user.id});if(error){toast(error.message);return}let next=null;if(p.interval_months){next=new Date();next.setMonth(next.getMonth()+p.interval_months)}await supabase.from('maintenance_plans').update({next_due_at:next?.toISOString()||p.next_due_at,next_due_mileage:mileage&&p.interval_mileage?Number(mileage)+p.interval_mileage:p.next_due_mileage,updated_by:state.user.id}).eq('id',id);toast('Entretien enregistré');await loadData()}

function bindUI(){
 $('#tab-login').onclick=()=>setAuthMode(false);$('#tab-signup').onclick=()=>setAuthMode(true);
 $('#auth-form').addEventListener('submit',async e=>{e.preventDefault();const email=$('#auth-email').value.trim(),password=$('#auth-password').value;$('#auth-submit').disabled=true;const {error}=signupMode?await supabase.auth.signUp({email,password,options:{emailRedirectTo:location.href.split('#')[0]}}):await supabase.auth.signInWithPassword({email,password});$('#auth-submit').disabled=false;if(error)$('#auth-message').textContent=error.message;else $('#auth-message').textContent=signupMode?'Compte créé. Consulte ton e-mail pour confirmer l’inscription.':'Connexion réussie.'});
 $('#reset-password').onclick=async()=>{const email=$('#auth-email').value.trim();if(!email)return toast('Saisis d’abord ton adresse e-mail');const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.href.split('#')[0]});toast(error?error.message:'E-mail de réinitialisation envoyé')};
 $('#profile-household-form').addEventListener('submit',async e=>{e.preventDefault();const name=$('#display-name').value.trim(),hname=$('#household-name').value.trim(),u=state.user.id;const p=await supabase.from('profiles').upsert({id:u,display_name:name,email:state.user.email});if(p.error)return toast(p.error.message);const {data:h,error}=await supabase.from('households').insert({name:hname,owner_user_id:u}).select().single();if(error)return toast(error.message);const m=await supabase.from('household_members').insert({household_id:h.id,user_id:u,role:'owner'});if(m.error)return toast(m.error.message);toast('Foyer créé');await loadContext()});
 $$('.nav-btn').forEach(b=>b.onclick=()=>showScreen(b.dataset.screen));$('#quick-add').onclick=()=>openEditor('task');$('#add-task').onclick=()=>openEditor('task');$('#add-event').onclick=()=>openEditor('event');$('#add-asset').onclick=()=>openEditor('asset');
 $('#editor-form').addEventListener('submit',async e=>{e.preventDefault();try{await saveEditor(new FormData(e.currentTarget));$('#editor-dialog').close()}catch(err){toast(err.message)}});

$$('[data-close-editor]').forEach(button=>{
  button.addEventListener('click',()=>{
    $('#editor-dialog').close();
  });
});
 $('#settings-btn').onclick=()=>$('#settings-dialog').showModal();$('[data-close-settings]').onclick=()=>$('#settings-dialog').close();$('#signout-btn').onclick=async()=>{await supabase.auth.signOut();location.reload()};
 document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.complete)completeTask(b.dataset.complete);if(b.dataset.editTask)openEditor('task',b.dataset.editTask);if(b.dataset.trashTask)trashTask(b.dataset.trashTask);if(b.dataset.restoreTask)restoreTask(b.dataset.restoreTask);if(b.dataset.addPlan)openEditor('plan',b.dataset.addPlan);if(b.dataset.donePlan)completePlan(b.dataset.donePlan);if(b.dataset.go)showScreen(b.dataset.go);if(b.dataset.taskFilter){state.taskFilter=b.dataset.taskFilter;$$('[data-task-filter]').forEach(x=>x.classList.toggle('active',x===b));renderTasks()}if(b.dataset.assetFilter){state.assetFilter=b.dataset.assetFilter;$$('[data-asset-filter]').forEach(x=>x.classList.toggle('active',x===b));renderAssets()}if(b.dataset.homeFilter){showScreen('agenda')}});
 window.addEventListener('online',()=>setSync('Synchronisé'));window.addEventListener('offline',()=>setSync('Hors connexion'));
}
function setAuthMode(v){signupMode=v;$('#tab-login').classList.toggle('active',!v);$('#tab-signup').classList.toggle('active',v);$('#auth-submit').textContent=v?'Créer mon compte':'Se connecter';$('#password-help').classList.toggle('hidden',!v);$('#auth-password').autocomplete=v?'new-password':'current-password'}
init();
