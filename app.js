import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let state = {
  session: null, user: null, profile: null, household: null,
  members: [], tasks: [], events: [], assets: [], plans: [], records: [],
  taskFilter: "active", assetFilter: "all", channels: []
};
let signupMode = false;
let editorMode = null;
let editingId = null;

function toast(message) {
  const element = $("#toast");
  if (!element) return;
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 3000);
}

function esc(value = "") {
  return String(value).replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));
}

function localInput(dateValue) {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function weekEnd() {
  const date = new Date();
  const day = date.getDay() || 7;
  date.setDate(date.getDate() + (7 - day));
  date.setHours(23, 59, 59, 999);
  return date;
}

function startOfToday() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function endOfToday() { const d = new Date(); d.setHours(23,59,59,999); return d; }
function activeTask(task) { return !task.deleted_at && task.status === "open"; }
function taskIcon() { return "✅"; }
function empty(text) { return `<div class="empty">${esc(text)}</div>`; }

function statusClass(dateValue, done = false, noDate = false) {
  if (done) return "status-green";
  if (noDate || !dateValue) return "status-gray";
  const date = new Date(dateValue);
  if (date < new Date()) return "status-red";
  if (date <= weekEnd()) return "status-orange";
  return "status-blue";
}

function dateText(value, allDay = false) {
  if (!value) return "Sans échéance";
  const date = new Date(value);
  return date.toLocaleString("fr-FR", allDay
    ? { dateStyle: "medium" }
    : { dateStyle: "medium", timeStyle: "short" });
}

async function init() {
  bindUI();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
  }
  const { data: { session } } = await supabase.auth.getSession();
  await handleSession(session);
  supabase.auth.onAuthStateChange((_event, newSession) => {
    setTimeout(() => handleSession(newSession), 0);
  });
}

async function handleSession(session) {
  state.session = session;
  state.user = session?.user || null;
  $("#auth-view")?.classList.toggle("hidden", !!session);
  $("#app-view")?.classList.toggle("hidden", !session);
  if (!session) return;
  if ($("#account-email")) $("#account-email").textContent = session.user.email || "";
  await loadContext();
}

async function loadContext() {
  setSync("Synchronisation…");
  const uid = state.user.id;
  const [{ data: profile }, { data: members, error }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
    supabase.from("household_members").select("household_id,role,households(*)").eq("user_id", uid)
  ]);
  if (error) { toast(error.message); setSync("Erreur"); return; }
  state.profile = profile;
  state.household = members?.[0]?.households || null;
  $("#onboarding")?.classList.toggle("hidden", !!state.household);
  if ($("#settings-household")) $("#settings-household").textContent = state.household?.name || "Non configuré";
  $("#household-invitation-section")?.classList.toggle("hidden", !state.household);
  if (!state.household) { renderAll(); setSync("Synchronisé"); return; }
  await loadData();
  subscribeRealtime();
  setSync("Synchronisé");
}

async function loadData() {
  const householdId = state.household.id;
  const results = await Promise.all([
    supabase.from("household_members").select("*,profiles(*)").eq("household_id", householdId),
    supabase.from("tasks").select("*").eq("household_id", householdId).order("due_at", { ascending: true, nullsFirst: false }),
    supabase.from("events").select("*").eq("household_id", householdId).is("deleted_at", null).order("starts_at"),
    supabase.from("assets").select("*").eq("household_id", householdId).is("deleted_at", null).order("name"),
    supabase.from("maintenance_plans").select("*").eq("household_id", householdId).is("deleted_at", null).order("next_due_at", { ascending: true, nullsFirst: false }),
    supabase.from("maintenance_records").select("*").eq("household_id", householdId).order("performed_at", { ascending: false })
  ]);
  const error = results.find(result => result.error)?.error;
  if (error) { toast(error.message); return; }
  [state.members, state.tasks, state.events, state.assets, state.plans, state.records] = results.map(result => result.data || []);
  renderAll();
}

function subscribeRealtime() {
  state.channels.forEach(channel => supabase.removeChannel(channel));
  state.channels = [];
  if (!state.household) return;
  ["tasks", "events", "assets", "maintenance_plans", "maintenance_records", "household_members"].forEach(table => {
    const channel = supabase.channel(`${table}-${state.household.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table, filter: `household_id=eq.${state.household.id}` }, () => loadData())
      .subscribe();
    state.channels.push(channel);
  });
}

function setSync(value) { if ($("#sync-state")) $("#sync-state").textContent = value; }
function showCreateHousehold() { $("#profile-household-form")?.classList.remove("hidden"); $("#join-household-form")?.classList.add("hidden"); $("#onboarding-create-tab")?.classList.add("active"); $("#onboarding-join-tab")?.classList.remove("active"); }
function showJoinHousehold() { $("#profile-household-form")?.classList.add("hidden"); $("#join-household-form")?.classList.remove("hidden"); $("#onboarding-create-tab")?.classList.remove("active"); $("#onboarding-join-tab")?.classList.add("active"); }

function renderAll() {
  const name = state.profile?.display_name?.split(" ")[0] || "";
  if ($("#hello-label")) $("#hello-label").textContent = `Bonjour${name ? " " + name : ""}`;
  if ($("#today-label")) $("#today-label").textContent = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  renderDashboard(); renderTasks(); renderAgenda(); renderAssets();
}

function unified() {
  const list = [];
  state.tasks.filter(activeTask).forEach(task => list.push({ kind: "task", icon: "✅", title: task.title, date: task.due_at, data: task }));
  state.events.forEach(event => list.push({ kind: "event", icon: "📅", title: event.title, date: event.starts_at, data: event }));
  state.plans.filter(plan => plan.active).forEach(plan => {
    const asset = state.assets.find(item => item.id === plan.asset_id);
    list.push({ kind: "plan", icon: asset?.asset_type === "vehicle" ? "🚗" : "🏠", title: plan.title, date: plan.next_due_at, data: plan });
  });
  return list.sort((a,b) => (a.date ? new Date(a.date) : Infinity) - (b.date ? new Date(b.date) : Infinity));
}

function renderDashboard() {
  const items = unified(), start = startOfToday(), end = endOfToday(), week = weekEnd();
  const overdue = items.filter(item => item.date && new Date(item.date) < start);
  const today = items.filter(item => item.date && new Date(item.date) >= start && new Date(item.date) <= end);
  const thisWeek = items.filter(item => item.date && new Date(item.date) > end && new Date(item.date) <= week);
  if ($("#count-overdue")) $("#count-overdue").textContent = overdue.length;
  if ($("#count-today")) $("#count-today").textContent = today.length;
  if ($("#count-week")) $("#count-week").textContent = today.length + thisWeek.length;
  if ($("#priority-list")) $("#priority-list").innerHTML = overdue.slice(0,4).map(itemHTML).join("") || empty("Aucune action en retard.");
  if ($("#today-list")) $("#today-list").innerHTML = today.slice(0,4).map(itemHTML).join("") || empty("Rien de prévu aujourd’hui.");
  if ($("#week-list")) $("#week-list").innerHTML = thisWeek.slice(0,5).map(itemHTML).join("") || empty("Aucune autre action cette semaine.");
}

function recurrenceText(task) {
  if (!task?.recurrence_enabled || !task?.recurrence_rule) return "";
  const frequency = task.recurrence_rule.frequency;
  const interval = Number(task.recurrence_rule.interval) || 1;
  if (interval === 1) return ({ daily: "Tous les jours", weekly: "Toutes les semaines", monthly: "Tous les mois", yearly: "Tous les ans" })[frequency] || "";
  return `Tous les ${interval} ${{ daily: "jours", weekly: "semaines", monthly: "mois", yearly: "ans" }[frequency] || ""}`;
}

function itemHTML(item, allowManage = false) {
  const done = item.kind === "task" && item.data.status === "completed";
  let actions = "";
  if (item.kind === "task") actions = `<div class="item-actions"><button class="mini" data-complete="${item.data.id}" type="button">Terminer</button><button class="mini" data-edit-task="${item.data.id}" type="button">Modifier</button></div>`;
  if (item.kind === "event" && allowManage) actions = `<div class="item-actions"><button class="mini" data-delete-event="${item.data.id}" type="button">Supprimer</button></div>`;
  return `<article class="item"><span class="item-icon">${item.icon}</span><div><div class="item-title ${statusClass(item.date, done, !item.date)}">${esc(item.title)}</div><div class="item-meta">${dateText(item.date)}${item.kind === "task" && item.data.recurrence_enabled ? " · 🔁 " + recurrenceText(item.data) : ""}</div></div>${actions}</article>`;
}

function renderTasks() {
  let list = state.tasks;
  if (state.taskFilter === "active") list = list.filter(activeTask);
  if (state.taskFilter === "completed") list = list.filter(task => task.status === "completed" && !task.deleted_at);
  if (state.taskFilter === "trash") list = list.filter(task => task.deleted_at);
  if (state.taskFilter === "all") list = list.filter(task => !task.deleted_at);
  if (!$("#tasks-list")) return;
  $("#tasks-list").innerHTML = list.length ? list.map(task => `<article class="item"><span class="item-icon">${taskIcon()}</span><div><div class="item-title ${statusClass(task.due_at, task.status === "completed", !task.due_at)}">${esc(task.title)}</div><div class="item-meta">${dateText(task.due_at)} · ${task.status === "completed" ? "Terminée" : "À faire"}${task.recurrence_enabled ? " · 🔁 " + recurrenceText(task) : ""}</div></div><div class="item-actions">${activeTask(task) ? `<button class="mini" data-complete="${task.id}" type="button">Terminer</button><button class="mini" data-edit-task="${task.id}" type="button">Modifier</button><button class="mini" data-trash-task="${task.id}" type="button">Supprimer</button>` : ""}${task.deleted_at ? `<button class="mini" data-restore-task="${task.id}" type="button">Restaurer</button>` : ""}</div></article>`).join("") : empty("Aucune tâche dans cette vue.");
}

function renderAgenda() { const items = unified(); if ($("#agenda-list")) $("#agenda-list").innerHTML = items.length ? items.map(item => itemHTML(item, true)).join("") : empty("Aucun élément dans l’agenda."); }

function renderAssets() {
  let assets = state.assets;
  if (state.assetFilter !== "all") assets = assets.filter(asset => asset.asset_type === state.assetFilter);
  if (!$("#assets-list")) return;
  $("#assets-list").innerHTML = assets.length ? assets.map(asset => {
    const plans = state.plans.filter(plan => plan.asset_id === asset.id && !plan.deleted_at);
    const recordsCount = state.records.filter(record => record.asset_id === asset.id).length;
    return `<article class="item"><span class="item-icon">${asset.asset_type === "vehicle" ? "🚗" : "🏠"}</span><div><div class="item-title">${esc(asset.name)}</div><div class="item-meta">${esc(asset.category || "Sans catégorie")} · ${plans.length} entretien(s) planifié(s) · ${recordsCount} intervention(s) réalisée(s)</div></div><div class="item-actions"><button class="mini" data-add-plan="${asset.id}" type="button">＋ Entretien</button></div></article>${plans.map(plan => `<article class="item"><span class="item-icon">🔧</span><div><div class="item-title ${statusClass(plan.next_due_at, false, !plan.next_due_at)}">${esc(plan.title)}</div><div class="item-meta">${dateText(plan.next_due_at)}${plan.next_due_mileage != null ? " · " + plan.next_due_mileage + " km" : ""}${plan.interval_months ? " · tous les " + plan.interval_months + " mois" : ""}${plan.interval_mileage ? " · tous les " + plan.interval_mileage + " km" : ""}</div></div><div class="item-actions"><button class="mini" data-edit-plan="${plan.id}" type="button">Modifier</button><button class="mini" data-done-plan="${plan.id}" type="button">Effectué</button><button class="mini" data-delete-plan="${plan.id}" type="button">Supprimer</button></div></article>`).join("")}`;
  }).join("") : empty("Aucun équipement enregistré.");
}

function showScreen(name) { $$(".screen").forEach(screen => screen.classList.add("hidden")); $(`#screen-${name}`)?.classList.remove("hidden"); $$(".nav-btn").forEach(button => button.classList.toggle("active", button.dataset.screen === name)); window.scrollTo({ top: 0, behavior: "smooth" }); }
function field(label, name, type = "text", value = "", extra = "") { return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`; }

function updateRecurrenceSummary() {
  const enabled = $("#recurrence-enabled"), options = $("#recurrence-options"), summary = $("#recurrence-summary");
  if (!enabled || !options || !summary) return;
  options.classList.toggle("hidden", !enabled.checked);
  if (!enabled.checked) { summary.textContent = ""; return; }
  const frequency = document.querySelector('[name="recurrence_frequency"]')?.value || "weekly";
  const interval = Math.max(1, Number(document.querySelector('[name="recurrence_interval"]')?.value) || 1);
  if (interval === 1) summary.textContent = ({ daily: "Tous les jours", weekly: "Toutes les semaines", monthly: "Tous les mois", yearly: "Tous les ans" })[frequency];
  else summary.textContent = `Tous les ${interval} ${{ daily: "jours", weekly: "semaines", monthly: "mois", yearly: "ans" }[frequency]}`;
}

function openEditor(mode, id = null) {
  editorMode = mode; editingId = id; let html = "", title = "Ajouter";
  if (mode === "task") {
    const task = state.tasks.find(item => item.id === id);
    const rule = task?.recurrence_rule || {};
    const frequency = rule.frequency || "weekly";
    const interval = Number(rule.interval) || 1;
    title = task ? "Modifier la tâche" : "Nouvelle tâche";
    html = field("Nom de la tâche", "title", "text", task?.title || "", 'required maxlength="200"')
      + `<label>Description<textarea name="description">${esc(task?.description || "")}</textarea></label>`
      + field("Échéance", "due_at", "datetime-local", localInput(task?.due_at))
      + `<label>Responsable<select name="assignee"><option value="unassigned" ${task?.assignee_type === "unassigned" ? "selected" : ""}>Non attribué</option><option value="everyone" ${task?.assignee_type === "everyone" ? "selected" : ""}>Les deux</option>${state.members.map(member => `<option value="${member.user_id}" ${task?.assigned_user_id === member.user_id ? "selected" : ""}>${esc(member.profiles?.display_name || "Membre")}</option>`).join("")}</select></label>`
      + `<section class="panel recurrence-panel"><label class="check-row"><input id="recurrence-enabled" type="checkbox" name="recurrence_enabled" ${task?.recurrence_enabled ? "checked" : ""}> Tâche récurrente</label><div id="recurrence-options" class="${task?.recurrence_enabled ? "" : "hidden"}"><label>Fréquence<select name="recurrence_frequency"><option value="daily" ${frequency === "daily" ? "selected" : ""}>Jour</option><option value="weekly" ${frequency === "weekly" ? "selected" : ""}>Semaine</option><option value="monthly" ${frequency === "monthly" ? "selected" : ""}>Mois</option><option value="yearly" ${frequency === "yearly" ? "selected" : ""}>Année</option></select></label><label>Répéter tous les<input name="recurrence_interval" type="number" min="1" max="365" value="${interval}"></label><p id="recurrence-summary" class="help"></p></div></section>`
      + `<label class="check-row"><input type="checkbox" name="notifications_enabled" ${task?.notifications_enabled ? "checked" : ""}> Activer les notifications</label><p class="help">Les notifications en arrière-plan seront activées dans la phase Notifications.</p>`;
  }
  if (mode === "event") { title = "Nouvel événement"; html = field("Titre", "title", "text", "", 'required maxlength="200"') + field("Début", "starts_at", "datetime-local", "", "required") + field("Fin", "ends_at", "datetime-local") + field("Lieu", "location") + `<label>Description<textarea name="description"></textarea></label>`; }
  if (mode === "asset") { title = "Nouvel équipement"; html = `<label>Type<select name="asset_type"><option value="home">🏠 Maison</option><option value="vehicle">🚗 Véhicule</option></select></label>` + field("Nom", "name", "text", "", 'required maxlength="200"') + field("Catégorie", "category") + field("Marque", "make") + field("Modèle", "model") + field("Kilométrage actuel", "current_mileage", "number", "", 'min="0"') + `<label>Notes<textarea name="notes"></textarea></label>`; }
  if (mode === "plan" || mode === "editPlan") { const plan = mode === "editPlan" ? state.plans.find(item => item.id === id) : null; const assetId = plan ? plan.asset_id : id; title = plan ? "Modifier l’entretien" : "Nouvel entretien"; html = `<input type="hidden" name="asset_id" value="${assetId}">` + field("Opération", "title", "text", plan?.title || "", 'required maxlength="200"') + field("Prochaine date", "next_due_at", "datetime-local", localInput(plan?.next_due_at)) + field("Prochain kilométrage", "next_due_mileage", "number", plan?.next_due_mileage ?? "", 'min="0"') + field("Intervalle en mois", "interval_months", "number", plan?.interval_months ?? "", 'min="1"'); }
  $("#editor-title").textContent = title;
  $("#editor-fields").innerHTML = html;
  $("#editor-dialog").showModal();
  if (mode === "task") {
    $("#recurrence-enabled")?.addEventListener("change", updateRecurrenceSummary);
    document.querySelector('[name="recurrence_frequency"]')?.addEventListener("change", updateRecurrenceSummary);
    document.querySelector('[name="recurrence_interval"]')?.addEventListener("input", updateRecurrenceSummary);
    updateRecurrenceSummary();
  }
}

async function saveEditor(formData) {
  if (!state.household) return;
  const householdId = state.household.id, userId = state.user.id;
  let result;
  if (editorMode === "task") {
    const assignee = formData.get("assignee");
    const recurrenceEnabled = formData.get("recurrence_enabled") === "on";
    const frequency = formData.get("recurrence_frequency") || "weekly";
    const interval = Math.max(1, Math.min(365, Number(formData.get("recurrence_interval")) || 1));
    const dueAtValue = formData.get("due_at");
    if (recurrenceEnabled && !dueAtValue) throw new Error("Une tâche récurrente doit avoir une échéance.");
    if (recurrenceEnabled && !["daily","weekly","monthly","yearly"].includes(frequency)) throw new Error("La fréquence choisie est incorrecte.");
    const row = {
      household_id: householdId,
      title: formData.get("title").trim(),
      description: formData.get("description") || null,
      due_at: dueAtValue ? new Date(dueAtValue).toISOString() : null,
      assignee_type: assignee === "unassigned" ? "unassigned" : assignee === "everyone" ? "everyone" : "member",
      assigned_user_id: !["unassigned","everyone"].includes(assignee) ? assignee : null,
      recurrence_enabled: recurrenceEnabled,
      recurrence_rule: recurrenceEnabled ? { frequency, interval } : null,
      notifications_enabled: formData.get("notifications_enabled") === "on",
      updated_by: userId
    };
    result = editingId ? await supabase.from("tasks").update(row).eq("id", editingId) : await supabase.from("tasks").insert({ ...row, created_by: userId });
  }
  if (editorMode === "event") result = await supabase.from("events").insert({ household_id: householdId, title: formData.get("title").trim(), description: formData.get("description") || null, location: formData.get("location") || null, starts_at: new Date(formData.get("starts_at")).toISOString(), ends_at: formData.get("ends_at") ? new Date(formData.get("ends_at")).toISOString() : null, created_by: userId });
  if (editorMode === "asset") result = await supabase.from("assets").insert({ household_id: householdId, asset_type: formData.get("asset_type"), name: formData.get("name").trim(), category: formData.get("category") || null, make: formData.get("make") || null, model: formData.get("model") || null, current_mileage: formData.get("current_mileage") ? Number(formData.get("current_mileage")) : null, notes: formData.get("notes") || null, created_by: userId });
  if (editorMode === "plan" || editorMode === "editPlan") {
    const row = { household_id: householdId, asset_id: formData.get("asset_id"), title: formData.get("title").trim(), schedule_type: formData.get("next_due_mileage") ? "date_or_mileage" : "date", next_due_at: formData.get("next_due_at") ? new Date(formData.get("next_due_at")).toISOString() : null, next_due_mileage: formData.get("next_due_mileage") ? Number(formData.get("next_due_mileage")) : null, interval_months: formData.get("interval_months") ? Number(formData.get("interval_months")) : null, updated_by: userId };
    result = editorMode === "editPlan" ? await supabase.from("maintenance_plans").update(row).eq("id", editingId) : await supabase.from("maintenance_plans").insert({ ...row, created_by: userId });
  }
  if (result?.error) throw result.error;
  toast("Enregistré");
  await loadData();
}

async function completeTask(id) {
  const task = state.tasks.find(item => item.id === id);
  if (!task) { toast("Tâche introuvable"); return; }
  const message = task.recurrence_enabled ? `Terminer « ${task.title} » ?\n\nLa prochaine occurrence sera créée automatiquement.` : `Terminer « ${task.title} » ?`;
  if (!confirm(message)) return;
  setSync("Enregistrement…");
  const { data, error } = await supabase.rpc("complete_task", { requested_task_id: id });
  if (error) { console.error("Erreur complete_task", error); toast("Impossible de terminer la tâche : " + error.message); setSync("Erreur"); return; }
  const result = data?.[0];
  await loadData();
  setSync("Synchronisé");
  toast(result?.next_occurrence_created ? "Tâche terminée. Prochaine occurrence : " + dateText(result.next_due_at) : "Tâche terminée");
}

async function createInvitation(email) { if (!state.household) return toast("Aucun foyer actif"); const normalizedEmail = email.trim().toLowerCase(); if (!normalizedEmail) return toast("Saisis une adresse e-mail"); setSync("Création de l’invitation…"); const { data, error } = await supabase.rpc("create_household_invitation", { requested_household_id: state.household.id, requested_email: normalizedEmail }); if (error) { toast("Impossible de créer l’invitation : " + error.message); setSync("Erreur"); return; } const invitation = data?.[0]; if (!invitation?.invitation_code) return toast("Le code d’invitation n’a pas été généré"); $("#generated-invitation-code").textContent = invitation.invitation_code; $("#invitation-expiration").textContent = "Valable jusqu’au " + dateText(invitation.expires_at); $("#invitation-result").classList.remove("hidden"); $("#invited-email").value = normalizedEmail; setSync("Synchronisé"); toast("Code d’invitation créé"); }
async function acceptInvitation(code, displayName) { const normalizedCode = code.trim().toLowerCase(), normalizedName = displayName.trim(); if (!normalizedName) return toast("Saisis ton nom d’affichage"); if (!normalizedCode) return toast("Saisis le code d’invitation"); setSync("Vérification de l’invitation…"); const { data, error } = await supabase.rpc("accept_household_invitation", { requested_code: normalizedCode, requested_display_name: normalizedName }); if (error) { toast("Impossible de rejoindre le foyer : " + error.message); setSync("Erreur"); return; } toast(data?.[0]?.household_name ? "Foyer rejoint : " + data[0].household_name : "Foyer rejoint"); $("#invitation-code").value = ""; await loadContext(); showScreen("home"); setSync("Synchronisé"); }

async function deleteEvent(id) { const event = state.events.find(item => item.id === id); if (!event || !confirm(`Supprimer l’événement « ${event.title} » ?`)) return; const { data, error } = await supabase.from("events").update({ deleted_at: new Date().toISOString(), deleted_by: state.user.id, updated_by: state.user.id }).eq("id", id).select("id").maybeSingle(); if (error || !data) return toast(error ? error.message : "Suppression refusée"); toast("Événement supprimé"); await loadData(); }
async function trashTask(id){
  const task=state.tasks.find(
    item=>item.id===id
  );

  if(!task){
    toast('Tâche introuvable');
    return;
  }

  if(!task.recurrence_enabled){
    const confirmed=confirm(
      `Supprimer la tâche « ${task.title} » ?`
    );

    if(!confirmed){
      return;
    }

    setSync('Suppression…');

    const {error}=await supabase
      .from('tasks')
      .update({
        deleted_at:
          new Date().toISOString(),

        deleted_by:
          state.user.id,

        next_reminder_at:null,
        snoozed_until:null,
        notifications_enabled:false,
        updated_by:state.user.id
      })
      .eq('id',id);

    if(error){
      console.error(
        'Erreur suppression tâche',
        error
      );

      toast(
        'Impossible de supprimer la tâche : '
        +error.message
      );

      setSync('Erreur');
      return;
    }

    toast('Tâche placée dans la corbeille');

    await loadData();

    setSync('Synchronisé');
    return;
  }

  const choice=prompt(
    `Que veux-tu supprimer pour « ${task.title} » ?\n\n`
    +'1 = Cette occurrence uniquement\n'
    +'2 = Cette occurrence et toutes les suivantes\n'
    +'0 = Annuler\n\n'
    +'Saisis 1, 2 ou 0 :'
  );

  if(
    choice===null
    || choice.trim()===''
    || choice.trim()==='0'
  ){
    return;
  }

  let scope;

  if(choice.trim()==='1'){
    scope='occurrence';
  }else if(choice.trim()==='2'){
    scope='future';
  }else{
    toast('Choisis 1, 2 ou 0');
    return;
  }

  if(scope==='future'){
    const confirmed=confirm(
      'Confirmer l’arrêt de cette série ?\n\n'
      +'Cette occurrence et toutes les suivantes '
      +'seront placées dans la corbeille.\n\n'
      +'Les occurrences déjà terminées resteront '
      +'dans l’historique.'
    );

    if(!confirmed){
      return;
    }
  }

  setSync('Suppression…');

  const {data,error}=await supabase.rpc(
    'delete_recurring_task',
    {
      requested_task_id:id,
      requested_scope:scope
    }
  );

  if(error){
    console.error(
      'Erreur delete_recurring_task',
      error
    );

    toast(
      'Impossible de supprimer la tâche : '
      +error.message
    );

    setSync('Erreur');
    return;
  }

  const result=data?.[0];

  await loadData();

  setSync('Synchronisé');

  if(scope==='occurrence'){
    toast(
      'Occurrence placée dans la corbeille'
    );
  }else{
    toast(
      result?.affected_count>1
        ? `${result.affected_count} occurrences supprimées`
        : 'Série récurrente arrêtée'
    );
  }
}
async function restoreTask(id){
  const task=state.tasks.find(
    item=>item.id===id
  );

  if(!task){
    toast('Tâche introuvable');
    return;
  }

  const confirmed=confirm(
    task.recurrence_enabled
      ? 'Restaurer uniquement cette occurrence ?'
      : `Restaurer la tâche « ${task.title} » ?`
  );

  if(!confirmed){
    return;
  }

  setSync('Restauration…');

  const {data,error}=await supabase
    .from('tasks')
    .update({
      deleted_at:null,
      deleted_by:null,
      notifications_enabled:false,
      next_reminder_at:null,
      updated_by:state.user.id
    })
    .eq('id',id)
    .select('id')
    .maybeSingle();

  if(error){
    console.error(
      'Erreur restauration tâche',
      error
    );

    toast(
      'Impossible de restaurer la tâche : '
      +error.message
    );

    setSync('Erreur');
    return;
  }

  if(!data){
    toast('Restauration refusée');
    setSync('Synchronisé');
    return;
  }

  toast('Occurrence restaurée');

  await loadData();

  setSync('Synchronisé');
}
async function deletePlan(id) { const plan = state.plans.find(item => item.id === id); if (!plan || !confirm(`Supprimer l’entretien planifié « ${plan.title} » ?`)) return; const { data, error } = await supabase.from("maintenance_plans").update({ deleted_at: new Date().toISOString(), deleted_by: state.user.id, active: false, notifications_enabled: false, next_reminder_at: null, updated_by: state.user.id }).eq("id", id).select("id").maybeSingle(); if (error || !data) return toast(error ? error.message : "Suppression refusée"); toast("Entretien planifié supprimé"); await loadData(); }

async function completePlan(id) {
  const plan = state.plans.find(item => item.id === id);
  if (!plan) return toast("Entretien introuvable");
  let mileage = null;
  if (plan.schedule_type === "mileage" || plan.schedule_type === "date_or_mileage" || plan.next_due_mileage !== null) {
    const entered = prompt("Kilométrage lors de l’entretien (laisser vide si non applicable)");
    if (entered === null) return;
    if (entered.trim() !== "") { mileage = Number(entered); if (!Number.isInteger(mileage) || mileage < 0) return toast("Le kilométrage saisi est incorrect"); }
  } else if (!confirm(`Confirmer que l’entretien « ${plan.title} » a été effectué aujourd’hui ?`)) return;
  const { data, error } = await supabase.rpc("complete_maintenance_plan", { requested_plan_id: id, performed_mileage: mileage });
  if (error) return toast("Impossible d’enregistrer l’entretien : " + error.message);
  await loadData();
  toast(data?.[0]?.new_due_at ? "Entretien enregistré. Prochaine échéance : " + dateText(data[0].new_due_at) : "Entretien enregistré.");
}

function bindUI() {
  $("#onboarding-create-tab")?.addEventListener("click", showCreateHousehold);
  $("#onboarding-join-tab")?.addEventListener("click", showJoinHousehold);
  $("#invitation-form")?.addEventListener("submit", async event => { event.preventDefault(); await createInvitation($("#invited-email").value); });
  $("#join-household-form")?.addEventListener("submit", async event => { event.preventDefault(); await acceptInvitation($("#invitation-code").value, $("#join-display-name").value); });
  $("#copy-invitation-code")?.addEventListener("click", async () => { const code = $("#generated-invitation-code").textContent.trim(); if (!code) return toast("Aucun code à copier"); try { await navigator.clipboard.writeText(code); toast("Code copié"); } catch { toast("Copie impossible. Sélectionne le code manuellement."); } });
  $("#tab-login").onclick = () => setAuthMode(false);
  $("#tab-signup").onclick = () => setAuthMode(true);
  $("#auth-form").addEventListener("submit", async event => { event.preventDefault(); const email = $("#auth-email").value.trim(), password = $("#auth-password").value; $("#auth-submit").disabled = true; const { error } = signupMode ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split("#")[0] } }) : await supabase.auth.signInWithPassword({ email, password }); $("#auth-submit").disabled = false; $("#auth-message").textContent = error ? error.message : signupMode ? "Compte créé. Consulte ton e-mail pour confirmer l’inscription." : "Connexion réussie."; });
  $("#reset-password").onclick = async () => { const email = $("#auth-email").value.trim(); if (!email) return toast("Saisis d’abord ton adresse e-mail"); const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] }); toast(error ? error.message : "E-mail de réinitialisation envoyé"); };
  $("#profile-household-form")?.addEventListener("submit", async event => { event.preventDefault(); const name = $("#display-name").value.trim(), householdName = $("#household-name").value.trim(), userId = state.user.id; const profileResult = await supabase.from("profiles").upsert({ id: userId, display_name: name, email: state.user.email }); if (profileResult.error) return toast(profileResult.error.message); const { data: household, error } = await supabase.from("households").insert({ name: householdName, owner_user_id: userId }).select().single(); if (error) return toast(error.message); const memberResult = await supabase.from("household_members").insert({ household_id: household.id, user_id: userId, role: "owner" }); if (memberResult.error) return toast(memberResult.error.message); await loadContext(); });
  $$(".nav-btn").forEach(button => button.onclick = () => showScreen(button.dataset.screen));
  $("#quick-add").onclick = () => openEditor("task"); $("#add-task").onclick = () => openEditor("task"); $("#add-event").onclick = () => openEditor("event"); $("#add-asset").onclick = () => openEditor("asset");
  $("#editor-form").addEventListener("submit", async event => { event.preventDefault(); try { await saveEditor(new FormData(event.currentTarget)); $("#editor-dialog").close(); } catch (error) { toast(error.message); } });
  $$('[data-close-editor]').forEach(button => button.addEventListener("click", () => $("#editor-dialog").close()));
  $("#settings-btn").onclick = () => $("#settings-dialog").showModal(); $("[data-close-settings]").onclick = () => $("#settings-dialog").close(); $("#signout-btn").onclick = async () => { await supabase.auth.signOut(); location.reload(); };
  document.addEventListener("click", event => {
    const button = event.target.closest("button"); if (!button) return;
    if (button.dataset.complete) completeTask(button.dataset.complete);
    if (button.dataset.editTask) openEditor("task", button.dataset.editTask);
    if (button.dataset.trashTask) trashTask(button.dataset.trashTask);
    if (button.dataset.restoreTask) restoreTask(button.dataset.restoreTask);
    if (button.dataset.deleteEvent) deleteEvent(button.dataset.deleteEvent);
    if (button.dataset.addPlan) openEditor("plan", button.dataset.addPlan);
    if (button.dataset.editPlan) openEditor("editPlan", button.dataset.editPlan);
    if (button.dataset.donePlan) completePlan(button.dataset.donePlan);
    if (button.dataset.deletePlan) deletePlan(button.dataset.deletePlan);
    if (button.dataset.go) showScreen(button.dataset.go);
    if (button.dataset.taskFilter) { state.taskFilter = button.dataset.taskFilter; $$('[data-task-filter]').forEach(item => item.classList.toggle("active", item === button)); renderTasks(); }
    if (button.dataset.assetFilter) { state.assetFilter = button.dataset.assetFilter; $$('[data-asset-filter]').forEach(item => item.classList.toggle("active", item === button)); renderAssets(); }
    if (button.dataset.homeFilter) showScreen("agenda");
  });
  window.addEventListener("online", () => setSync("Synchronisé"));
  window.addEventListener("offline", () => setSync("Hors connexion"));
}

function setAuthMode(value) { signupMode = value; $("#tab-login").classList.toggle("active", !value); $("#tab-signup").classList.toggle("active", value); $("#auth-submit").textContent = value ? "Créer mon compte" : "Se connecter"; $("#password-help").classList.toggle("hidden", !value); $("#auth-password").autocomplete = value ? "new-password" : "current-password"; }

init();
