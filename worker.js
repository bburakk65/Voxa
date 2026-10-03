const DISCORD_CID = '1555941897644671110';
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = s => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
};
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* ---- Voxa oturum token'ı (imzalı) ---- */
async function hmac(secret, data) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function sign(secret, u) {
  const p = b64u(enc.encode(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 30 * 86400 })));
  return 'v1.' + p + '.' + (await hmac(secret, p));
}
async function unsign(secret, tok) {
  const [v, p, s] = String(tok).split('.');
  if (v !== 'v1' || !p || !safeEq(s || '', await hmac(secret, p))) throw new Error('sig');
  const d = JSON.parse(dec.decode(b64(p)));
  if (d.exp * 1000 < Date.now()) throw new Error('exp');
  return d;
}

/* ---- Discord ile giriş ---- */
const COOKIE = '; HttpOnly; Secure; SameSite=Lax; Path=/auth';
async function discordStart(u) {
  const full = u.searchParams.get('full') === '1';
  const state = crypto.randomUUID();
  const p = { client_id: DISCORD_CID, response_type: 'code', scope: 'identify guilds', redirect_uri: u.origin + '/auth/discord', state };
  if (!full) p.prompt = 'none';
  const h = new Headers({ Location: 'https://discord.com/oauth2/authorize?' + new URLSearchParams(p) });
  h.append('Set-Cookie', 'vs=' + state + COOKIE + '; Max-Age=600');
  h.append('Set-Cookie', 'vf=' + (full ? '1' : '0') + COOKIE + '; Max-Age=600');
  return new Response(null, { status: 302, headers: h });
}
async function discordCallback(req, env, u) {
  if (!env.DISCORD_SECRET) return new Response('DISCORD_SECRET ayarlanmamis', { status: 500 });
  const cookie = req.headers.get('Cookie') || '';
  const err = u.searchParams.get('error');
  if (err) {
    const full = /(?:^|;\s*)vf=1/.test(cookie);
    if (!full && err !== 'access_denied') return Response.redirect(u.origin + '/auth/discord/start?full=1', 302);
    return Response.redirect(u.origin + '/', 302);
  }
  const code = u.searchParams.get('code'), state = u.searchParams.get('state');
  const ck = cookie.match(/(?:^|;\s*)vs=([^;]+)/);
  if (!code || !state || !ck || ck[1] !== state) return Response.redirect(u.origin + '/auth/discord/start?full=1', 302);
  const tr = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: DISCORD_CID, client_secret: env.DISCORD_SECRET, grant_type: 'authorization_code',
      code, redirect_uri: u.origin + '/auth/discord'
    })
  });
  if (!tr.ok) return new Response('Discord girisi basarisiz (token). Gizli anahtari ve yonlendirme adresini kontrol et.', { status: 502 });
  const { access_token } = await tr.json();
  const hdr = { Authorization: 'Bearer ' + access_token };
  const [ur, gr] = await Promise.all([
    fetch('https://discord.com/api/users/@me', { headers: hdr }),
    fetch('https://discord.com/api/users/@me/guilds', { headers: hdr }).catch(() => null)
  ]);
  if (!ur.ok) return new Response('Discord girisi basarisiz (kullanici)', { status: 502 });
  const d = await ur.json();
  let guilds = [];
  try {
    if (gr && gr.ok) guilds = (await gr.json()).slice(0, 200).map(g => ({ id: String(g.id), name: String(g.name), icon: g.icon ? String(g.icon) : null }));
  } catch {}
  try {
    await env.HUB.get(env.HUB.idFromName('main')).fetch('https://hub/internal/guilds', { method: 'POST', body: JSON.stringify({ id: 'd' + d.id, guilds }) });
  } catch {}
  const pic = d.avatar ? 'https://cdn.discordapp.com/avatars/' + d.id + '/' + d.avatar + '.png?size=64' : '';
  const tok = await sign(env.DISCORD_SECRET, { id: 'd' + d.id, name: d.global_name || d.username, picture: pic });
  const h = new Headers({ Location: u.origin + '/#vt=' + tok });
  h.append('Set-Cookie', 'vs=' + COOKIE + '; Max-Age=0');
  h.append('Set-Cookie', 'vf=' + COOKIE + '; Max-Age=0');
  return new Response(null, { status: 302, headers: h });
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === '/ws') return env.HUB.get(env.HUB.idFromName('main')).fetch(req);
    if (u.pathname === '/auth/discord/start') return discordStart(u);
    if (u.pathname === '/auth/discord') return discordCallback(req, env, u);
    return new Response('Not found', { status: 404 });
  }
};

export class Hub {
  constructor(state, env) { this.s = state; this.env = env; this.gcache = new Map(); }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/internal/guilds' && req.method === 'POST') {
      const { id, guilds } = await req.json();
      await this.s.storage.put('g:' + id, guilds);
      this.gcache.delete(id);
      return new Response('ok');
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket bekleniyor', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.s.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'auth') {
      try {
        const secret = this.env.DISCORD_SECRET;
        if (!secret || !String(m.token).startsWith('v1.')) throw new Error('auth');
        const u = await unsign(secret, m.token);
        ws.serializeAttachment({ id: u.id, name: u.name, pic: u.picture || '' });
        const hist0 = (await this.s.storage.get('msgs')) || {};
        const hist = {};
        for (const k of Object.keys(hist0)) { if (await this.canSee(u.id, k)) hist[k] = hist0[k]; }
        const guilds = (await this.s.storage.get('g:' + u.id)) || [];
        ws.send(JSON.stringify({ t: 'ready', hist, online: this.users(), guilds }));
        this.bc({ t: 'online', online: this.users() });
        await this.vstate();
      } catch { ws.send(JSON.stringify({ t: 'error' })); ws.close(1008, 'auth'); }
      return;
    }
    const me = ws.deserializeAttachment();
    if (!me) return;
    if (m.t === 'msg') {
      const text = String(m.text || '').trim().slice(0, 2000);
      const ch = String(m.ch || '').slice(0, 60);
      if (!text || !ch) return;
      if (!(await this.canSee(me.id, ch))) return;
      const msg = { u: me.name, id: me.id, mid: crypto.randomUUID(), t: text, ts: Date.now() };
      const all = (await this.s.storage.get('msgs')) || {};
      all[ch] = (all[ch] || []).concat(msg).slice(-100);
      await this.s.storage.put('msgs', all);
      await this.bcCh(ch, { t: 'msg', ch, msg });
    }
    if (m.t === 'del') {
      const ch = String(m.ch || '').slice(0, 60);
      const all = (await this.s.storage.get('msgs')) || {};
      const l = all[ch] || [];
      const i = l.findIndex(x => x.mid === m.mid && x.id === me.id);
      if (i >= 0) { l.splice(i, 1); await this.s.storage.put('msgs', all); await this.bcCh(ch, { t: 'del', ch, mid: m.mid }); }
    }
    if (m.t === 'vjoin') {
      const room = String(m.room || '').slice(0, 60);
      if (!room || !(await this.canSee(me.id, room))) return;
      me.vr = room; me.vm = !!m.muted; me.vd = !!m.deaf; ws.serializeAttachment(me);
      const peers = [];
      for (const x of this.s.getWebSockets()) {
        if (x === ws || x.readyState !== 1) continue;
        const a = x.deserializeAttachment();
        if (a && a.vr === room && a.id !== me.id) peers.push({ id: a.id, name: a.name });
      }
      ws.send(JSON.stringify({ t: 'vpeers', room, peers }));
      await this.vstate();
    }
    if (m.t === 'vleave') {
      delete me.vr; delete me.vm; delete me.vd; ws.serializeAttachment(me);
      await this.vstate();
    }
    if (m.t === 'vmute') {
      if (me.vr) { me.vm = !!m.muted; ws.serializeAttachment(me); await this.vstate(); }
    }
    if (m.t === 'vdeaf') {
      if (me.vr) { me.vd = !!m.deaf; ws.serializeAttachment(me); await this.vstate(); }
    }
    if (m.t === 'vsig') {
      if (!me.vr || !m.data || JSON.stringify(m.data).length > 20000) return;
      for (const x of this.s.getWebSockets()) {
        if (x.readyState !== 1) continue;
        const a = x.deserializeAttachment();
        if (a && a.id === m.to && a.vr === me.vr) { try { x.send(JSON.stringify({ t: 'vsig', from: me.id, data: m.data })); } catch {} }
      }
    }
    if (m.t === 'typing') {
      const ch = String(m.ch || '').slice(0, 60);
      if (await this.canSee(me.id, ch)) {
        for (const x of this.s.getWebSockets()) {
          if (x === ws) continue;
          const a = x.deserializeAttachment();
          if (a && await this.canSee(a.id, ch)) { try { x.send(JSON.stringify({ t: 'typing', ch, name: me.name })); } catch {} }
        }
      }
    }
  }
  async vstate() {
    const rooms = {};
    for (const w of this.s.getWebSockets()) {
      if (w.readyState !== 1) continue;
      const a = w.deserializeAttachment();
      if (a && a.vr) (rooms[a.vr] = rooms[a.vr] || []).push({ id: a.id, name: a.name, m: !!a.vm, d: !!a.vd, p: a.pic || '' });
    }
    for (const w of this.s.getWebSockets()) {
      if (w.readyState !== 1) continue;
      const a = w.deserializeAttachment();
      if (!a) continue;
      const mine = {};
      for (const r of Object.keys(rooms)) { if (await this.canSee(a.id, r)) mine[r] = rooms[r]; }
      try { w.send(JSON.stringify({ t: 'vstate', rooms: mine })); } catch {}
    }
  }
  async canSee(uid, ch) {
    if (!String(ch).startsWith('dg:')) return true;
    const gid = String(ch).slice(3).split('/')[0];
    let set = this.gcache.get(uid);
    if (!set) {
      set = new Set(((await this.s.storage.get('g:' + uid)) || []).map(x => x.id));
      this.gcache.set(uid, set);
    }
    return set.has(gid);
  }
  async bcCh(ch, o) {
    const s = JSON.stringify(o);
    for (const w of this.s.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (a && await this.canSee(a.id, ch)) { try { w.send(s); } catch {} }
    }
  }
  async webSocketClose(ws) { try { ws.close(); } catch {} this.bc({ t: 'online', online: this.users() }); await this.vstate(); }
  async webSocketError() { this.bc({ t: 'online', online: this.users() }); await this.vstate(); }
  users() {
    const o = {};
    for (const w of this.s.getWebSockets()) {
      if (w.readyState !== 1) continue;
      const a = w.deserializeAttachment();
      if (a) o[a.id] = { name: a.name };
    }
    return Object.values(o);
  }
  bc(o) {
    const s = JSON.stringify(o);
    for (const w of this.s.getWebSockets()) {
      if (!w.deserializeAttachment()) continue;
      try { w.send(s); } catch {}
    }
  }
}
