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
    if (req.method === 'POST' && ['/auth/login', '/auth/register', '/auth/check'].includes(u.pathname)) {
      const bad = (msg, s) => new Response(JSON.stringify({ ok: false, msg }), { status: s, headers: { 'Content-Type': 'application/json' } });
      if (Number(req.headers.get('content-length') || 0) > 2048) return bad('İstek çok büyük', 413);
      let b; try { b = await req.json(); } catch { return bad('Geçersiz istek', 400); }
      b.ip = req.headers.get('CF-Connecting-IP') || '';
      return env.HUB.get(env.HUB.idFromName('main')).fetch('https://hub/internal/' + u.pathname.slice(6), { method: 'POST', body: JSON.stringify(b) });
    }
    if (env.ENABLE_DISCORD === '1') {
      if (u.pathname === '/auth/discord/start') return discordStart(u);
      if (u.pathname === '/auth/discord') return discordCallback(req, env, u);
    }
    return new Response('Not found', { status: 404 });
  }
};

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rcode = (n = 6) => [...crypto.getRandomValues(new Uint8Array(n))].map(x => ALPHA[x % ALPHA.length]).join('');
const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

async function pbkdf2(pw, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64u(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, k, 256));
}

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
    if (req.method === 'POST' && ['/internal/login', '/internal/register', '/internal/check'].includes(url.pathname)) return this.authHttp(url.pathname, await req.json());
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
        const nick = await this.s.storage.get('n:' + u.id);
        const name = nick || u.name;
        ws.serializeAttachment({ id: u.id, name, pic: u.picture || '' });
        await this.initUser(u.id, name, u.picture || '');
        const hist0 = (await this.s.storage.get('msgs')) || {};
        const hist = {};
        for (const k of Object.keys(hist0)) { if (await this.canSee(u.id, k)) hist[k] = hist0[k]; }
        const guilds = (await this.s.storage.get('g:' + u.id)) || [];
        ws.send(JSON.stringify({ t: 'ready', hist, online: this.users(), guilds, me: { name }, social: await this.social(u.id) }));
        this.bc({ t: 'online', online: this.users() });
        await this.vstate();
        await this.presence(u.id);
      } catch { ws.send(JSON.stringify({ t: 'error' })); ws.close(1008, 'auth'); }
      return;
    }
    const me = ws.deserializeAttachment();
    if (!me) return;
    if (m.t === 'msg') {
      const text = String(m.text || '').trim().slice(0, 2000);
      const ch = String(m.ch || '').slice(0, 60);
      if (!text || !ch) return;
      if (!(await this.canSee(me.id, ch))) {
        if (ch.startsWith('dm:')) ws.send(JSON.stringify({ t: 'merr', ch, msg: 'Bu kişiye şu an mesaj gönderemezsin' }));
        return;
      }
      const all = (await this.s.storage.get('msgs')) || {};
      const msg = { u: me.name, id: me.id, mid: crypto.randomUUID(), t: text, ts: Date.now() };
      if (m.reply) {
        const rl = (all[ch] || []).find(x => x.mid === m.reply);
        if (rl) msg.r = { mid: rl.mid, u: rl.u, t: rl.au ? '🎤 Sesli mesaj' : String(rl.t).slice(0, 80) };
      }
      const arr = (all[ch] || []).concat(msg);
      const dropped = arr.slice(0, Math.max(0, arr.length - 100));
      all[ch] = arr.slice(-100);
      await this.s.storage.put('msgs', all);
      for (const d of dropped) { if (d.au) await this.s.storage.delete('a:' + d.mid); }
      await this.bcCh(ch, { t: 'msg', ch, msg });
    }
    if (m.t === 'edit') {
      const ch = String(m.ch || '').slice(0, 60);
      const text = String(m.text || '').trim().slice(0, 2000);
      if (!text) return;
      const all = (await this.s.storage.get('msgs')) || {};
      const x = (all[ch] || []).find(y => y.mid === m.mid && y.id === me.id && !y.au);
      if (x) { x.t = text; x.e = true; await this.s.storage.put('msgs', all); await this.bcCh(ch, { t: 'edit', ch, mid: m.mid, text }); }
    }
    if (m.t === 'react') {
      const ch = String(m.ch || '').slice(0, 60);
      const em = String(m.emoji || '').slice(0, 8);
      if (!em || !(await this.canSee(me.id, ch))) return;
      const all = (await this.s.storage.get('msgs')) || {};
      const x = (all[ch] || []).find(y => y.mid === m.mid);
      if (!x) return;
      x.rx = x.rx || {};
      const l = x.rx[em] || [];
      const i = l.indexOf(me.id);
      if (i >= 0) l.splice(i, 1); else l.push(me.id);
      if (l.length) x.rx[em] = l; else delete x.rx[em];
      if (Object.keys(x.rx).length > 20) return;
      await this.s.storage.put('msgs', all);
      await this.bcCh(ch, { t: 'react', ch, mid: m.mid, rx: x.rx });
    }
    if (m.t === 'nick') {
      const name = String(m.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 32);
      if (!name) return;
      await this.s.storage.put('n:' + me.id, name);
      await this.setProfile(me.id, { name });
      await this.presence(me.id);
      for (const x of this.s.getWebSockets()) {
        const a = x.deserializeAttachment();
        if (a && a.id === me.id) { a.name = name; x.serializeAttachment(a); try { x.send(JSON.stringify({ t: 'me', name })); } catch {} }
      }
      this.bc({ t: 'online', online: this.users() });
      await this.vstate();
    }
    if (m.t === 'del') {
      const ch = String(m.ch || '').slice(0, 60);
      const all = (await this.s.storage.get('msgs')) || {};
      const l = all[ch] || [];
      const i = l.findIndex(x => x.mid === m.mid && x.id === me.id);
      if (i >= 0) { const rm = l.splice(i, 1)[0]; if (rm && rm.au) await this.s.storage.delete('a:' + rm.mid); await this.s.storage.put('msgs', all); await this.bcCh(ch, { t: 'del', ch, mid: m.mid }); }
    }
    if (typeof m.t === 'string' && m.t.charAt(0) === 'f') { await this.onFriend(ws, me, m); return; }
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
      await this.presence(me.id);
    }
    if (m.t === 'vleave') {
      delete me.vr; delete me.vm; delete me.vd; ws.serializeAttachment(me);
      await this.vstate();
      await this.presence(me.id);
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
    if (m.t === 'vmsg') {
      const ch = String(m.ch || '').slice(0, 60);
      const data = String(m.data || '');
      const err = msg => ws.send(JSON.stringify({ t: 'merr', ch, msg }));
      if (!ch || !data) return;
      if (data.length > 400000 || !/^[A-Za-z0-9+/=]+$/.test(data)) return err('Sesli mesaj çok uzun ya da bozuk');
      if (!(await this.canSee(me.id, ch))) return err('Buraya sesli mesaj gönderemezsin');
      const mime = /^audio\/(webm|mp4|ogg)/.test(String(m.mime)) ? String(m.mime).split(';')[0] : 'audio/webm';
      const d = Math.min(60, Math.max(1, Math.round(Number(m.dur) || 1)));
      const mid = crypto.randomUUID();
      await this.s.storage.put('a:' + mid, { data, mime, ch });
      const all = (await this.s.storage.get('msgs')) || {};
      const msg = { u: me.name, id: me.id, mid, t: '', au: { d, m: mime }, ts: Date.now() };
      const arr = (all[ch] || []).concat(msg);
      const dropped = arr.slice(0, Math.max(0, arr.length - 100));
      all[ch] = arr.slice(-100);
      await this.s.storage.put('msgs', all);
      for (const x of dropped) { if (x.au) await this.s.storage.delete('a:' + x.mid); }
      await this.bcCh(ch, { t: 'msg', ch, msg });
    }
    if (m.t === 'aud') {
      const mid = String(m.mid || '');
      const rec = await this.s.storage.get('a:' + mid);
      if (!rec || !(await this.canSee(me.id, rec.ch))) return ws.send(JSON.stringify({ t: 'aud', mid, err: 1 }));
      ws.send(JSON.stringify({ t: 'aud', mid, data: rec.data, mime: rec.mime }));
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
  /* ===== KAYIT / GİRİŞ (kullanıcı adı + şifre) ===== */
  async authHttp(path, b) {
    const R = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    const secret = this.env.DISCORD_SECRET;
    if (!secret) return R({ ok: false, msg: 'Sunucu ayarı eksik (DISCORD_SECRET)' }, 500);
    const ip = String(b.ip || '').slice(0, 64) || 'x';
    this.rl = this.rl || new Map();
    const hit = (key, max, ms) => {
      const now = Date.now(), a = (this.rl.get(key) || []).filter(t => now - t < ms);
      if (a.length >= max) { this.rl.set(key, a); return false; }
      a.push(now); this.rl.set(key, a); return true;
    };
    const uname = String(b.username || '').trim(), lower = uname.toLowerCase();
    const st = this.s.storage;
    if (path === '/internal/check') {
      if (!hit('ck:' + ip, 40, 60000)) return R({ ok: false, msg: 'Çok fazla deneme, biraz bekle' }, 429);
      if (!/^[a-z0-9_.]{3,20}$/.test(lower)) return R({ ok: true, free: false, bad: true });
      return R({ ok: true, free: !(await st.get('u:' + lower)) });
    }
    const pw = String(b.password || '');
    if (path === '/internal/register') {
      if (!hit('rg:' + ip, 5, 3600000)) return R({ ok: false, msg: 'Bu bağlantıdan çok fazla kayıt denendi, daha sonra tekrar dene' }, 429);
      if (!/^[A-Za-z0-9_.]{3,20}$/.test(uname)) return R({ ok: false, field: 'username', msg: 'Kullanıcı adı 3-20 karakter olmalı (harf, rakam, _ ve .)' });
      if (pw.length < 8 || pw.length > 100) return R({ ok: false, field: 'password', msg: 'Şifre en az 8 karakter olmalı' });
      if (pw.toLowerCase().includes(lower)) return R({ ok: false, field: 'password', msg: 'Şifre kullanıcı adını içermemeli' });
      if (await st.get('u:' + lower)) return R({ ok: false, field: 'username', msg: 'Bu kullanıcı adı alınmış' });
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = await pbkdf2(pw, salt);
      const id = 'l' + rcode(10).toLowerCase();
      await st.put('u:' + lower, { id, name: uname, salt: b64u(salt), hash, ts: Date.now() });
      return R({ ok: true, token: await sign(secret, { id, name: uname, picture: '' }), name: uname });
    }
    if (path === '/internal/login') {
      if (!hit('li:' + ip, 20, 600000)) return R({ ok: false, msg: 'Çok fazla deneme, birkaç dakika sonra tekrar dene' }, 429);
      const fl = (await st.get('lf:' + lower)) || { n: 0, until: 0 };
      if (fl.until > Date.now()) return R({ ok: false, msg: 'Çok fazla hatalı deneme. 10 dakika sonra tekrar dene.' }, 429);
      const acc = /^[a-z0-9_.]{3,20}$/.test(lower) ? await st.get('u:' + lower) : null;
      const h = await pbkdf2(pw.slice(0, 100), acc ? b64(acc.salt) : new Uint8Array(16));
      if (!acc || !safeEq(h, acc.hash)) {
        if (acc) { fl.n++; if (fl.n >= 5) { fl.until = Date.now() + 600000; fl.n = 0; } await st.put('lf:' + lower, fl); }
        return R({ ok: false, msg: 'Kullanıcı adı ya da şifre hatalı' });
      }
      if (fl.n || fl.until) await st.delete('lf:' + lower);
      return R({ ok: true, token: await sign(secret, { id: acc.id, name: acc.name, picture: '' }), name: acc.name });
    }
    return R({ ok: false }, 404);
  }

  /* ===== ARKADAŞ SİSTEMİ ===== */
  async g(k) { return (await this.s.storage.get(k)) || []; }
  sendTo(uid, o) {
    const s = JSON.stringify(o);
    for (const w of this.s.getWebSockets()) {
      if (w.readyState !== 1) continue;
      const a = w.deserializeAttachment();
      if (a && a.id === uid) { try { w.send(s); } catch {} }
    }
  }
  onlineSet() {
    const set = new Set();
    for (const w of this.s.getWebSockets()) {
      if (w.readyState !== 1) continue;
      const a = w.deserializeAttachment();
      if (a) set.add(a.id);
    }
    return set;
  }
  async setProfile(id, patch) {
    const p = (await this.s.storage.get('p:' + id)) || {};
    await this.s.storage.put('p:' + id, { ...p, ...patch });
  }
  async initUser(id, name, pic) {
    let code = await this.s.storage.get('c:' + id);
    if (!code) {
      for (let i = 0; i < 8 && !code; i++) { const c = rcode(6); if (!(await this.s.storage.get('ci:' + c))) code = c; }
      if (!code) code = rcode(8);
      await this.s.storage.put('c:' + id, code);
      await this.s.storage.put('ci:' + code, id);
    }
    await this.setProfile(id, { name, pic, code });
  }
  async card(id, on) {
    const p = await this.s.storage.get('p:' + id);
    if (!p) return null;
    return { id, name: p.name, pic: p.pic || '', code: p.code || '', on: (on || this.onlineSet()).has(id) };
  }
  roomOf(id) {
    for (const w of this.s.getWebSockets()) {
      if (w.readyState !== 1) continue;
      const a = w.deserializeAttachment();
      if (a && a.id === id && a.vr) return a.vr;
    }
    return '';
  }
  async social(uid) {
    const on = this.onlineSet();
    const mk = async ids => { const out = []; for (const id of ids) { const c = await this.card(id, on); if (c) out.push(c); } return out; };
    const friends = await mk(await this.g('f:' + uid));
    const nn = (await this.s.storage.get('nn:' + uid)) || {};
    for (const c of friends) {
      if (nn[c.id]) c.nick = nn[c.id];
      const room = this.roomOf(c.id);
      if (room && await this.canSee(uid, room)) c.v = room;
    }
    return {
      code: (await this.s.storage.get('c:' + uid)) || '',
      friends,
      incoming: await mk(await this.g('fr:' + uid)),
      outgoing: await mk(await this.g('fo:' + uid)),
      blocked: await mk(await this.g('b:' + uid))
    };
  }
  async pushSocial(uid) {
    if (!this.onlineSet().has(uid)) return;
    this.sendTo(uid, { t: 'social', ...(await this.social(uid)) });
  }
  async presence(uid) {
    for (const f of await this.g('f:' + uid)) await this.pushSocial(f);
  }
  async pull(key, id) { await this.s.storage.put(key, (await this.g(key)).filter(x => x !== id)); }
  async unrelate(a, b) {
    for (const [x, y] of [[a, b], [b, a]]) {
      await this.pull('f:' + x, y); await this.pull('fr:' + x, y); await this.pull('fo:' + x, y);
    }
  }
  async befriend(a, b) {
    for (const [x, y] of [[a, b], [b, a]]) {
      const l = await this.g('f:' + x);
      if (!l.includes(y)) { l.push(y); await this.s.storage.put('f:' + x, l); }
      await this.pull('fr:' + x, y); await this.pull('fo:' + x, y);
    }
    await this.pushSocial(a); await this.pushSocial(b);
    this.sendTo(a, { t: 'fnew', from: await this.card(b) });
    this.sendTo(b, { t: 'fnew', from: await this.card(a) });
  }
  async onFriend(ws, me, m) {
    const st = this.s.storage, t = m.t;
    const reply = (type, o) => ws.send(JSON.stringify({ t: type, ...o }));
    const target = async () => {
      if (m.id) return String(m.id).slice(0, 40);
      if (m.code) return (await st.get('ci:' + normCode(m.code))) || null;
      return null;
    };
    if (t === 'fsearch') {
      const q = String(m.q || '').trim().slice(0, 40);
      if (q.length < 2) return reply('fsearch', { q, list: [] });
      const ids = new Set();
      const byCode = await st.get('ci:' + normCode(q));
      if (byCode) ids.add(byCode);
      const ql = q.toLowerCase().replace(/^@/, '');
      const all = await st.list({ prefix: 'p:', limit: 1000 });
      for (const [k, p] of all) { if (ids.size >= 20) break; if (p && String(p.name).toLowerCase().includes(ql)) ids.add(k.slice(2)); }
      const list = [];
      for (const id of ids) {
        if (id === me.id) continue;
        if ((await this.g('b:' + id)).includes(me.id)) continue;
        const c = await this.card(id);
        if (c) list.push(c);
      }
      return reply('fsearch', { q, list });
    }
    if (t === 'fadd') {
      const tid = await target();
      const fail = msg => reply('fres', { ok: false, msg, id: tid });
      if (!tid || !(await st.get('p:' + tid))) return fail('Kullanıcı bulunamadı');
      if (tid === me.id) return fail('Kendine arkadaşlık isteği gönderemezsin');
      if ((await this.g('b:' + tid)).includes(me.id)) return fail('İstek gönderilemedi');
      if ((await this.g('b:' + me.id)).includes(tid)) return fail('Önce bu kullanıcının engelini kaldırmalısın');
      if ((await this.g('f:' + me.id)).includes(tid)) return fail('Zaten arkadaşsınız');
      if ((await this.g('fo:' + me.id)).includes(tid)) return fail('Bu kişiye zaten istek gönderdin');
      if ((await this.g('fr:' + me.id)).includes(tid)) { await this.befriend(me.id, tid); return reply('fres', { ok: true, msg: 'Arkadaş oldunuz 🎉', id: tid }); }
      const dts = await st.get('fd:' + tid + ':' + me.id);
      if (dts && Date.now() - dts < 864e5) return fail('Bu kullanıcıya şu an tekrar istek gönderemezsin');
      const outs = await this.g('fo:' + me.id);
      if (outs.length >= 50) return fail('Çok fazla bekleyen isteğin var');
      outs.push(tid); await st.put('fo:' + me.id, outs);
      const ins = await this.g('fr:' + tid);
      if (!ins.includes(me.id)) { ins.push(me.id); await st.put('fr:' + tid, ins); }
      await this.pushSocial(me.id); await this.pushSocial(tid);
      this.sendTo(tid, { t: 'freq', from: await this.card(me.id) });
      return reply('fres', { ok: true, msg: 'Arkadaşlık isteği gönderildi', id: tid });
    }
    const id = String(m.id || '').slice(0, 40);
    if (t === 'faccept') {
      if ((await this.g('fr:' + me.id)).includes(id)) await this.befriend(me.id, id);
    }
    else if (t === 'fdecline') {
      if (!(await this.g('fr:' + me.id)).includes(id)) return;
      await this.pull('fr:' + me.id, id); await this.pull('fo:' + id, me.id);
      await st.put('fd:' + me.id + ':' + id, Date.now());
      await this.pushSocial(me.id); await this.pushSocial(id);
    }
    else if (t === 'fcancel') {
      await this.pull('fo:' + me.id, id); await this.pull('fr:' + id, me.id);
      await this.pushSocial(me.id); await this.pushSocial(id);
    }
    else if (t === 'fremove') {
      await this.unrelate(me.id, id);
      await this.pushSocial(me.id); await this.pushSocial(id);
    }
    else if (t === 'fblock') {
      if (!id || id === me.id || !(await st.get('p:' + id))) return;
      await this.unrelate(me.id, id);
      const b = await this.g('b:' + me.id);
      if (!b.includes(id)) { b.push(id); await st.put('b:' + me.id, b.slice(-200)); }
      await this.pushSocial(me.id); await this.pushSocial(id);
    }
    else if (t === 'funblock') {
      await this.pull('b:' + me.id, id);
      await this.pushSocial(me.id);
    }
    else if (t === 'freport') {
      if (!id || id === me.id) return;
      const rp = await this.g('rp');
      rp.push({ by: me.id, target: id, reason: String(m.reason || '').slice(0, 60), ts: Date.now() });
      await st.put('rp', rp.slice(-200));
      reply('frep', { ok: true });
    }
    else if (t === 'fring') {
      const fail = msg => reply('fringr', { ok: false, msg, id });
      if (!(await this.g('f:' + me.id)).includes(id)) return fail('Bu kişi arkadaşın değil');
      if ((await this.g('b:' + id)).includes(me.id) || (await this.g('b:' + me.id)).includes(id)) return fail('Arama yapılamıyor');
      if (!this.onlineSet().has(id)) return fail('Arkadaşın çevrimdışı');
      const room = 'dm:' + [me.id, id].sort().join(':') + '/call';
      if (me.vr !== room) return fail('Arama başlatılamadı');
      this.ring = this.ring || new Map();
      const k = me.id + '>' + id, now = Date.now();
      if (now - (this.ring.get(k) || 0) < 8000) return fail('Biraz bekleyip tekrar ara');
      this.ring.set(k, now);
      this.sendTo(id, { t: 'ring', from: await this.card(me.id), room });
      reply('fringr', { ok: true, id });
    }
    else if (t === 'fringx') {
      if ((await this.g('f:' + me.id)).includes(id)) this.sendTo(id, { t: 'ringx', from: await this.card(me.id), why: m.why === 'decline' ? 'decline' : 'cancel' });
    }
    else if (t === 'fnick') {
      if (!(await this.g('f:' + me.id)).includes(id)) return;
      const nick = String(m.nick || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 32);
      const nn = (await st.get('nn:' + me.id)) || {};
      if (nick) nn[id] = nick; else delete nn[id];
      await st.put('nn:' + me.id, nn);
      await this.pushSocial(me.id);
    }
    else if (t === 'finvite') {
      const fail = msg => reply('finv', { ok: false, msg, id });
      if (!me.vr) return fail('Önce bir sesli odaya katılmalısın');
      if (!(await this.g('f:' + me.id)).includes(id)) return fail('Bu kişi arkadaşın değil');
      if ((await this.g('b:' + id)).includes(me.id) || (await this.g('b:' + me.id)).includes(id)) return fail('Davet gönderilemedi');
      if (!this.onlineSet().has(id)) return fail('Arkadaşın çevrimdışı');
      if (this.roomOf(id) === me.vr) return fail('Arkadaşın zaten bu odada');
      if (!(await this.canSee(id, me.vr))) return fail('Arkadaşın bu odaya giremez');
      this.inv = this.inv || new Map();
      const k = me.id + '>' + id, now = Date.now();
      if (now - (this.inv.get(k) || 0) < 20000) return fail('Biraz bekleyip tekrar davet et');
      this.inv.set(k, now);
      this.sendTo(id, { t: 'vinv', from: await this.card(me.id), room: me.vr });
      reply('finv', { ok: true, msg: 'Davet gönderildi', id });
    }
    else if (t === 'fprof') {
      if ((await this.g('b:' + id)).includes(me.id)) return reply('fprof', { id, none: true });
      const c = await this.card(id);
      if (!c) return reply('fprof', { id, none: true });
      const mine = await this.g('f:' + me.id), theirs = await this.g('f:' + id);
      const mu = mine.filter(x => x !== id && theirs.includes(x));
      const mn = [];
      for (const x of mu.slice(0, 3)) { const q = await this.card(x); if (q) mn.push(q.name); }
      reply('fprof', { ...c, mc: mu.length, mn });
    }
  }

  async canSee(uid, ch) {
    ch = String(ch);
    if (ch.startsWith('dm:')) {
      const [a, b0] = ch.slice(3).split(':');
      const b = String(b0 || '').split('/')[0];
      if (!a || !b || (uid !== a && uid !== b)) return false;
      const o = uid === a ? b : a;
      if (!(((await this.s.storage.get('f:' + uid)) || []).includes(o))) return false;
      if (((await this.s.storage.get('b:' + uid)) || []).includes(o)) return false;
      if (((await this.s.storage.get('b:' + o)) || []).includes(uid)) return false;
      return true;
    }
    if (!ch.startsWith('dg:')) return true;
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
  async webSocketClose(ws) {
    let a = null; try { a = ws.deserializeAttachment(); } catch {}
    try { ws.close(); } catch {}
    this.bc({ t: 'online', online: this.users() });
    await this.vstate();
    if (a) await this.presence(a.id);
  }
  async webSocketError(ws) { await this.webSocketClose(ws); }
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
