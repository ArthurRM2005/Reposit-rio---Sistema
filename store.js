// Camada de dados: usa Supabase (nuvem, compartilhado) quando configurado,
// ou localStorage (apenas neste navegador) caso contrário.
const Store = (() => {
  const LOCAL = 'gh_data_';
  const SESSION = 'gh_session';
  const OVERRIDE = 'gh_settings';

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }

  function settings() {
    const o = readJSON(OVERRIDE, {});
    const pick = k => ('supabaseUrl' in o ? o[k] : window.APP_CONFIG[k]) || '';
    return { supabaseUrl: pick('supabaseUrl').replace(/\/+$/, ''), supabaseAnonKey: pick('supabaseAnonKey') };
  }
  function setSettings(s) {
    if (s === null) localStorage.removeItem(OVERRIDE);
    else localStorage.setItem(OVERRIDE, JSON.stringify(s));
  }
  const isRemote = () => { const s = settings(); return !!(s.supabaseUrl && s.supabaseAnonKey); };

  const uid = () => (crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  // ---------- sessão (Supabase Auth) ----------
  const getSession = () => readJSON(SESSION, null);
  const setSession = s => s ? localStorage.setItem(SESSION, JSON.stringify(s)) : localStorage.removeItem(SESSION);

  async function authRequest(grant, body) {
    const s = settings();
    const r = await fetch(`${s.supabaseUrl}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: s.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.msg || j.error || 'Falha na autenticação');
    setSession({
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: Date.now() + j.expires_in * 1000,
      email: j.user?.email,
    });
  }
  const login = (email, password) => authRequest('password', { email, password });
  async function refresh() {
    const sess = getSession();
    if (!sess) throw new Error('Sessão expirada');
    try { await authRequest('refresh_token', { refresh_token: sess.refresh_token }); }
    catch (e) { setSession(null); location.href = 'login.html'; throw e; }
  }
  const logout = () => setSession(null);

  async function api(path, opts = {}, retry = true) {
    const s = settings();
    let sess = getSession();
    if (sess && sess.expires_at - Date.now() < 60_000) { await refresh(); sess = getSession(); }
    const r = await fetch(`${s.supabaseUrl}/rest/v1/${path}`, {
      ...opts,
      headers: {
        apikey: s.supabaseAnonKey,
        Authorization: `Bearer ${sess?.access_token || s.supabaseAnonKey}`,
        'Content-Type': 'application/json',
        ...opts.headers,
      },
    });
    if (r.status === 401 && retry && sess) { await refresh(); return api(path, opts, false); }
    if (!r.ok) throw new Error(`Erro ${r.status}: ${await r.text()}`);
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  }

  // ---------- local ----------
  const readLocal = t => readJSON(LOCAL + t, []);
  const writeLocal = (t, rows) => localStorage.setItem(LOCAL + t, JSON.stringify(rows));

  const strip = rec => { const d = { ...rec }; delete d.id; delete d.updated_at; return d; };
  const fromRow = r => ({ ...r.data, id: r.id, updated_at: r.updated_at });

  // ---------- API pública ----------
  async function list(table) {
    if (!isRemote()) return readLocal(table);
    const rows = await api(`registros?tabela=eq.${encodeURIComponent(table)}&select=id,data,updated_at&order=updated_at.desc`);
    return rows.map(fromRow);
  }

  async function get(table, id) {
    if (!isRemote()) return readLocal(table).find(r => r.id === id) || null;
    const rows = await api(`registros?tabela=eq.${encodeURIComponent(table)}&id=eq.${encodeURIComponent(id)}&select=id,data,updated_at`);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async function saveMany(table, recs) {
    const now = new Date().toISOString();
    const out = recs.map(r => ({ ...strip(r), id: r.id || uid(), updated_at: now }));
    if (!isRemote()) {
      const all = readLocal(table);
      for (const row of out) {
        const i = all.findIndex(x => x.id === row.id);
        if (i >= 0) all[i] = row; else all.unshift(row);
      }
      writeLocal(table, all);
      return out;
    }
    for (let i = 0; i < out.length; i += 500) {
      await api('registros?on_conflict=tabela,id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(out.slice(i, i + 500).map(r => ({ tabela: table, id: r.id, data: strip(r), updated_at: now }))),
      });
    }
    return out;
  }
  const save = async (table, rec) => (await saveMany(table, [rec]))[0];

  async function remove(table, id) {
    if (!isRemote()) return writeLocal(table, readLocal(table).filter(r => r.id !== id));
    await api(`registros?tabela=eq.${encodeURIComponent(table)}&id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async function clear(table) {
    if (!isRemote()) return localStorage.removeItem(LOCAL + table);
    await api(`registros?tabela=eq.${encodeURIComponent(table)}`, { method: 'DELETE' });
  }

  return { settings, setSettings, isRemote, getSession, login, logout, list, get, save, saveMany, remove, clear, uid };
})();
