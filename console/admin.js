// ════════════════════════════════════════════════════════════════
// HACCP Pro · Admin Dashboard
// Versione con mapping sonde ESP32 → apparecchi
// ════════════════════════════════════════════════════════════════

const SUPABASE_URL  = 'https://nmpbrjnmsybpzwhtsola.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tcGJyam5tc3licHp3aHRzb2xhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NjkyMjcsImV4cCI6MjA5MzQ0NTIyN30.yKsvu0lTns1GDF-Htzv8WUBlrjsIm1dkdxkMMCMX_Mc';

const ADMIN_API = SUPABASE_URL + '/functions/v1/admin-api';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'haccp-console-session'
  }
});

let allClients = [];
let editingUserId = null;
let currentQRPayload = null;
let currentAziendaId = null;

async function init() { showLogin(); }

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('dash').classList.add('hidden');
  setTimeout(() => document.getElementById('login-email').focus(), 100);
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  const err   = document.getElementById('login-err');
  const btn   = document.getElementById('login-btn');
  if (!email || !pass) { err.textContent = 'Email e password obbligatorie'; return; }
  err.textContent = '';
  btn.disabled = true; btn.textContent = 'Accesso…';
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) {
      err.textContent = error.message === 'Invalid login credentials' ? 'Credenziali non valide' : 'Errore: ' + error.message;
      btn.disabled = false; btn.textContent = 'Accedi →';
      return;
    }
    const role = data.session.user.app_metadata?.role || data.session.user.user_metadata?.role;
    if (role !== 'superadmin') {
      err.textContent = 'Account senza permessi superadmin';
      await sb.auth.signOut();
      btn.disabled = false; btn.textContent = 'Accedi →';
      return;
    }
    enterDashboard(data.session);
  } catch(e) {
    err.textContent = 'Errore rete: ' + e.message;
    btn.disabled = false; btn.textContent = 'Accedi →';
  }
}

async function doLogout() {
  if (!confirm('Uscire dalla dashboard admin?')) return;
  await sb.auth.signOut();
  showLogin();
}

function enterDashboard(session) {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dash').classList.remove('hidden');
  document.getElementById('user-info').textContent = session.user.email + ' · superadmin';
  loadClients();
}

async function callAdminApi(action, body = {}) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Sessione scaduta');
  const r = await fetch(ADMIN_API, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON
    },
    body: JSON.stringify({ action, ...body })
  });
  const json = await r.json();
  if (!r.ok || json.error) throw new Error(json.error || ('HTTP ' + r.status));
  return json;
}

async function loadClients() {
  document.getElementById('clienti-body').innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-400 text-sm">Caricamento…</td></tr>';
  try {
    const { clients } = await callAdminApi('list_clients');
    allClients = clients || [];
    renderTable();
    updateStats();
    document.getElementById('footer-info').textContent = `Aggiornato: ${new Date().toLocaleTimeString('it-IT')}`;
  } catch(e) {
    console.error(e);
    showToast('Errore: ' + e.message, 'error');
    document.getElementById('clienti-body').innerHTML = `<tr><td colspan="8" class="p-8 text-center text-red-500 text-sm">${e.message}</td></tr>`;
  }
}

function updateStats() {
  const tot = allClients.length;
  const att = allClients.filter(c => c.stato === 'attivo').length;
  const sca = allClients.filter(c => c.stato === 'in_scadenza').length;
  const exp = allClients.filter(c => c.stato === 'scaduto').length;
  document.getElementById('stat-totale').textContent = tot;
  document.getElementById('stat-attivi').textContent = att;
  document.getElementById('stat-scadenza').textContent = sca;
  document.getElementById('stat-scaduti').textContent = exp;
}

function renderTable() {
  const q = (document.getElementById('search').value || '').toLowerCase().trim();
  const stato = document.getElementById('filter-stato').value;
  const body = document.getElementById('clienti-body');
  const filtered = allClients.filter(c => {
    if (stato !== 'all' && c.stato !== stato) return false;
    if (q && !((c.nome_ristorante || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q) || (c.telefono_whatsapp || '').toLowerCase().includes(q))) return false;
    return true;
  });
  if (!filtered.length) { body.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-400 text-sm">Nessun cliente trovato</td></tr>'; return; }
  body.innerHTML = filtered.map(c => {
    const piano = pianoBadge(c.piano_abbonamento);
    const stBadge = c.stato === 'attivo' ? '<span class="bg-green-100 text-green-800 px-2 py-0.5 rounded-full text-[11px] font-bold">attivo</span>' : (c.stato === 'in_scadenza' ? '<span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full text-[11px] font-bold">in scadenza</span>' : '<span class="bg-red-100 text-red-800 px-2 py-0.5 rounded-full text-[11px] font-bold">scaduto</span>');
    const dataIT = new Date(c.data_scadenza).toLocaleDateString('it-IT');
    const giorniLbl = c.giorni_mancanti < 0 ? `scaduto da ${-c.giorni_mancanti} g` : c.giorni_mancanti > 36500 ? '∞ per sempre' : `tra ${c.giorni_mancanti} giorni`;
    const pauseN = c.pause_utilizzate || 0;
    const inPausa = !!c.abbonamento_in_pausa;
    let pauseBadge = '';
    if (inPausa) {
      const fineP = c.pausa_fine_prevista ? new Date(c.pausa_fine_prevista).toLocaleDateString('it-IT') : '—';
      pauseBadge = `<span class="bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full text-[11px] font-bold" title="In pausa fino al ${fineP}">⏸ in pausa</span><div class="text-[10px] text-slate-500 mt-1">fino al ${fineP}</div>`;
    } else {
      const tone = pauseN >= 2 ? 'bg-red-50 text-red-700' : pauseN === 1 ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600';
      pauseBadge = `<span class="${tone} px-2 py-0.5 rounded-full text-[11px] font-bold">${pauseN}/2</span>`;
    }
    return `<tr class="border-b border-slate-100 hover:bg-slate-50">
      <td class="py-2.5 px-3"><div class="font-semibold text-slate-900">${escapeHtml(c.nome_ristorante || '—')}</div><div class="text-[11px] text-slate-500 md:hidden">${escapeHtml(c.email || '')}</div>${c.telefono_whatsapp ? `<div class="text-[11px] text-slate-400">📱 ${escapeHtml(c.telefono_whatsapp)}</div>` : ''}</td>
      <td class="py-2.5 px-3 text-slate-600 hidden md:table-cell">${escapeHtml(c.email || '—')}</td>
      <td class="py-2.5 px-3">${piano}</td>
      <td class="py-2.5 px-3">${pauseBadge}</td>
      <td class="py-2.5 px-3"><div class="text-slate-700">${dataIT}</div><div class="text-[11px] text-slate-500">${giorniLbl}</div></td>
      <td class="py-2.5 px-3">${stBadge}</td>
      <td class="py-2.5 px-3"><div class="flex gap-1 justify-end">
        <button onclick="openRenewModal('${c.user_id}')" title="Rinnova" class="p-1.5 rounded border border-slate-300 hover:bg-blue-50 hover:border-blue-400 text-sm">↻</button>
        <button onclick="openESPModal('${c.user_id}', '${c.azienda_id}')" title="Configura ESP32" class="p-1.5 rounded border border-slate-300 hover:bg-purple-50 hover:border-purple-400 text-sm">📡</button>
        <button onclick="openEditModal('${c.user_id}')" title="Modifica" class="p-1.5 rounded border border-slate-300 hover:bg-slate-100 text-sm">✎</button>
        <button onclick="doResetPassword('${c.user_id}')" title="Reset password" class="p-1.5 rounded border border-slate-300 hover:bg-amber-50 hover:border-amber-400 text-sm">⚿</button>
        <button onclick="doDeleteClient('${c.user_id}')" title="Elimina" class="p-1.5 rounded border border-slate-300 hover:bg-red-50 hover:border-red-400 text-red-700 text-sm">✕</button>
      </div></td>
    </tr>`;
  }).join('');
}

function escapeHtml(s) { return String(s||'').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }

// ========== MODALE ESP32 ==========

async function openESPModal(userId, aziendaId) {
  currentAziendaId = aziendaId;
  const cliente = allClients.find(c => c.user_id === userId);
  if (!cliente) return;
  document.getElementById('esp-cliente-nome').textContent = cliente.nome_ristorante || cliente.email;
  document.getElementById('esp-device-list').innerHTML = '<div class="text-center py-4 text-slate-400">Caricamento...</div>';
  document.getElementById('modal-esp').classList.remove('hidden');

  try {
    const [{ tokens }, { apparecchi }] = await Promise.all([
      callAdminApi('list_device_tokens', { azienda_id: aziendaId }),
      callAdminApi('list_apparecchi', { azienda_id: aziendaId })
    ]);

    const apparecchiList = apparecchi || [];
    let espBlocks = '';

    if (!tokens || tokens.length === 0) {
      espBlocks = '<div class="text-center py-4 text-slate-400 text-sm">Nessun ESP32 configurato. Genera un token per iniziare.</div>';
    } else {
      for (const t of tokens) {
        const { sonde } = await callAdminApi('list_token_sonde', { token_id: t.id }).catch(() => ({ sonde: [] }));
        espBlocks += renderESPBlock(t, sonde || [], apparecchiList, aziendaId);
      }
    }

    document.getElementById('esp-device-list').innerHTML = `
      <div class="space-y-4">
        ${espBlocks}
        <button onclick="generateNewToken('${aziendaId}')"
                class="w-full py-2.5 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-blue-400 hover:text-blue-600 text-sm font-medium transition">
          + Aggiungi nuovo ESP32
        </button>
      </div>`;
  } catch(e) {
    document.getElementById('esp-device-list').innerHTML = `<div class="text-red-500 text-sm">Errore: ${e.message}</div>`;
  }
}

function renderESPBlock(token, sonde, apparecchiList, aziendaId) {
  const lastUsed = token.last_used_at
    ? 'Ultimo invio: ' + new Date(token.last_used_at).toLocaleString('it-IT')
    : 'Mai utilizzato';

  let sondeRows = '';
  if (sonde.length === 0) {
    sondeRows = '<div class="text-xs text-slate-400 italic py-1">Nessuna sonda mappata — verranno create automaticamente al primo invio.</div>';
  } else {
    for (const s of sonde) {
      sondeRows += `
        <div class="flex items-center gap-2 py-1.5 border-b border-slate-100 last:border-0" id="sonda-row-${s.id}">
          <span class="text-xs text-slate-500 w-16 shrink-0">Sonda ${s.sonda_idx + 1}</span>
          <span class="text-xs font-mono text-slate-400 truncate flex-1" title="${escapeHtml(s.apparecchio_fw)}">${escapeHtml(s.apparecchio_fw)}</span>
          <span class="text-slate-400 text-xs">→</span>
          <select onchange="saveSondaMapping('${s.id}', this.value, '${aziendaId}')"
                  class="flex-1 text-xs px-2 py-1 border border-slate-200 rounded bg-white min-w-0">
            <option value="">— Seleziona apparecchio —</option>
            ${apparecchiList.map(a =>
              `<option value="${a.id}" ${a.id === s.apparecchio_id ? 'selected' : ''}>${escapeHtml(a.name)} (${a.type === 'frigo' ? '❄️' : '🧊'})</option>`
            ).join('')}
            <option value="__new__">➕ Crea nuovo...</option>
          </select>
        </div>`;
    }
  }

  return `
    <div class="border border-slate-200 rounded-lg overflow-hidden" id="esp-block-${token.id}">
      <div class="bg-slate-50 px-4 py-3 flex justify-between items-start gap-2">
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs font-bold text-slate-700">📡 ESP32</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full ${token.enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} font-bold">
              ${token.enabled ? 'attivo' : 'disabilitato'}
            </span>
          </div>
          <div class="text-[10px] text-slate-400 mt-0.5">${lastUsed}</div>
        </div>
        <div class="flex gap-1 shrink-0">
          <button onclick="showTokenQR('${token.token}', '${token.id}')"
                  class="px-2.5 py-1.5 bg-blue-600 text-white rounded text-xs font-bold hover:bg-blue-700">
            📱 QR Token
          </button>
          <button onclick="regenerateToken('${token.id}', '${aziendaId}')"
                  title="Rigenera token"
                  class="px-2.5 py-1.5 bg-slate-200 text-slate-700 rounded text-xs font-bold hover:bg-slate-300">
            🔄
          </button>
          <button onclick="deleteDeviceToken('${token.id}', '${aziendaId}')"
                  title="Elimina dispositivo"
                  class="px-2.5 py-1.5 bg-red-100 text-red-700 rounded text-xs font-bold hover:bg-red-200">
            🗑
          </button>
        </div>
      </div>
      <div class="px-4 py-2 bg-white border-b border-slate-100 flex items-center gap-2">
        <code class="text-[11px] text-slate-500 font-mono truncate flex-1" id="token-str-${token.id}">${token.token}</code>
        <button onclick="copyToken('${token.id}')"
                class="text-[11px] px-2 py-1 bg-slate-100 rounded hover:bg-slate-200 shrink-0">📋 Copia</button>
      </div>
      <div id="qr-container-${token.id}" class="hidden px-4 py-3 bg-white border-b border-slate-100 text-center"></div>
      <div class="px-4 py-3 bg-white">
        <div class="text-xs font-bold text-slate-600 mb-2">🌡️ Mapping sonde → apparecchi</div>
        <div id="sonde-mapping-${token.id}">${sondeRows}</div>
      </div>
    </div>`;
}

function showTokenQR(token, tokenId) {
  const container = document.getElementById(`qr-container-${tokenId}`);
  if (!container) return;
  if (!container.classList.contains('hidden') && container.innerHTML.trim() !== '') {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  container.innerHTML = '<div class="text-xs text-slate-400 py-2">Generazione QR...</div>';
  const endpoint = SUPABASE_URL + '/functions/v1/ingest-temperature';
  const payload = JSON.stringify({ device_token: token, endpoint });
  container.innerHTML = '';
  if (typeof QRCode !== 'undefined') {
    new QRCode(container, { text: payload, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M });
  } else {
    const img = document.createElement('img');
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(payload)}`;
    img.style.cssText = 'width:180px;height:180px;display:block;margin:0 auto;';
    container.appendChild(img);
  }
  const caption = document.createElement('div');
  caption.className = 'text-[11px] text-slate-500 mt-2';
  caption.textContent = 'Inquadra con il pannello di configurazione ESP32';
  container.appendChild(caption);
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Chiudi QR';
  closeBtn.className = 'mt-2 text-xs bg-slate-200 px-3 py-1 rounded';
  closeBtn.onclick = () => container.classList.add('hidden');
  container.appendChild(closeBtn);
}

function copyToken(tokenId) {
  const el = document.getElementById(`token-str-${tokenId}`);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent.trim());
  showToast('Token copiato', 'success');
}

async function generateNewToken(aziendaId) {
  try {
    const token = crypto.randomUUID
      ? crypto.randomUUID()
      : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
          (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c/4).toString(16));
    await callAdminApi('upsert_device_token', { azienda_id: aziendaId, apparecchio_id: null, token, enabled: true });
    showToast('Nuovo token generato', 'success');
    const userId = allClients.find(c => c.azienda_id === aziendaId)?.user_id;
    if (userId) openESPModal(userId, aziendaId);
  } catch(e) { showToast('Errore: ' + e.message, 'error'); }
}

async function regenerateToken(tokenId, aziendaId) {
  if (!confirm('Rigenerare il token? Il firmware ESP32 dovrà essere aggiornato con il nuovo token.')) return;
  try {
    const newToken = crypto.randomUUID
      ? crypto.randomUUID()
      : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
          (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c/4).toString(16));
    await callAdminApi('update_device_token', { token_id: tokenId, token: newToken });
    showToast('Token rigenerato', 'success');
    const userId = allClients.find(c => c.azienda_id === aziendaId)?.user_id;
    if (userId) openESPModal(userId, aziendaId);
  } catch(e) { showToast('Errore: ' + e.message, 'error'); }
}

async function deleteDeviceToken(tokenId, aziendaId) {
  if (!confirm('Eliminare questo dispositivo ESP32?\nIl token verrà rimosso e il dispositivo non potrà più inviare dati.\nOperazione irreversibile.')) return;
  try {
    await callAdminApi('delete_device_token', { token_id: tokenId });
    showToast('✓ Dispositivo eliminato', 'success');
    const userId = allClients.find(c => c.azienda_id === aziendaId)?.user_id;
    if (userId) openESPModal(userId, aziendaId);
  } catch(e) { showToast('Errore: ' + e.message, 'error'); }
}

async function saveSondaMapping(sondaId, apparecchioId, aziendaId) {
  if (apparecchioId === '__new__') {
    const nome = prompt('Nome del nuovo apparecchio (es. "Frigo Cucina", "Freezer Dispensa"):');
    if (!nome || !nome.trim()) return;
    const tipoStr = prompt('Tipo? Scrivi "frigo" o "gelo":', 'frigo');
    const tipo = (tipoStr === 'gelo') ? 'gelo' : 'frigo';
    try {
      const { apparecchio } = await callAdminApi('create_apparecchio', { azienda_id: aziendaId, name: nome.trim(), type: tipo, area: 'Da configurare' });
      apparecchioId = apparecchio.id;
      showToast(`✓ Apparecchio "${nome}" creato`, 'success');
    } catch(e) { showToast('Errore creazione: ' + e.message, 'error'); return; }
  }
  if (!apparecchioId) return;
  try {
    await callAdminApi('update_sonda_mapping', { sonda_id: sondaId, apparecchio_id: apparecchioId });
    showToast('Mapping salvato', 'success');
  } catch(e) { showToast('Errore salvataggio mapping: ' + e.message, 'error'); }
}

// ========== CREATE ==========
function openCreateModal() {
  ['cf-email','cf-pass','cf-nome','cf-tel','cf-cmb','cf-indirizzo','cf-piva'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('cf-piano').value = '14.99_basic';
  document.getElementById('cf-mesi').value = '1';
  document.getElementById('cf-err').textContent = '';
  document.getElementById('cf-pass').value = generatePassword();
  document.getElementById('modal-create').classList.remove('hidden');
  setTimeout(() => document.getElementById('cf-email').focus(), 100);
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let p = '';
  for (let i = 0; i < 10; i++) p += chars[Math.floor(Math.random()*chars.length)];
  return p;
}

async function doCreateClient() {
  const err = document.getElementById('cf-err');
  const btn = document.getElementById('cf-submit');
  err.textContent = '';
  const payload = {
    email: document.getElementById('cf-email').value.trim(),
    password: document.getElementById('cf-pass').value,
    nome_ristorante: document.getElementById('cf-nome').value.trim(),
    telefono_whatsapp: document.getElementById('cf-tel').value.trim(),
    callmebot_apikey: document.getElementById('cf-cmb').value.trim(),
    piano_abbonamento: document.getElementById('cf-piano').value,
    mesi_iniziali: parseInt(document.getElementById('cf-mesi').value),
    indirizzo: document.getElementById('cf-indirizzo').value.trim(),
    piva: document.getElementById('cf-piva').value.trim(),
  };
  if (!payload.email || !payload.password || !payload.nome_ristorante) { err.textContent = 'Compila i campi obbligatori (*)'; return; }
  if (payload.password.length < 8) { err.textContent = 'Password troppo corta (min 8 caratteri)'; return; }
  btn.disabled = true; btn.textContent = 'Creazione…';
  try {
    await callAdminApi('create_client', payload);
    closeModal('modal-create');
    showToast(`✓ Cliente creato: ${payload.email}`, 'success');
    alert(`Cliente creato!\n\nEmail: ${payload.email}\nPassword: ${payload.password}\n\n⚠️ COMUNICA QUESTE CREDENZIALI AL CLIENTE.`);
    await loadClients();
  } catch(e) { err.textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = '✓ Crea cliente'; }
}

// ========== RENEW ==========
function openRenewModal(userId) {
  const c = allClients.find(x => x.user_id === userId);
  if (!c) return;
  editingUserId = userId;
  document.getElementById('renew-nome').textContent = c.nome_ristorante || c.email;
  document.getElementById('renew-scadenza-attuale').textContent = new Date(c.data_scadenza).toLocaleDateString('it-IT') + (c.giorni_mancanti < 0 ? ` (scaduto da ${-c.giorni_mancanti}g)` : ` (tra ${c.giorni_mancanti}g)`);
  document.getElementById('modal-renew').classList.remove('hidden');
}

async function doRenew(mesi) {
  if (!editingUserId) return;
  try {
    const r = await callAdminApi('extend_subscription', { user_id: editingUserId, mesi });
    closeModal('modal-renew');
    showToast(`✓ Rinnovato. Nuova scadenza: ${new Date(r.new_data_scadenza).toLocaleDateString('it-IT')}`, 'success');
    await loadClients();
  } catch(e) { showToast('Errore: ' + e.message, 'error'); }
}

async function doRenewForever() {
  if (!editingUserId) return;
  if (!confirm('Impostare scadenza al 31/12/2099 (di fatto "per sempre")?')) return;
  try {
    await callAdminApi('extend_subscription', { user_id: editingUserId, forever: true });
    closeModal('modal-renew');
    showToast(`✓ Scadenza impostata al 2099`, 'success');
    await loadClients();
  } catch(e) { showToast('Errore: ' + e.message, 'error'); }
}

// ========== EDIT ==========
function openEditModal(userId) {
  const c = allClients.find(x => x.user_id === userId);
  if (!c) return;
  editingUserId = userId;
  document.getElementById('ef-nome').value = c.nome_ristorante || '';
  document.getElementById('ef-tel').value = c.telefono_whatsapp || '';
  document.getElementById('ef-cmb').value = c.callmebot_apikey || '';
  document.getElementById('ef-piano').value = c.piano_abbonamento || '14.99_basic';
  toggleWaNotifTipo();
  const waNotifTipo = document.getElementById('ef-wa-notif-tipo');
  if (waNotifTipo) waNotifTipo.value = c.wa_notif_tipo || 'entrambi';
  document.getElementById('ef-note').value = c.note_admin || '';
  if (c.data_scadenza) {
    const d = new Date(c.data_scadenza);
    document.getElementById('ef-scadenza').value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  } else {
    document.getElementById('ef-scadenza').value = '';
  }
  document.getElementById('modal-edit').classList.remove('hidden');
}

async function doSaveEdit() {
  if (!editingUserId) return;
  const payload = {
    user_id: editingUserId,
    nome_ristorante: document.getElementById('ef-nome').value.trim(),
    telefono_whatsapp: document.getElementById('ef-tel').value.trim(),
    callmebot_apikey: document.getElementById('ef-cmb').value.trim(),
    piano_abbonamento: document.getElementById('ef-piano').value,
    wa_notif_tipo: pianoHasWA(document.getElementById('ef-piano').value) ? document.getElementById('ef-wa-notif-tipo').value : 'entrambi',
    note_admin: document.getElementById('ef-note').value,
  };
  const scadStr = document.getElementById('ef-scadenza').value;
  if (scadStr) payload.data_scadenza = new Date(scadStr + 'T23:59:59').toISOString();
  else payload.data_scadenza = null;
  try {
    await callAdminApi('update_client', payload);
    closeModal('modal-edit');
    showToast('✓ Modifiche salvate', 'success');
    await loadClients();
  } catch(e) { showToast('Errore: ' + e.message, 'error'); }
}

// ========== QR SETUP ==========
async function openQRModal(userId) {
  const c = allClients.find(x => x.user_id === userId);
  if (!c) return;
  const payload = { tenant_id: c.azienda_id, piano: c.piano_abbonamento, nome: c.nome_ristorante };
  currentQRPayload = JSON.stringify(payload);
  document.getElementById('qr-nome').textContent = c.nome_ristorante;
  document.getElementById('qr-payload').textContent = JSON.stringify(payload, null, 2);
  const target = document.getElementById('qr-target');
  target.innerHTML = '<div class="text-sm text-slate-400 p-4">Generazione QR…</div>';
  document.getElementById('modal-qr').classList.remove('hidden');
  if (typeof QRCode !== 'undefined') {
    try { target.innerHTML = ''; new QRCode(target, { text: currentQRPayload, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M }); return; } catch(e) {}
  }
  target.innerHTML = '';
  const img = document.createElement('img');
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(currentQRPayload)}`;
  img.style.cssText = 'width:240px;height:240px;display:block;margin:0 auto;';
  target.appendChild(img);
}

function downloadQR() {
  const canvas = document.querySelector('#qr-target canvas');
  if (canvas) { const a = document.createElement('a'); a.href = canvas.toDataURL('image/png'); a.download = `qr-haccp-${Date.now()}.png`; a.click(); return; }
  const img = document.querySelector('#qr-target img');
  if (img) { window.open(img.src, '_blank'); showToast('Immagine aperta — usa "Salva con nome"', 'info'); return; }
  showToast('QR non disponibile per il download', 'error');
}

// ========== RESET PASSWORD ==========
async function doResetPassword(userId) {
  const c = allClients.find(x => x.user_id === userId);
  if (!c) return;
  if (!confirm(`Inviare email di recupero password a ${c.email}?`)) return;
  try {
    await callAdminApi('reset_password', { email: c.email });
    showToast(`✓ Email inviata a ${c.email}`, 'success');
  } catch(e) { showToast('Errore: ' + e.message, 'error'); }
}

// ========== DELETE CLIENT ==========
async function doDeleteClient(userId) {
  const c = allClients.find(x => x.user_id === userId);
  if (!c) return;
  if (!confirm(`⚠️ ATTENZIONE — ELIMINAZIONE PERMANENTE\n\nStai per cancellare:\n• ${c.nome_ristorante}\n• ${c.email}\n• Tutti i dati HACCP\n\nContinuare?`)) return;
  const conferma = prompt(`Per confermare, digita esattamente: ELIMINA`);
  if (conferma !== 'ELIMINA') { showToast('Eliminazione annullata', 'warning'); return; }
  try {
    await callAdminApi('delete_client', { user_id: userId });
    showToast(`✓ ${c.email} eliminato`, 'success');
    await loadClients();
  } catch(e) { showToast('Errore: ' + e.message, 'error'); }
}

// ========== MODAL UTILS ==========
function closeModal(id) { document.getElementById(id).classList.add('hidden'); if (id !== 'modal-qr') editingUserId = null; }
function closeModalBg(e, id) { if (e.target.id === id) closeModal(id); }
function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  const colors = { success: 'bg-green-600', error: 'bg-red-600', warning: 'bg-amber-600', info: 'bg-slate-700' };
  t.className = `fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-md text-white text-sm font-medium shadow-lg z-50 ${colors[type] || colors.info}`;
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3500);
}

// ========== VIEW NAVIGATION ==========
function setView(name, btn) {
  document.querySelectorAll('.nav-pill').forEach(p => {
    p.classList.remove('bg-slate-800','text-white','nav-pill-active');
    p.classList.add('bg-white','border','border-slate-300','text-slate-700');
  });
  btn.classList.add('bg-slate-800','text-white','nav-pill-active');
  btn.classList.remove('bg-white','border','border-slate-300','text-slate-700');
  document.getElementById('view-clients').classList.add('hidden');
  document.getElementById('view-audit').classList.add('hidden');
  document.getElementById('view-trash').classList.add('hidden');
  document.getElementById('view-' + name).classList.remove('hidden');
  if (name === 'audit') populateClientSelect('audit-client');
  if (name === 'trash') populateClientSelect('trash-client');
}

function populateClientSelect(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = (selectId === 'trash-client' ? '<option value="">Seleziona cliente</option>' : '<option value="">Tutti i clienti</option>');
  allClients.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.azienda_id;
    opt.textContent = c.nome_ristorante + ' (' + c.email + ')';
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

// ========== AUDIT LOG ==========
let lastAuditResults = [];

async function loadAudit() {
  const body = document.getElementById('audit-body');
  body.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-400 text-sm">Caricamento…</td></tr>';
  const days = parseInt(document.getElementById('audit-period').value);
  const params = {
    from: new Date(Date.now() - days*86400*1000).toISOString(),
    azienda_id: document.getElementById('audit-client').value || undefined,
    table_name: document.getElementById('audit-table').value || undefined,
    operation: document.getElementById('audit-op').value || undefined,
    limit: 500
  };
  Object.keys(params).forEach(k => params[k] === undefined && delete params[k]);
  try {
    const r = await callAdminApi('list_audit', params);
    lastAuditResults = r.logs || [];
    renderAuditTable();
    document.getElementById('audit-count').textContent = `${lastAuditResults.length} record (limite ${r.limit})`;
  } catch(e) {
    body.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-500 text-sm">${e.message}</td></tr>`;
  }
}

function renderAuditTable() {
  const body = document.getElementById('audit-body');
  if (!lastAuditResults.length) { body.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-400 text-sm">Nessun log trovato</td></tr>'; return; }
  const opColors = { INSERT: 'bg-green-100 text-green-800', UPDATE: 'bg-blue-100 text-blue-800', DELETE: 'bg-red-100 text-red-800', SOFT_DELETE: 'bg-orange-100 text-orange-800', RESTORE: 'bg-purple-100 text-purple-800' };
  body.innerHTML = lastAuditResults.map(l => {
    const dt = new Date(l.performed_at).toLocaleString('it-IT');
    const opCls = opColors[l.operation] || 'bg-slate-100 text-slate-700';
    let dettagli = '';
    if (l.operation === 'UPDATE' && l.changed && l.changed.length > 0) {
      dettagli = '<details><summary class="text-xs">' + escapeHtml(l.changed.join(', ')) + '</summary><pre class="text-[10px] mt-1 p-1 bg-slate-50 rounded">' + escapeHtml(JSON.stringify({ old: l.old_data, new: l.new_data }, null, 1)) + '</pre></details>';
    } else if (l.operation === 'DELETE' || l.operation === 'SOFT_DELETE') {
      dettagli = '<details><summary class="text-xs">vedi dati</summary><pre class="text-[10px] mt-1 p-1 bg-slate-50 rounded">' + escapeHtml(JSON.stringify(l.old_data, null, 1)) + '</pre></details>';
    } else if (l.operation === 'INSERT') {
      dettagli = '<details><summary class="text-xs">vedi dati</summary><pre class="text-[10px] mt-1 p-1 bg-slate-50 rounded">' + escapeHtml(JSON.stringify(l.new_data, null, 1)) + '</pre></details>';
    }
    return `<tr><td class="py-2 px-3 text-xs">${dt}</td><td class="py-2 px-3 text-xs">${escapeHtml(l.user_email || '—')}<br><span class="text-slate-400">${escapeHtml(l.user_role || '')}</span></td><td class="py-2 px-3"><code class="text-xs bg-slate-100 px-1 rounded">${escapeHtml(l.table_name)}</code></td><td class="py-2 px-3"><span class="${opCls} px-2 py-0.5 rounded-full text-[11px] font-bold">${l.operation}</span></td><td class="py-2 px-3">${dettagli}</td></tr>`;
  }).join('');
}

function exportAuditCSV() {
  if (!lastAuditResults.length) { showToast('Nessun dato da esportare', 'warning'); return; }
  const headers = ['Data/Ora','Utente','Ruolo','Azienda','Tabella','Operazione','Record ID','Campi modificati'];
  const rows = lastAuditResults.map(l => [new Date(l.performed_at).toLocaleString('it-IT'), l.user_email || '', l.user_role || '', l.azienda_id || '', l.table_name, l.operation, l.record_id || '', (l.changed || []).join('; ')]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `audit_log_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('CSV scaricato', 'success');
}

async function clearAudit() {
  const azienda_id = document.getElementById('audit-client').value;
  if (!azienda_id) { showToast('Seleziona prima un cliente dal filtro', 'warning'); return; }
  const cliente = allClients.find(c => c.azienda_id === azienda_id);
  const nome = cliente ? cliente.nome_ristorante : azienda_id;
  if (!confirm(`Eliminare TUTTI i log audit di "${nome}"? L'operazione è irreversibile.`)) return;
  try {
    const r = await callAdminApi('clear_audit', { azienda_id });
    showToast(`✓ ${r.deleted} log eliminati per ${nome}`, 'success');
    lastAuditResults = [];
    renderAuditTable();
    document.getElementById('audit-count').textContent = '0 record';
  } catch(e) { showToast('Errore: ' + e.message, 'error'); }
}

// ========== CESTINO ==========
let lastTrashResults = [];
let lastTrashTable = null;

async function loadTrash() {
  const azienda_id = document.getElementById('trash-client').value;
  const table_name = document.getElementById('trash-table').value;
  if (!azienda_id) { showToast('Seleziona un cliente', 'warning'); return; }
  const body = document.getElementById('trash-body');
  body.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-slate-400 text-sm">Caricamento…</td></tr>';
  try {
    const r = await callAdminApi('list_trash', { azienda_id, table_name });
    lastTrashResults = r.records || [];
    lastTrashTable = r.table_name;
    renderTrashTable();
    document.getElementById('trash-count').textContent = `${lastTrashResults.length} record nel cestino`;
  } catch(e) {
    body.innerHTML = `<tr><td colspan="3" class="p-8 text-center text-red-500 text-sm">${e.message}</td></tr>`;
  }
}

function renderTrashTable() {
  const body = document.getElementById('trash-body');
  if (!lastTrashResults.length) { body.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-slate-400 text-sm">Cestino vuoto</td></tr>'; return; }
  body.innerHTML = lastTrashResults.map(r => {
    const dl = r.deleted_at ? new Date(r.deleted_at).toLocaleString('it-IT') : '—';
    let summary = '';
    if (lastTrashTable === 'temperature') summary = `<b>${escapeHtml(r.apparecchio || '')}</b> · ${r.temp}°C · ${escapeHtml(r.data || '')} ${escapeHtml(r.ora || '')}`;
    else if (lastTrashTable === 'azioni_correttive') summary = `<b>${escapeHtml(r.apparecchio || '')}</b> · ${escapeHtml(r.data_anomalia || '')} ${escapeHtml(r.ora_anomalia || '')}`;
    else if (lastTrashTable === 'firme') summary = `<b>${escapeHtml(r.operatore || '')}</b> · ${escapeHtml(r.data || '')} ${escapeHtml(r.ora || '')}`;
    return `<tr><td class="py-2 px-3 text-xs">${dl}</td><td class="py-2 px-3 text-sm">${summary}</td><td class="py-2 px-3 text-right"><button onclick="doRestore('${r.id}')" class="px-3 py-1 rounded-md bg-green-600 hover:bg-green-700 text-white text-xs font-bold">↩ Ripristina</button></td></tr>`;
  }).join('');
}

async function doRestore(id) {
  if (!confirm('Ripristinare questo record?')) return;
  try {
    await callAdminApi('restore_record', { table_name: lastTrashTable, id });
    showToast('✓ Record ripristinato', 'success');
    await loadTrash();
  } catch(e) { showToast('Errore: ' + e.message, 'error'); }
}

async function clearTrash() {
  const azienda_id = document.getElementById('trash-client').value;
  const table_name = document.getElementById('trash-table').value;
  if (!azienda_id) { showToast('Seleziona prima un cliente', 'warning'); return; }
  if (!lastTrashResults.length) { showToast('Il cestino è già vuoto', 'warning'); return; }
  const cliente = allClients.find(c => c.azienda_id === azienda_id);
  const nome = cliente ? cliente.nome_ristorante : azienda_id;
  const tabLabel = table_name || 'tutte le tabelle';
  if (!confirm(`Svuotare DEFINITIVAMENTE il cestino di "${nome}" (${tabLabel})?\nI record eliminati non potranno essere recuperati.`)) return;
  try {
    const r = await callAdminApi('empty_trash', { azienda_id, table_name });
    showToast(`✓ ${r.deleted} record eliminati definitivamente`, 'success');
    lastTrashResults = [];
    renderTrashTable();
    document.getElementById('trash-count').textContent = '0 record nel cestino';
  } catch(e) { showToast('Errore: ' + e.message, 'error'); }
}

// ========== HELPER WA ==========
const PIANI_WA = ['24.99_standard', '34.99_pro', '44.99_business'];
function pianoHasWA(val) { return PIANI_WA.includes(val); }
function pianoBadge(val) {
  const map = { '14.99_basic': ['bg-slate-100 text-slate-700', 'Basic 14.99'], '24.99_standard': ['bg-blue-100 text-blue-800', 'Standard 24.99'], '34.99_pro': ['bg-green-100 text-green-800', 'Pro 34.99'], '44.99_business': ['bg-purple-100 text-purple-800', 'Business 44.99'] };
  const [cls, label] = map[val] || ['bg-slate-100 text-slate-600', val || '—'];
  return `<span class="${cls} px-2 py-0.5 rounded-full text-[11px] font-bold">${label}</span>`;
}
function toggleWaNotifTipo() {
  const piano = document.getElementById('ef-piano');
  const block = document.getElementById('ef-wa-tipo-block');
  if (!piano || !block) return;
  block.style.display = pianoHasWA(piano.value) ? '' : 'none';
  const sel = document.getElementById('ef-wa-notif-tipo');
  if (sel && piano.value === '24.99_standard' && sel.value === 'entrambi') sel.value = 'solo_messaggio';
  if (sel && (piano.value === '34.99_pro' || piano.value === '44.99_business') && sel.value === 'solo_messaggio') sel.value = 'entrambi';
}

init();
