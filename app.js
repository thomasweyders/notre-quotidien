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
 bindUI();
 if('serviceWorker'in navigator) navigator.serviceWorker.register('./service-worker.js').catch(console.warn);
 const {data:{session}}=await supabase.auth.getSession(); await handleSession(session);
 supabase.auth.onAuthStateChange((_e,s)=>setTimeout(()=>handleSession(s),0));
 
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
 $('#household-invitation-section')
  ?.classList.toggle(
    'hidden',
    !state.household
  );
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

function showCreateHousehold(){
  $('#profile-household-form')
    .classList.remove('hidden');

  $('#join-household-form')
    .classList.add('hidden');

  $('#onboarding-create-tab')
    .classList.add('active');

  $('#onboarding-join-tab')
    .classList.remove('active');
}

function showJoinHousehold(){
  $('#profile-household-form')
    .classList.add('hidden');

  $('#join-household-form')
    .classList.remove('hidden');

  $('#onboarding-create-tab')
    .classList.remove('active');

  $('#onboarding-join-tab')
    .classList.add('active');
}

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
function itemHTML(x,allowManage=false){
  const done=
    x.kind==='task'
    && x.data.status==='completed';

  let actions='';

  if(x.kind==='task'){
    actions=`
      <div class="item-actions">
        <button
          class="mini"
          data-complete="${x.data.id}"
          type="button"
        >
          Terminer
        </button>

        <button
          class="mini"
          data-edit-task="${x.data.id}"
          type="button"
        >
          Modifier
        </button>
      </div>
    `;
  }

  if(x.kind==='event' && allowManage){
    actions=`
      <div class="item-actions">
        <button
          class="mini"
          data-delete-event="${x.data.id}"
          type="button"
        >
          Supprimer
        </button>
      </div>
    `;
  }

  return `
    <article class="item">
      <span class="item-icon">${x.icon}</span>

      <div>
        <div class="item-title ${
          statusClass(
            x.date,
            done,
            !x.date
          )
        }">
          ${esc(x.title)}
        </div>

        <div class="item-meta">
          ${dateText(x.date)}
        </div>
      </div>

      ${actions}
    </article>
  `;
}
function renderTasks(){let list=state.tasks;if(state.taskFilter==='active')list=list.filter(activeTask);if(state.taskFilter==='completed')list=list.filter(t=>t.status==='completed'&&!t.deleted_at);if(state.taskFilter==='trash')list=list.filter(t=>t.deleted_at);if(state.taskFilter==='all')list=list.filter(t=>!t.deleted_at);
 $('#tasks-list').innerHTML=list.length?list.map(t=>`<article class="item"><span class="item-icon">${taskIcon()}</span><div><div class="item-title ${statusClass(t.due_at,t.status==='completed',!t.due_at)}">${esc(t.title)}</div><div class="item-meta">${dateText(t.due_at)} · ${t.status==='completed'?'Terminée':'À faire'}</div></div><div class="item-actions">${activeTask(t)?`<button class="mini" data-complete="${t.id}" type="button">Terminer</button><button class="mini" data-edit-task="${t.id}" type="button">Modifier</button><button class="mini" data-trash-task="${t.id}" type="button">Supprimer</button>`:''}${t.deleted_at?`<button class="mini" data-restore-task="${t.id}" type="button">Restaurer</button>`:''}</div></article>`).join(''):empty('Aucune tâche dans cette vue.')}
function renderAgenda(){
  const items=unified();

  $('#agenda-list').innerHTML=
    items.length
      ? items
          .map(item=>itemHTML(item,true))
          .join('')
      : empty('Aucun élément dans l’agenda.');
}
function renderAssets(){let a=state.assets;if(state.assetFilter!=='all')a=a.filter(x=>x.asset_type===state.assetFilter);$('#assets-list').innerHTML=a.length?a.map(x=>{const plans=state.plans.filter(p=>p.asset_id===x.id&&!p.deleted_at);return `<article class="item"><span class="item-icon">${x.asset_type==='vehicle'?'🚗':'🏠'}</span><div><div class="item-title">${esc(x.name)}</div><div class="item-meta">${esc(x.category||'Sans catégorie')} ·${plans.length} entretien(s) planifié(s) · ${
  state.records.filter(
    record=>record.asset_id===x.id
  ).length
} intervention(s) réalisée(s) </div></div><div class="item-actions"><button class="mini" data-add-plan="${x.id}" type="button">＋ Entretien</button></div></article>${plans.map(p=>`<article class="item"><span class="item-icon">🔧</span><div><div class="item-title ${statusClass(p.next_due_at,false,!p.next_due_at)}">${esc(p.title)}</div><div class="item-meta">${dateText(p.next_due_at)} ${p.next_due_mileage!=null   ? ' · '+p.next_due_mileage+' km'   : '' } ${p.interval_months   ? ' · tous les '+p.interval_months+' mois'   : '' } ${p.interval_mileage   ? ' · tous les '+p.interval_mileage+' km'   : '' }</div></div><div class="item-actions"><button
  class="mini"
  data-edit-plan="${p.id}"
  type="button"
>
  Modifier
</button>

<button
  class="mini"
  data-done-plan="${p.id}"
  type="button"
>
  Effectué
</button>

<button
  class="mini"
  data-delete-plan="${p.id}"
  type="button"
>
  Supprimer
</button>
</div></article>`).join('')}`}).join(''):empty('Aucun équipement enregistré.')}

function showScreen(name){$$('.screen').forEach(x=>x.classList.add('hidden'));$(`#screen-${name}`).classList.remove('hidden');$$('.nav-btn').forEach(x=>x.classList.toggle('active',x.dataset.screen===name));window.scrollTo({top:0,behavior:'smooth'})}
function field(label,name,type='text',value='',extra=''){return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`}
function openEditor(mode,id=null){editorMode=mode;editingId=id;let html='',title='Ajouter';
 if(mode==='task'){const t=state.tasks.find(x=>x.id===id);title=t?'Modifier la tâche':'Nouvelle tâche';html=field('Nom de la tâche','title','text',t?.title||'','required maxlength="200"')+`<label>Description<textarea name="description">${esc(t?.description||'')}</textarea></label>`+field('Échéance','due_at','datetime-local',localInput(t?.due_at))+`<label>Responsable<select name="assignee"><option value="unassigned">Non attribué</option><option value="everyone">Les deux</option>${state.members.map(m=>`<option value="${m.user_id}" ${t?.assigned_user_id===m.user_id?'selected':''}>${esc(m.profiles?.display_name||'Membre')}</option>`).join('')}</select></label><label class="check-row"><input type="checkbox" name="notifications_enabled" ${t?.notifications_enabled?'checked':''}> Activer les notifications</label><p class="help">La réception en arrière-plan sera activée dans la phase Notifications.</p>`}
 if(mode==='event'){title='Nouvel événement';html=field('Titre','title','text','','required maxlength="200"')+field('Début','starts_at','datetime-local','','required')+field('Fin','ends_at','datetime-local')+field('Lieu','location')+`<label>Description<textarea name="description"></textarea></label>`}
 if(mode==='asset'){title='Nouvel équipement';html=`<label>Type<select name="asset_type"><option value="home">🏠 Maison</option><option value="vehicle">🚗 Véhicule</option></select></label>`+field('Nom','name','text','','required maxlength="200"')+field('Catégorie','category')+field('Marque','make')+field('Modèle','model')+field('Kilométrage actuel','current_mileage','number','','min="0"')+`<label>Notes<textarea name="notes"></textarea></label>`}
 if(mode==='plan'||mode==='editPlan'){
  const p=mode==='editPlan'
    ? state.plans.find(x=>x.id===id)
    : null;

  const assetId=p ? p.asset_id : id;

  title=p
    ? 'Modifier l’entretien'
    : 'Nouvel entretien';

  html=
    `<input type="hidden" name="asset_id" value="${assetId}">`
    +field(
      'Opération',
      'title',
      'text',
      p?.title||'',
      'required maxlength="200"'
    )
    +field(
      'Prochaine date',
      'next_due_at',
      'datetime-local',
      localInput(p?.next_due_at)
    )
    +field(
      'Prochain kilométrage',
      'next_due_mileage',
      'number',
      p?.next_due_mileage??'',
      'min="0"'
    )
    +field(
      'Intervalle en mois',
      'interval_months',
      'number',
      p?.interval_months??'',
      'min="1"'
    );
}
 $('#editor-title').textContent=title;$('#editor-fields').innerHTML=html;$('#editor-dialog').showModal();
}
async function saveEditor(fd){if(!state.household)return;const h=state.household.id,u=state.user.id;let res;
 if(editorMode==='task'){const ass=fd.get('assignee');const row={household_id:h,title:fd.get('title').trim(),description:fd.get('description')||null,due_at:fd.get('due_at')?new Date(fd.get('due_at')).toISOString():null,assignee_type:ass==='unassigned'?'unassigned':ass==='everyone'?'everyone':'member',assigned_user_id:!['unassigned','everyone'].includes(ass)?ass:null,notifications_enabled:fd.get('notifications_enabled')==='on',updated_by:u};if(editingId)res=await supabase.from('tasks').update(row).eq('id',editingId);else res=await supabase.from('tasks').insert({...row,created_by:u})}
 if(editorMode==='event')res=await supabase.from('events').insert({household_id:h,title:fd.get('title').trim(),description:fd.get('description')||null,location:fd.get('location')||null,starts_at:new Date(fd.get('starts_at')).toISOString(),ends_at:fd.get('ends_at')?new Date(fd.get('ends_at')).toISOString():null,created_by:u});
 if(editorMode==='asset')res=await supabase.from('assets').insert({household_id:h,asset_type:fd.get('asset_type'),name:fd.get('name').trim(),category:fd.get('category')||null,make:fd.get('make')||null,model:fd.get('model')||null,current_mileage:fd.get('current_mileage')?Number(fd.get('current_mileage')):null,notes:fd.get('notes')||null,created_by:u});
if(editorMode==='plan'||editorMode==='editPlan'){
  const row={
    household_id:h,
    asset_id:fd.get('asset_id'),
    title:fd.get('title').trim(),
    schedule_type:fd.get('next_due_mileage')
      ? 'date_or_mileage'
      : 'date',
    next_due_at:fd.get('next_due_at')
      ? new Date(fd.get('next_due_at')).toISOString()
      : null,
    next_due_mileage:fd.get('next_due_mileage')
      ? Number(fd.get('next_due_mileage'))
      : null,
    interval_months:fd.get('interval_months')
      ? Number(fd.get('interval_months'))
      : null,
    updated_by:u
  };

  if(editorMode==='editPlan'){
    res=await supabase
      .from('maintenance_plans')
      .update(row)
      .eq('id',editingId);
  }else{
    res=await supabase
      .from('maintenance_plans')
      .insert({
        ...row,
        created_by:u
      });
  }
}
 if(res?.error)throw res.error;toast('Enregistré');await loadData();
}

async function createInvitation(email){
  if(!state.household){
    toast('Aucun foyer actif');
    return;
  }

  const normalizedEmail=email
    .trim()
    .toLowerCase();

  if(!normalizedEmail){
    toast('Saisis une adresse e-mail');
    return;
  }

  setSync('Création de l’invitation…');

  const {data,error}=await supabase.rpc(
    'create_household_invitation',
    {
      requested_household_id:
        state.household.id,

      requested_email:
        normalizedEmail
    }
  );

  if(error){
    console.error(
      'Erreur création invitation',
      error
    );

    toast(
      'Impossible de créer l’invitation : '
      +error.message
    );

    setSync('Erreur');
    return;
  }

  const invitation=data?.[0];

  if(!invitation?.invitation_code){
    toast(
      'Le code d’invitation n’a pas été généré'
    );

    setSync('Erreur');
    return;
  }

  $('#generated-invitation-code')
    .textContent=
      invitation.invitation_code;

  $('#invitation-expiration')
    .textContent=
      'Valable jusqu’au '
      +dateText(invitation.expires_at);

  $('#invitation-result')
    .classList.remove('hidden');

  $('#invited-email').value=
    normalizedEmail;

  setSync('Synchronisé');

  toast('Code d’invitation créé');
}

async function acceptInvitation(
  code,
  displayName
){
  const normalizedCode=code
    .trim()
    .toLowerCase();

  const normalizedName=
    displayName.trim();

  if(!normalizedName){
    toast('Saisis ton nom d’affichage');
    return;
  }

  if(!normalizedCode){
    toast('Saisis le code d’invitation');
    return;
  }

  setSync('Vérification de l’invitation…');

  const {data,error}=await supabase.rpc(
    'accept_household_invitation',
    {
      requested_code:
        normalizedCode,

      requested_display_name:
        normalizedName
    }
  );

  if(error){
    console.error(
      'Erreur acceptation invitation',
      error
    );

    toast(
      'Impossible de rejoindre le foyer : '
      +error.message
    );

    setSync('Erreur');
    return;
  }

  const joinedHousehold=data?.[0];

  toast(
    joinedHousehold?.household_name
      ? 'Foyer rejoint : '
        +joinedHousehold.household_name
      : 'Foyer rejoint'
  );

  $('#invitation-code').value='';

  await loadContext();

  showScreen('home');

  setSync('Synchronisé');
}

async function deleteEvent(id){
  const event=state.events.find(
    item=>item.id===id
  );

  if(!event){
    toast('Événement introuvable');
    return;
  }

  const confirmed=confirm(
    `Supprimer l’événement « ${event.title} » ?`
  );

  if(!confirmed){
    return;
  }

  setSync('Suppression…');

  const {data,error}=await supabase
    .from('events')
    .update({
      deleted_at:new Date().toISOString(),
      deleted_by:state.user.id,
      updated_by:state.user.id
    })
    .eq('id',id)
    .select('id')
    .maybeSingle();

  if(error){
    console.error(
      'Erreur suppression événement',
      error
    );

    toast(
      'Impossible de supprimer l’événement : '
      +error.message
    );

    setSync('Erreur');
    return;
  }

  if(!data){
    toast(
      'Suppression refusée. '
      +'Seul le créateur ou un administrateur peut supprimer cet événement.'
    );

    setSync('Synchronisé');
    return;
  }

  toast('Événement supprimé');

  await loadData();

  setSync('Synchronisé');
}
async function completeTask(id){const {error}=await supabase.from('tasks').update({status:'completed',completed_at:new Date().toISOString(),completed_by:state.user.id,updated_by:state.user.id,next_reminder_at:null}).eq('id',id);if(error)toast(error.message);else{toast('Tâche terminée');await loadData()}}
async function trashTask(id){if(!confirm('Supprimer cette tâche et arrêter ses futurs rappels ?'))return;const {error}=await supabase.from('tasks').update({deleted_at:new Date().toISOString(),deleted_by:state.user.id,next_reminder_at:null,updated_by:state.user.id}).eq('id',id);if(error)toast(error.message);else await loadData()}
async function restoreTask(id){const {error}=await supabase.from('tasks').update({deleted_at:null,deleted_by:null,updated_by:state.user.id}).eq('id',id);if(error)toast(error.message);else await loadData()}
async function deletePlan(id){
  const plan=state.plans.find(
    item=>item.id===id
  );

  if(!plan){
    toast('Entretien introuvable');
    return;
  }

  const interventions=state.records.filter(
    record=>record.maintenance_plan_id===id
  ).length;

  let message=
    `Supprimer l’entretien planifié `
    +`« ${plan.title} » ?`;

  if(interventions>0){
    message+=
      `\n\nLes ${interventions} intervention(s) `
      +`déjà réalisée(s) seront conservée(s) `
      +`dans l’historique.`;
  }

  const confirmed=confirm(message);

  if(!confirmed){
    return;
  }

  setSync('Suppression…');

  const {data,error}=await supabase
    .from('maintenance_plans')
    .update({
      deleted_at:new Date().toISOString(),
      deleted_by:state.user.id,
      active:false,
      notifications_enabled:false,
      next_reminder_at:null,
      updated_by:state.user.id
    })
    .eq('id',id)
    .select('id')
    .maybeSingle();

  if(error){
    console.error(
      'Erreur suppression entretien',
      error
    );

    toast(
      'Impossible de supprimer l’entretien : '
      +error.message
    );

    setSync('Erreur');
    return;
  }

  if(!data){
    toast(
      'Suppression refusée. '
      +'Seul le créateur ou un administrateur peut supprimer cet entretien.'
    );

    setSync('Synchronisé');
    return;
  }

  toast('Entretien planifié supprimé');

  await loadData();

  setSync('Synchronisé');
}
async function completePlan(id){
  const plan=state.plans.find(item=>item.id===id);

  if(!plan){
    toast('Entretien introuvable');
    return;
  }

  let mileage=null;

  if(
    plan.schedule_type==='mileage'
    || plan.schedule_type==='date_or_mileage'
    || plan.next_due_mileage!==null
  ){
    const entered=prompt(
      'Kilométrage lors de l’entretien '
      +'(laisser vide si non applicable)'
    );

    if(entered===null){
      return;
    }

    if(entered.trim()!==''){
      mileage=Number(entered);

      if(!Number.isInteger(mileage)||mileage<0){
        toast('Le kilométrage saisi est incorrect');
        return;
      }
    }
  }else{
    const confirmed=confirm(
      `Confirmer que l’entretien « ${plan.title} » `
      +'a été effectué aujourd’hui ?'
    );

    if(!confirmed){
      return;
    }
  }

  setSync('Enregistrement…');

  const {data,error}=await supabase.rpc(
    'complete_maintenance_plan',
    {
      requested_plan_id:id,
      performed_mileage:mileage
    }
  );

  if(error){
    console.error(
      'Erreur complete_maintenance_plan',
      error
    );

    toast(
      'Impossible d’enregistrer l’entretien : '
      +error.message
    );

    setSync('Erreur');
    return;
  }

  const result=data?.[0];

  await loadData();

  setSync('Synchronisé');

  if(result?.new_due_at){
    toast(
      'Entretien enregistré. Prochaine échéance : '
      +dateText(result.new_due_at)
    );
  }else{
    toast(
      'Entretien enregistré. '
      +'Aucune périodicité définie.'
    );
  }
}

function bindUI(){
  $('#onboarding-create-tab')
    ?.addEventListener(
      'click',
      showCreateHousehold
    );

  $('#onboarding-join-tab')
    ?.addEventListener(
      'click',
      showJoinHousehold
    );

 $('#invitation-form')
  ?.addEventListener(
    'submit',
    async event=>{
      event.preventDefault();

      const email=
        $('#invited-email').value;

      await createInvitation(email);
    }
  );

$('#join-household-form')
  ?.addEventListener(
    'submit',
    async event=>{
      event.preventDefault();

      const displayName=
        $('#join-display-name').value;

      const code=
        $('#invitation-code').value;

      await acceptInvitation(
        code,
        displayName
      );
    }
  );
 
$('#copy-invitation-code')
  ?.addEventListener(
    'click',
    async ()=>{
      const code=
        $('#generated-invitation-code')
          .textContent
          .trim();

      if(!code){
        toast('Aucun code à copier');
        return;
      }

      try{
        await navigator.clipboard
          .writeText(code);

        toast('Code copié');
      }catch(error){
        console.error(
          'Erreur copie code',
          error
        );

        toast(
          'Copie impossible. '
          +'Sélectionne le code manuellement.'
        );
      }
    }
  );
 
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
 document.addEventListener('click',e=>{
  const b=e.target.closest('button');

  if(!b){
    return;
  }

  if(b.dataset.complete){
    completeTask(b.dataset.complete);
  }

  if(b.dataset.editTask){
    openEditor(
      'task',
      b.dataset.editTask
    );
  }

  if(b.dataset.trashTask){
    trashTask(b.dataset.trashTask);
  }

  if(b.dataset.restoreTask){
    restoreTask(b.dataset.restoreTask);
  }

  if(b.dataset.deleteEvent){
    deleteEvent(b.dataset.deleteEvent);
  }

  if(b.dataset.addPlan){
    openEditor(
      'plan',
      b.dataset.addPlan
    );
  }

  if(b.dataset.editPlan){
    openEditor(
      'editPlan',
      b.dataset.editPlan
    );
  }

  if(b.dataset.donePlan){
    completePlan(b.dataset.donePlan);
  }

  if(b.dataset.deletePlan){
    deletePlan(b.dataset.deletePlan);
  }

  if(b.dataset.go){
    showScreen(b.dataset.go);
  }

  if(b.dataset.taskFilter){
    state.taskFilter=b.dataset.taskFilter;

    $$('[data-task-filter]').forEach(item=>{
      item.classList.toggle(
        'active',
        item===b
      );
    });

    renderTasks();
  }

  if(b.dataset.assetFilter){
    state.assetFilter=b.dataset.assetFilter;

    $$('[data-asset-filter]').forEach(item=>{
      item.classList.toggle(
        'active',
        item===b
      );
    });

    renderAssets();
  }

  if(b.dataset.homeFilter){
    showScreen('agenda');
  }
});
 window.addEventListener('online',()=>setSync('Synchronisé'));window.addEventListener('offline',()=>setSync('Hors connexion'));
}
function setAuthMode(v){signupMode=v;$('#tab-login').classList.toggle('active',!v);$('#tab-signup').classList.toggle('active',v);$('#auth-submit').textContent=v?'Créer mon compte':'Se connecter';$('#password-help').classList.toggle('hidden',!v);$('#auth-password').autocomplete=v?'new-password':'current-password'}
init();
