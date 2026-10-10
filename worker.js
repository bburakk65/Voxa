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

const ADMIN_UNAMES = new Set(['voxaadmin']);
async function pbkdf2(pw, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64u(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, k, 256));
}

export class Hub {
  constructor(state, env) { this.s = state; this.env = env; this.gcache = new Map(); this.msgDeleteQueue = Promise.resolve(); }
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
    // Beklenmedik büyük/yanlış formatlı WS paketlerinin CPU ve belleği tüketmesini engelle.
    if (typeof raw !== 'string' || raw.length > 500000) {
      try { ws.send(JSON.stringify({ t: 'error', msg: 'İstek çok büyük veya geçersiz' })); } catch {}
      return;
    }
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return;
    if (m.t === 'auth') {
      try {
        const secret = this.env.DISCORD_SECRET;
        if (!secret || !String(m.token).startsWith('v1.')) throw new Error('auth');
        const u = await unsign(secret, m.token);
        const ban = await this.s.storage.get('ban:' + u.id);
        if (ban) { ws.send(JSON.stringify({ t: 'error', msg: 'Bu hesap yasaklandı' + (ban.reason ? ': ' + ban.reason : '') })); ws.close(4003, 'banned'); return; }
        const nick = await this.s.storage.get('n:' + u.id);
        const name = nick || u.name;
        const { admin, mainAdmin } = await this.adminFlags(u.id);
        ws.serializeAttachment({ id: u.id, name, pic: u.picture || '', admin, mainAdmin });
        await this.initUser(u.id, name, u.picture || '');
        await this.setProfile(u.id, { admin });
        const hist0 = (await this.s.storage.get('msgs')) || {};
        const hist = {};
        for (const k of Object.keys(hist0)) { if (await this.canSee(u.id, k)) hist[k] = hist0[k]; }
        const guilds = (await this.s.storage.get('g:' + u.id)) || [];
        ws.send(JSON.stringify({ t: 'ready', hist, online: this.users(), guilds, servers: await this.guildsOf(u.id), me: { name, admin, mainAdmin }, social: await this.social(u.id) }));
        this.bc({ t: 'online', online: this.users() });
        await this.vstate();
        await this.presence(u.id);
      } catch { ws.send(JSON.stringify({ t: 'error' })); ws.close(1008, 'auth'); }
      return;
    }
    const me = ws.deserializeAttachment();
    if (!me) return;
    if (m.t === 'hist') {
      const ch = String(m.ch || '').slice(0, 80);
      if (!ch || !(await this.canSee(me.id, ch))) return;
      const all0 = (await this.s.storage.get('msgs')) || {};
      ws.send(JSON.stringify({ t: 'hist', ch, msgs: all0[ch] || [] }));
    }
    if (m.t === 'msg') {
      const text = String(m.text || '').trim().slice(0, 2000);
      const ch = String(m.ch || '').slice(0, 60);
      if (!text || !ch) return;
      if (!(await this.rateHit('msg:' + me.id, 25, 10000))) {
        ws.send(JSON.stringify({ t: 'merr', ch, msg: 'Çok hızlı mesaj gönderiyorsun. Birkaç saniye bekle.' }));
        return;
      }
      const muteUntil = await this.s.storage.get('mute:' + me.id);
      if (muteUntil && muteUntil > Date.now()) { ws.send(JSON.stringify({ t: 'merr', ch, msg: 'Susturuldun, ' + Math.ceil((muteUntil - Date.now()) / 60000) + ' dk sonra tekrar yazabilirsin' })); return; }
      if (!(await this.canSee(me.id, ch))) {
        if (ch.startsWith('dm:')) ws.send(JSON.stringify({ t: 'merr', ch, msg: 'Bu kişiye şu an mesaj gönderemezsin' }));
        return;
      }
      const all = (await this.s.storage.get('msgs')) || {};
      const msg = { u: me.name, id: me.id, mid: crypto.randomUUID(), t: text, ts: Date.now() };
      if (me.admin) msg.adm = 1;
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
      const mid = String(m.mid || '').slice(0, 80);
      const text = String(m.text || '').trim().slice(0, 2000);
      if (!ch || !mid || !text || !(await this.canSee(me.id, ch))) return;
      if (!(await this.rateHit('edit:' + me.id, 30, 10000))) return;
      const all = (await this.s.storage.get('msgs')) || {};
      const x = (Array.isArray(all[ch]) ? all[ch] : []).find(y => y && y.mid === mid && y.id === me.id && !y.au);
      if (x) { x.t = text; x.e = true; await this.s.storage.put('msgs', all); await this.bcCh(ch, { t: 'edit', ch, mid, text }); }
    }
    if (m.t === 'react') {
      const ch = String(m.ch || '').slice(0, 60);
      const em = String(m.emoji || '').slice(0, 8);
      if (!em || !(await this.canSee(me.id, ch))) return;
      if (!(await this.rateHit('react:' + me.id, 60, 10000))) return;
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
        if (a && a.id === me.id) { a.name = name; x.serializeAttachment(a); try { x.send(JSON.stringify({ t: 'me', name, admin: !!a.admin, mainAdmin: !!a.mainAdmin })); } catch {} }
      }
      this.bc({ t: 'online', online: this.users() });
      await this.vstate();
    }
    if (m.t === 'del') {
      const ch = String(m.ch || '').slice(0, 60);
      const mid = String(m.mid || '').slice(0, 80);
      if (!ch || !mid || !(await this.canSee(me.id, ch))) return;
      const all = (await this.s.storage.get('msgs')) || {};
      const l = Array.isArray(all[ch]) ? all[ch] : [];
      const i = l.findIndex(x => x && x.mid === mid && x.id === me.id);
      if (i >= 0) { const rm = l.splice(i, 1)[0]; if (rm && rm.au) await this.s.storage.delete('a:' + rm.mid); await this.s.storage.put('msgs', all); await this.bcCh(ch, { t: 'del', ch, mid }); }
    }
    if (typeof m.t === 'string' && m.t.charAt(0) === 'f') { await this.onFriend(ws, me, m); return; }
    if (typeof m.t === 'string' && m.t.slice(0, 2) === 'sv') { await this.onGuild(ws, me, m); return; }
    if (typeof m.t === 'string' && m.t.slice(0, 2) === 'ad') { await this.onAdmin(ws, me, m); return; }
    if (m.t === 'vjoin') {
      const room = String(m.room || '').slice(0, 60);
      if (!room || !(await this.canSee(me.id, room))) return;
      const muteUntilJ = await this.s.storage.get('mute:' + me.id);
      if (muteUntilJ && muteUntilJ > Date.now()) { ws.send(JSON.stringify({ t: 'merr', ch: room, msg: 'Susturuldun, sesli odaya giremezsin' })); return; }
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
    if (m.t === 'vstream_start') {
      if (me.vr) { me.vss = true; ws.serializeAttachment(me); await this.vstate(); }
    }
    if (m.t === 'vstream_stop') {
      if (me.vr) { delete me.vss; ws.serializeAttachment(me); await this.vstate(); }
    }
    if (m.t === 'vsig') {
      if (!me.vr || !m.data || JSON.stringify(m.data).length > 20000) return;
      if (!(await this.rateHit('vsig:' + me.id, 60, 10000))) return;
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
      if (!(await this.rateHit('vmsg:' + me.id, 8, 60000))) return err('Çok fazla sesli mesaj gönderdin, biraz bekle');
      const muteUntilV = await this.s.storage.get('mute:' + me.id);
      if (muteUntilV && muteUntilV > Date.now()) return err('Susturuldun, sesli mesaj gönderemezsin');
      if (data.length > 400000 || !/^[A-Za-z0-9+/=]+$/.test(data)) return err('Sesli mesaj çok uzun ya da bozuk');
      if (!(await this.canSee(me.id, ch))) return err('Buraya sesli mesaj gönderemezsin');
      const mime = /^audio\/(webm|mp4|ogg)/.test(String(m.mime)) ? String(m.mime).split(';')[0] : 'audio/webm';
      const d = Math.min(60, Math.max(1, Math.round(Number(m.dur) || 1)));
      const mid = crypto.randomUUID();
      await this.s.storage.put('a:' + mid, { data, mime, ch });
      const all = (await this.s.storage.get('msgs')) || {};
      const msg = { u: me.name, id: me.id, mid, t: '', au: { d, m: mime }, ts: Date.now() };
      if (me.admin) msg.adm = 1;
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
    if (m.t === 'reportmsg') {
      const ch = String(m.ch || '').slice(0, 80);
      const mid = String(m.mid || '');
      const fail = msg => ws.send(JSON.stringify({ t: 'reportmsg', ok: false, msg }));
      if (!ch || !mid) return;
      if (ch.startsWith('dm:')) return fail('Özel mesajlar şikayet edilemez, kişiyi engelleyebilirsin');
      if (!(await this.canSee(me.id, ch))) return;
      if (!(await this.rateHit('rpm:' + me.id, 20, 3600000))) return fail('Çok fazla şikayet, biraz bekle');
      const all = (await this.s.storage.get('msgs')) || {};
      const msg = (all[ch] || []).find(x => x.mid === mid);
      if (!msg) return fail('Mesaj bulunamadı');
      const reports = await this.g('msgreports');
      if (reports.some(r => r.mid === mid && r.by === me.id)) return fail('Bu mesajı zaten şikayet ettin');
      reports.push({
        id: crypto.randomUUID(), ts: Date.now(), by: me.id, byName: me.name,
        reason: String(m.reason || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 120),
        ch, mid, sender: msg.u, senderId: msg.id, snippet: msg.au ? '[Sesli mesaj]' : String(msg.t || '').slice(0, 200)
      });
      await this.s.storage.put('msgreports', reports.slice(-500));
      ws.send(JSON.stringify({ t: 'reportmsg', ok: true }));
    }
    if (m.t === 'typing') {
      const ch = String(m.ch || '').slice(0, 60);
      if (!(await this.rateHit('typing:' + me.id, 12, 5000))) return;
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
      if (a && a.vr) (rooms[a.vr] = rooms[a.vr] || []).push({ id: a.id, name: a.name, m: !!a.vm, d: !!a.vd, ss: !!a.vss, p: a.pic || '' });
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
      if (pw.length < 8 || pw.length > 100) return R({ ok: false, field: 'password', msg: 'Şifre 8-100 karakter olmalı' });
      if (pw.toLowerCase().includes(lower)) return R({ ok: false, field: 'password', msg: 'Şifre kullanıcı adını içermemeli' });
      // Ana yönetici hesabının ilk kaydını herkesin kapmasını engelle.
      // İlk kurulum için Cloudflare Worker'da ADMIN_SETUP_KEY secret'ı tanımlanmalıdır.
      if (ADMIN_UNAMES.has(lower)) {
        const expectedSetupKey = String(this.env.ADMIN_SETUP_KEY || '');
        const suppliedSetupKey = String(b.adminSetupKey || '');
        if (!expectedSetupKey || !safeEq(suppliedSetupKey, expectedSetupKey)) {
          return R({ ok: false, field: 'username', msg: 'Bu yönetici adı yalnızca kurulum anahtarıyla ilk kez oluşturulabilir. Cloudflare ADMIN_SETUP_KEY ayarını kontrol et.' });
        }
      }
      if (await st.get('u:' + lower)) return R({ ok: false, field: 'username', msg: 'Bu kullanıcı adı alınmış' });
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = await pbkdf2(pw, salt);
      const id = 'l' + rcode(10).toLowerCase();
      await st.put('u:' + lower, { id, name: uname, salt: b64u(salt), hash, ts: Date.now() });
      return R({ ok: true, token: await sign(secret, { id, name: uname, picture: '', admin: ADMIN_UNAMES.has(lower) }), name: uname });
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
      const ban = await st.get('ban:' + acc.id);
      if (ban) return R({ ok: false, msg: 'Bu hesap yasaklandı' + (ban.reason ? ': ' + ban.reason : '') });
      return R({ ok: true, token: await sign(secret, { id: acc.id, name: acc.name, picture: '', admin: ADMIN_UNAMES.has(lower) }), name: acc.name });
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
    return { id, name: p.name, pic: p.pic || '', code: p.code || '', on: (on || this.onlineSet()).has(id), admin: !!p.admin };
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

  /* ===== SUNUCU / KANAL / ROL SİSTEMİ ===== */
  async rateHit(key, max, ms) {
    this.rl = this.rl || new Map();
    const now = Date.now(), a = (this.rl.get(key) || []).filter(t => now - t < ms);
    if (a.length >= max) { this.rl.set(key, a); return false; }
    a.push(now); this.rl.set(key, a); return true;
  }
  isGuildAdmin(sv, uid) {
    if (sv.owner === uid) return true;
    const mem = sv.members.find(x => x.id === uid);
    if (mem && (mem.roles || []).some(rid => (sv.roles.find(r => r.id === rid) || {}).admin)) return true;
    return false;
  }
  async canManage(sv, me) {
    if (me.admin) return true;
    return this.isGuildAdmin(sv, me.id);
  }
  async guildsOf(uid) {
    const ids = await this.g('ug:' + uid);
    const out = [];
    for (const gid of ids) {
      const sv = await this.s.storage.get('sv:' + gid);
      if (!sv) continue;
      const mem = sv.members.find(x => x.id === uid);
      if (!mem) continue;
      const admin = this.isGuildAdmin(sv, uid);
      const channels = sv.channels
        .filter(c => admin || !c.roles || !c.roles.length || (mem.roles || []).some(rid => c.roles.includes(rid)))
        .map(c => ({ name: c.name, kind: c.kind, roles: c.roles || [] }));
      out.push({
        id: sv.id, name: sv.name, icon: sv.icon || '', owner: sv.owner === uid, admin,
        myRoles: mem.roles || [],
        roles: sv.roles.map(r => ({ id: r.id, name: r.name, color: r.color, admin: !!r.admin })),
        channels, memberCount: sv.members.length
      });
    }
    return out;
  }
  async pushGuildsTo(uid) { this.sendTo(uid, { t: 'svservers', list: await this.guildsOf(uid) }); }
  async broadcastGuild(gid) {
    const sv = await this.s.storage.get('sv:' + gid);
    if (!sv) return;
    for (const mm of sv.members) await this.pushGuildsTo(mm.id);
  }
  async deleteGuild(sv) {
    const st = this.s.storage;
    const all = (await st.get('msgs')) || {};
    for (const c of sv.channels) {
      const ck = 'sv:' + sv.id + '/' + c.name;
      for (const x of all[ck] || []) { if (x.au) await st.delete('a:' + x.mid); }
      delete all[ck];
    }
    await st.put('msgs', all);
    for (const inv of sv.invites) await st.delete('svi:' + inv.code);
    const members = sv.members.slice();
    await st.delete('sv:' + sv.id);
    for (const mm of members) await st.put('ug:' + mm.id, (await this.g('ug:' + mm.id)).filter(x => x !== sv.id));
    const prefix = 'sv:' + sv.id + '/';
    for (const w of this.s.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (a && a.vr && a.vr.startsWith(prefix)) { delete a.vr; delete a.vm; delete a.vd; delete a.vss; w.serializeAttachment(a); }
    }
    await this.vstate();
    for (const mm of members) await this.pushGuildsTo(mm.id);
  }
  async adminFlags(uid) {
    const mainAcc = await this.s.storage.get('u:voxaadmin');
    const mainAdmin = !!(mainAcc && mainAcc.id === uid);
    const promoted = (await this.g('admins')).includes(uid);
    return { admin: mainAdmin || promoted, mainAdmin };
  }
  async updateAdminFlags(uid) {
    const flags = await this.adminFlags(uid);
    for (const w of this.s.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (a && a.id === uid) {
        a.admin = flags.admin; a.mainAdmin = flags.mainAdmin;
        w.serializeAttachment(a);
        try { w.send(JSON.stringify({ t: 'me', name: a.name, admin: flags.admin, mainAdmin: flags.mainAdmin })); } catch {}
      }
    }
    return flags;
  }
  async notifyMod(uid, muteUntil, banned) {
    for (const w of this.s.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (a && a.id === uid) { try { w.send(JSON.stringify({ t: 'modstate', muted: muteUntil || 0, banned: !!banned })); } catch {} }
    }
  }
  async logAdmin(action, by, target, ok, msg) {
    const log = await this.g('adlog');
    log.push({ ts: Date.now(), action, by: by ? { id: by.id, name: by.name } : null, target: target || null, ok: !!ok, msg: msg || '' });
    const recent = log.slice(-200);
    await this.s.storage.put('adlog', recent);
    // Yönetim panelini açık tutan tüm adminlere işlem geçmişi ve sayaçları anında gönder.
    const users = await this.s.storage.list({ prefix: 'u:', limit: 2000 });
    const servers = await this.s.storage.list({ prefix: 'sv:', limit: 2000 });
    const msgs = (await this.s.storage.get('msgs')) || {};
    let messages = 0;
    for (const k of Object.keys(msgs)) messages += Array.isArray(msgs[k]) ? msgs[k].length : 0;
    const stats = { t: 'adstats', users: users.size, servers: servers.size, online: this.onlineSet().size, messages };
    for (const w of this.s.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (!a || !a.admin) continue;
      try {
        w.send(JSON.stringify(stats));
        w.send(JSON.stringify({ t: 'adlogs', list: recent.slice().reverse() }));
      } catch {}
    }
  }
  async onAdmin(ws, me, m) {
    const t = m.t, st = this.s.storage;
    const reply = (type, o) => ws.send(JSON.stringify({ t: type, ...o }));
    if (t !== 'adadmins' && t !== 'adpromote' && t !== 'addemote' && !me.admin) return;
    if (t === 'adstats') {
      const users = await st.list({ prefix: 'u:', limit: 2000 });
      const servers = await st.list({ prefix: 'sv:', limit: 2000 });
      const msgs = (await st.get('msgs')) || {};
      let messages = 0; for (const k in msgs) messages += (msgs[k] || []).length;
      reply('adstats', { users: users.size, servers: servers.size, online: this.onlineSet().size, messages });
    }
    else if (t === 'adusers') {
      const q = String(m.q || '').toLowerCase().trim();
      const rows = await st.list({ prefix: 'u:', limit: 2000 });
      const on = this.onlineSet();
      const promotedAdmins = new Set(await this.g('admins'));
      const list = [];
      for (const [k, acc] of rows) {
        if (q && !String(acc.name).toLowerCase().includes(q)) continue;
        const uname = k.slice(2);
        const muteUntil = await st.get('mute:' + acc.id);
        const banRec = await st.get('ban:' + acc.id);
        list.push({
          id: acc.id, name: acc.name, uname, ts: acc.ts || 0, on: on.has(acc.id), admin: ADMIN_UNAMES.has(uname) || promotedAdmins.has(acc.id),
          muted: !!(muteUntil && muteUntil > Date.now()) ? muteUntil : 0,
          banned: !!banRec
        });
      }
      list.sort((a, b) => b.ts - a.ts);
      reply('adusers', { list: list.slice(0, 300), total: list.length });
    }
    else if (t === 'admute') {
      const uname = String(m.uname || '').toLowerCase().trim();
      const fail = async msg => { reply('admute', { ok: false, msg, uname }); await this.logAdmin('mute', me, { uname }, false, msg); };
      const acc = await st.get('u:' + uname);
      if (!acc) return fail('Kullanıcı bulunamadı');
      if (ADMIN_UNAMES.has(uname) || (await this.g('admins')).includes(acc.id)) return fail('Admin susturulamaz');
      const ms = Math.min(7 * 86400000, Math.max(60000, Math.round(Number(m.ms) || 0)));
      const until = Date.now() + ms;
      await st.put('mute:' + acc.id, until);
      await this.logAdmin('mute', me, { id: acc.id, name: acc.name, uname }, true, Math.round(ms / 60000) + ' dk');
      await this.notifyMod(acc.id, until, !!(await st.get('ban:' + acc.id)));
      reply('admute', { ok: true, uname, until });
    }
    else if (t === 'adunmute') {
      const uname = String(m.uname || '').toLowerCase().trim();
      const acc = await st.get('u:' + uname);
      if (!acc) return reply('adunmute', { ok: false, msg: 'Kullanıcı bulunamadı', uname });
      await st.delete('mute:' + acc.id);
      await this.logAdmin('unmute', me, { id: acc.id, name: acc.name, uname }, true, '');
      await this.notifyMod(acc.id, 0, !!(await st.get('ban:' + acc.id)));
      reply('adunmute', { ok: true, uname });
    }
    else if (t === 'adban') {
      const uname = String(m.uname || '').toLowerCase().trim();
      const fail = async msg => { reply('adban', { ok: false, msg, uname }); await this.logAdmin('ban', me, { uname }, false, msg); };
      const acc = await st.get('u:' + uname);
      if (!acc) return fail('Kullanıcı bulunamadı');
      if (ADMIN_UNAMES.has(uname) || (await this.g('admins')).includes(acc.id)) return fail('Admin yasaklanamaz');
      const reason = String(m.reason || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 120);
      await st.put('ban:' + acc.id, { ts: Date.now(), by: me.id, byName: me.name, reason });
      await this.logAdmin('ban', me, { id: acc.id, name: acc.name, uname }, true, reason);
      for (const w of this.s.getWebSockets()) {
        const a = w.deserializeAttachment();
        if (a && a.id === acc.id) { try { w.send(JSON.stringify({ t: 'error', msg: 'Bu hesap yasaklandı' + (reason ? ': ' + reason : '') })); w.close(4003, 'banned'); } catch {} }
      }
      reply('adban', { ok: true, uname });
    }
    else if (t === 'adunban') {
      const uname = String(m.uname || '').toLowerCase().trim();
      const acc = await st.get('u:' + uname);
      if (!acc) return reply('adunban', { ok: false, msg: 'Kullanıcı bulunamadı', uname });
      await st.delete('ban:' + acc.id);
      await this.logAdmin('unban', me, { id: acc.id, name: acc.name, uname }, true, '');
      reply('adunban', { ok: true, uname });
    }
    else if (t === 'admsgchannels') {
      const all = (await st.get('msgs')) || {};
      const channels = Object.keys(all).filter(ch => !ch.startsWith('dm:') && Array.isArray(all[ch]) && all[ch].length > 0);
      reply('admsgchannels', { channels });
    }
    else if (t === 'admsgs') {
      const ch = String(m.ch || '').slice(0, 80);
      if (!ch) return;
      if (ch.startsWith('dm:')) return reply('admsgs', { ok: false, msg: 'Özel mesajlar buradan görüntülenemez', ch });
      const all = (await st.get('msgs')) || {};
      let list = all[ch] || [];
      const q = String(m.q || '').toLowerCase().trim();
      if (q) list = list.filter(x => String(x.u).toLowerCase().includes(q) || String(x.t || '').toLowerCase().includes(q));
      reply('admsgs', { ok: true, ch, list: list.slice(-300), total: (all[ch] || []).length });
    }
    else if (t === 'admsgclearall') {
      if (!me.admin) return reply('admsgclearall', { ok: false, msg: 'Bu işlem için yönetici yetkisi gerekli' });
      const all = (await st.get('msgs')) || {};
      let removedCount = 0;
      for (const key of Object.keys(all)) {
        const list = Array.isArray(all[key]) ? all[key] : [];
        removedCount += list.length;
        for (const item of list) if (item && item.au && item.mid) await st.delete('a:' + item.mid);
        all[key] = [];
        await this.bcCh(key, { t: 'clear', ch: key });
      }
      // Remove the whole message map so empty channel arrays cannot leave stale dashboard counts.
      await st.put('msgs', {});
      reply('admsgclearall', { ok: true, messages: 0, removed: removedCount });
      await this.logAdmin('msgclearall', me, { ch: 'all' }, true, removedCount + ' mesaj temizlendi');
    }
    else if (t === 'admsgdel') {
      // Serialize admin deletions: rapid consecutive clicks must not overwrite each other's storage updates.
      const runDelete = async () => {
        const ch = String(m.ch || '').slice(0, 80);
        const mid = String(m.mid || '').slice(0, 80);
        const fail = msg => reply('admsgdel', { ok: false, msg, mid, ch });
        if (!me.admin) return fail('Bu işlem için yönetici yetkisi gerekli');
        if (!ch || !mid) return fail('Kanal veya mesaj bilgisi eksik');
        if (ch.startsWith('dm:')) return fail('Özel mesajlar buradan silinemez');
        const all = (await st.get('msgs')) || {};
        const list = Array.isArray(all[ch]) ? all[ch] : [];
        const i = list.findIndex(x => x && String(x.mid) === mid);
        if (i < 0) {
          let messages = 0;
          for (const key of Object.keys(all)) messages += Array.isArray(all[key]) ? all[key].length : 0;
          return reply('admsgdel', { ok: false, msg: 'Mesaj bulunamadı; liste ve sayaç yenilendi', mid, ch, messages });
        }
        const removed = list[i];
        all[ch] = list.filter(x => x && String(x.mid) !== mid);
        if (removed.au) await st.delete('a:' + removed.mid);
        await st.put('msgs', all);
        await this.bcCh(ch, { t: 'del', ch, mid });
        let totalMessages = 0;
        for (const key of Object.keys(all)) totalMessages += Array.isArray(all[key]) ? all[key].length : 0;
        // Reply with the persisted total before logging; the client can update the counter immediately.
        reply('admsgdel', { ok: true, mid, ch, total: all[ch].length, messages: totalMessages });
        await this.logAdmin('msgdel', me, { mid, ch, sender: removed.u }, true, String(m.reason || '').slice(0, 120));
      };
      const task = this.msgDeleteQueue.then(runDelete, runDelete);
      this.msgDeleteQueue = task.catch(() => {});
      await task;
    }
    else if (t === 'adreports') {
      const list = (await this.g('msgreports')).slice(-200).reverse();
      reply('adreports', { list });
    }
    else if (t === 'adreportclear') {
      const id = String(m.id || '');
      const reports = await this.g('msgreports');
      await this.s.storage.put('msgreports', reports.filter(r => r.id !== id));
      await this.logAdmin('reportclear', me, { id }, true, '');
      reply('adreportclear', { ok: true, id });
    }
    else if (t === 'aduserdel') {
      const uname = String(m.uname || '').toLowerCase().trim();
      const fail = msg => reply('aduserdel', { ok: false, msg, uname });
      if (ADMIN_UNAMES.has(uname)) return fail('Admin hesabı silinemez');
      const acc = await st.get('u:' + uname);
      if (!acc) return fail('Kullanıcı bulunamadı');
      const uid = acc.id;
      if ((await this.g('admins')).includes(uid)) return fail('Önce bu kullanıcının admin yetkisini kaldırmalısın');
      for (const w of this.s.getWebSockets()) {
        const a = w.deserializeAttachment();
        if (a && a.id === uid) { try { w.close(4001, 'account deleted'); } catch {} }
      }
      const touched = new Set();
      for (const fid of await this.g('f:' + uid)) { await this.pull('f:' + fid, uid); touched.add(fid); }
      for (const fid of await this.g('fr:' + uid)) { await this.pull('fo:' + fid, uid); touched.add(fid); }
      for (const fid of await this.g('fo:' + uid)) { await this.pull('fr:' + fid, uid); touched.add(fid); }
      await st.delete('f:' + uid); await st.delete('fr:' + uid); await st.delete('fo:' + uid); await st.delete('b:' + uid);
      for (const fid of touched) await this.pushSocial(fid);
      for (const gid of await this.g('ug:' + uid)) {
        const sv = await st.get('sv:' + gid);
        if (!sv) continue;
        if (sv.owner === uid) await this.deleteGuild(sv);
        else { sv.members = sv.members.filter(x => x.id !== uid); await st.put('sv:' + gid, sv); await this.broadcastGuild(gid); }
      }
      await st.delete('ug:' + uid);
      const code = await st.get('c:' + uid);
      if (code) await st.delete('ci:' + code);
      await st.delete('c:' + uid); await st.delete('n:' + uid); await st.delete('p:' + uid);
      await st.delete('mute:' + uid); await st.delete('ban:' + uid);
      await st.delete('u:' + uname);
      await this.logAdmin('userdel', me, { id: uid, name: acc.name, uname }, true, '');
      reply('aduserdel', { ok: true, uname });
    }
    else if (t === 'adsvlist') {
      const servers = await st.list({ prefix: 'sv:', limit: 500 });
      const list = [];
      for (const sv of servers.values()) {
        const oc = await this.card(sv.owner);
        list.push({ id: sv.id, name: sv.name, icon: sv.icon || '', ownerName: oc ? oc.name : '?', memberCount: sv.members.length, channels: sv.channels.map(c => ({ name: c.name, kind: c.kind })) });
      }
      reply('adsvlist', { list });
    }
    else if (t === 'adsvdel') {
      const sv = await st.get('sv:' + String(m.id));
      if (!sv) return;
      await this.deleteGuild(sv);
      await this.logAdmin('svdel', me, { id: m.id, name: sv.name }, true, '');
      reply('adsvdel', { ok: true, id: m.id });
    }
    else if (t === 'adsvopen') {
      const sv = await st.get('sv:' + String(m.id));
      if (!sv) return reply('adsvopen', { ok: false, msg: 'Sunucu bulunamadı' });
      reply('adsvopen', {
        ok: true,
        server: {
          id: sv.id, name: sv.name, icon: sv.icon || '', owner: false, admin: true, myRoles: [],
          roles: sv.roles.map(r => ({ id: r.id, name: r.name, color: r.color, admin: !!r.admin })),
          channels: sv.channels.map(c => ({ name: c.name, kind: c.kind, roles: c.roles || [] })),
          memberCount: sv.members.length
        }
      });
    }
    else if (t === 'adlogs') {
      const list = (await this.g('adlog')).slice(-200).reverse();
      reply('adlogs', { list });
    }
    else if (t === 'adadmins') {
      if (!me.mainAdmin) return;
      const mainAcc = await st.get('u:voxaadmin');
      const ids = await this.g('admins');
      const list = [];
      for (const id of ids) { const c = await this.card(id); if (c) list.push(c); }
      const log = (await this.g('adlog')).slice(-30).reverse();
      reply('adadmins', {
        main: mainAcc ? { id: mainAcc.id, name: mainAcc.name, uname: 'voxaadmin' } : null,
        list, log
      });
    }
    else if (t === 'adpromote') {
      const fail = msg => { reply('adpromote', { ok: false, msg }); return this.logAdmin('promote', me, { uname: String(m.uname || '') }, false, msg); };
      if (!me.mainAdmin) { await this.logAdmin('promote', me, { uname: String(m.uname || '') }, false, 'yetkisiz deneme'); return; }
      if (!(await this.rateHit('adpr:' + me.id, 30, 600000))) return fail('Çok fazla işlem, biraz bekle');
      const uname = String(m.uname || '').toLowerCase().trim();
      if (!uname) return fail('Kullanıcı adını yaz');
      if (ADMIN_UNAMES.has(uname)) return fail('Bu kullanıcı zaten ana yönetici');
      const acc = await st.get('u:' + uname);
      if (!acc) return fail('Kullanıcı bulunamadı');
      const ids = await this.g('admins');
      if (ids.includes(acc.id)) return fail('Bu kullanıcı zaten admin');
      ids.push(acc.id);
      await st.put('admins', ids);
      await this.logAdmin('promote', me, { id: acc.id, name: acc.name, uname }, true, '');
      await this.updateAdminFlags(acc.id);
      reply('adpromote', { ok: true, msg: acc.name + ' artık admin' });
      await this.pushAdAdmins();
    }
    else if (t === 'addemote') {
      const uid = String(m.id || '');
      const fail = msg => { reply('addemote', { ok: false, msg, id: uid }); return this.logAdmin('demote', me, { id: uid }, false, msg); };
      if (!me.mainAdmin) { await this.logAdmin('demote', me, { id: uid }, false, 'yetkisiz deneme'); return; }
      const ids = await this.g('admins');
      if (!ids.includes(uid)) return fail('Bu kullanıcı zaten admin değil');
      const c = await this.card(uid);
      await st.put('admins', ids.filter(x => x !== uid));
      await this.logAdmin('demote', me, { id: uid, name: c ? c.name : uid }, true, '');
      await this.updateAdminFlags(uid);
      reply('addemote', { ok: true, id: uid });
      await this.pushAdAdmins();
    }
  }
  async pushAdAdmins() {
    for (const w of this.s.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (a && a.mainAdmin) { try { await this.onAdmin(w, a, { t: 'adadmins' }); } catch {} }
    }
  }
  async onGuild(ws, me, m) {
    const t = m.t, st = this.s.storage;
    const reply = (type, o) => ws.send(JSON.stringify({ t: type, ...o }));
    const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
    if (t === 'svcreate') {
      const fail = msg => reply('svres', { ok: false, msg });
      const name = clean(m.name, 32);
      if (!name) return fail('Sunucuya bir ad ver');
      if (!(await this.rateHit('svc:' + me.id, 5, 3600000))) return fail('Çok fazla sunucu oluşturdun, daha sonra tekrar dene');
      const mine = await this.g('ug:' + me.id);
      if (mine.length >= 50) return fail('En fazla 50 sunucuya üye olabilirsin');
      const id = rcode(10).toLowerCase();
      const sv = {
        id, name, icon: clean(m.icon, 4), owner: me.id, roles: [],
        members: [{ id: me.id, roles: [] }],
        channels: [{ name: 'genel', kind: 'text', roles: [] }, { name: 'Genel Ses', kind: 'voice', roles: [] }],
        invites: []
      };
      await st.put('sv:' + id, sv);
      mine.push(id); await st.put('ug:' + me.id, mine);
      reply('svres', { ok: true, msg: 'Sunucu oluşturuldu', id });
      await this.pushGuildsTo(me.id);
    }
    else if (t === 'svjoin') {
      const fail = msg => reply('svres', { ok: false, msg });
      const code = normCode(m.code);
      if (!code) return fail('Davet kodunu yaz');
      if (!(await this.rateHit('svj:' + me.id, 20, 600000))) return fail('Çok fazla deneme, biraz bekle');
      const gid = await st.get('svi:' + code);
      const sv = gid && await st.get('sv:' + gid);
      const inv = sv && sv.invites.find(x => x.code === code);
      if (!sv || !inv) return fail('Geçersiz ya da süresi dolmuş davet kodu');
      if (inv.exp && inv.exp < Date.now()) return fail('Bu davetin süresi dolmuş');
      if (inv.max && inv.uses >= inv.max) return fail('Bu davet kullanım sınırına ulaşmış');
      if (!sv.members.find(x => x.id === me.id)) {
        if (sv.members.length >= 500) return fail('Sunucu dolu');
        const mine = await this.g('ug:' + me.id);
        if (mine.length >= 50) return fail('En fazla 50 sunucuya üye olabilirsin');
        sv.members.push({ id: me.id, roles: [] });
        inv.uses = (inv.uses || 0) + 1;
        await st.put('sv:' + sv.id, sv);
        mine.push(sv.id); await st.put('ug:' + me.id, mine);
        await this.broadcastGuild(sv.id);
      }
      reply('svres', { ok: true, msg: 'Sunucuya katıldın', id: sv.id });
      await this.pushGuildsTo(me.id);
    }
    else if (t === 'svleave') {
      const sv = await st.get('sv:' + String(m.id));
      if (!sv || !sv.members.find(x => x.id === me.id)) return;
      if (sv.owner === me.id) return reply('svres', { ok: false, msg: 'Sahip olduğun sunucudan ayrılamazsın, silebilirsin' });
      sv.members = sv.members.filter(x => x.id !== me.id);
      await st.put('sv:' + sv.id, sv);
      await st.put('ug:' + me.id, (await this.g('ug:' + me.id)).filter(x => x !== sv.id));
      await this.pushGuildsTo(me.id);
      await this.broadcastGuild(sv.id);
    }
    else if (t === 'svdelete') {
      const sv = await st.get('sv:' + String(m.id));
      if (!sv || sv.owner !== me.id) return;
      await this.deleteGuild(sv);
    }
    else if (t === 'svinvite') {
      const sv = await st.get('sv:' + String(m.id));
      const fail = msg => reply('svinvite', { ok: false, msg, id: m.id });
      if (!sv || !(await this.canManage(sv, me))) return fail('Bu işlem için yetkin yok');
      if (sv.invites.length >= 20) sv.invites.shift();
      let code = ''; for (let i = 0; i < 8 && !code; i++) { const c = rcode(8); if (!(await st.get('svi:' + c))) code = c; }
      if (!code) return fail('Bir sorun çıktı, tekrar dene');
      const max = Number(m.max) > 0 ? Math.min(1000, Math.round(Number(m.max))) : 0;
      const exp = Number(m.expiresIn) > 0 ? Date.now() + Math.min(2592000000, Number(m.expiresIn)) : 0;
      sv.invites.push({ code, uses: 0, max, exp, by: me.id });
      await st.put('sv:' + sv.id, sv);
      await st.put('svi:' + code, sv.id);
      reply('svinvite', { ok: true, id: sv.id, code });
    }
    else if (t === 'svch_add') {
      const sv = await st.get('sv:' + String(m.id));
      const fail = msg => reply('svres', { ok: false, msg, id: m.id });
      if (!sv || !(await this.canManage(sv, me))) return fail('Bu işlem için yetkin yok');
      const kind = m.kind === 'voice' ? 'voice' : 'text';
      const name = clean(m.name, 32);
      if (!name) return fail('Kanala bir ad ver');
      if (sv.channels.length >= 50) return fail('En fazla 50 kanal olabilir');
      if (sv.channels.some(c => c.name === name && c.kind === kind)) return fail('Bu isimde bir kanal zaten var');
      sv.channels.push({ name, kind, roles: [] });
      await st.put('sv:' + sv.id, sv);
      await this.broadcastGuild(sv.id);
    }
    else if (t === 'svch_del') {
      const sv = await st.get('sv:' + String(m.id));
      if (!sv || !(await this.canManage(sv, me))) return;
      const i = sv.channels.findIndex(c => c.name === m.name && c.kind === m.kind);
      if (i < 0 || sv.channels.length <= 1) return;
      const [rm] = sv.channels.splice(i, 1);
      await st.put('sv:' + sv.id, sv);
      const ck = 'sv:' + sv.id + '/' + rm.name;
      const all = (await st.get('msgs')) || {};
      for (const x of all[ck] || []) { if (x.au) await st.delete('a:' + x.mid); }
      delete all[ck]; await st.put('msgs', all);
      for (const w of this.s.getWebSockets()) {
        const a = w.deserializeAttachment();
        if (a && a.vr === ck) { delete a.vr; delete a.vm; delete a.vd; delete a.vss; w.serializeAttachment(a); }
      }
      await this.vstate();
      await this.broadcastGuild(sv.id);
    }
    else if (t === 'svch_roles') {
      const sv = await st.get('sv:' + String(m.id));
      if (!sv || !(await this.canManage(sv, me))) return;
      const c = sv.channels.find(x => x.name === m.name && x.kind === m.kind);
      if (!c) return;
      const valid = new Set(sv.roles.map(r => r.id));
      c.roles = Array.isArray(m.roles) ? m.roles.filter(r => valid.has(r)).slice(0, 25) : [];
      await st.put('sv:' + sv.id, sv);
      await this.broadcastGuild(sv.id);
      await this.vstate();
    }
    else if (t === 'svrole_add') {
      const sv = await st.get('sv:' + String(m.id));
      if (!sv || !(await this.canManage(sv, me))) return;
      const name = clean(m.name, 24); if (!name) return;
      if (sv.roles.length >= 25) return;
      const color = /^#[0-9a-fA-F]{6}$/.test(m.color || '') ? m.color : '#99aab5';
      sv.roles.push({ id: rcode(6).toLowerCase(), name, color, admin: !!m.admin });
      await st.put('sv:' + sv.id, sv);
      await this.broadcastGuild(sv.id);
    }
    else if (t === 'svrole_del') {
      const sv = await st.get('sv:' + String(m.id));
      if (!sv || !(await this.canManage(sv, me))) return;
      sv.roles = sv.roles.filter(r => r.id !== m.roleId);
      for (const mm of sv.members) mm.roles = (mm.roles || []).filter(r => r !== m.roleId);
      for (const c of sv.channels) if (c.roles) c.roles = c.roles.filter(r => r !== m.roleId);
      await st.put('sv:' + sv.id, sv);
      await this.broadcastGuild(sv.id);
      await this.vstate();
    }
    else if (t === 'svrole_assign') {
      const sv = await st.get('sv:' + String(m.id));
      if (!sv || !(await this.canManage(sv, me))) return;
      const mem = sv.members.find(x => x.id === m.uid);
      if (!mem || !sv.roles.some(r => r.id === m.roleId)) return;
      mem.roles = mem.roles || [];
      const has = mem.roles.includes(m.roleId);
      if (m.on && !has) mem.roles.push(m.roleId);
      if (!m.on && has) mem.roles = mem.roles.filter(r => r !== m.roleId);
      await st.put('sv:' + sv.id, sv);
      await this.pushGuildsTo(m.uid);
      await this.vstate();
    }
    else if (t === 'svmembers') {
      const sv = await st.get('sv:' + String(m.id));
      if (!sv || !(me.admin || sv.members.find(x => x.id === me.id))) return;
      const on = this.onlineSet();
      const list = [];
      for (const mm of sv.members) { const c = await this.card(mm.id, on); if (c) list.push({ ...c, roles: mm.roles || [], owner: mm.id === sv.owner }); }
      reply('svmembers', { id: sv.id, list });
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
    if (ch.startsWith('dg:')) {
      const gid = String(ch).slice(3).split('/')[0];
      let set = this.gcache.get(uid);
      if (!set) {
        set = new Set(((await this.s.storage.get('g:' + uid)) || []).map(x => x.id));
        this.gcache.set(uid, set);
      }
      return set.has(gid);
    }
    if (ch.startsWith('sv:')) {
      const rest = ch.slice(3), i = rest.indexOf('/');
      const gid = i < 0 ? rest : rest.slice(0, i), chName = i < 0 ? '' : rest.slice(i + 1);
      const sv = await this.s.storage.get('sv:' + gid);
      if (!sv) return false;
      const prof = await this.s.storage.get('p:' + uid);
      if (prof && prof.admin) return true;
      const mem = sv.members.find(x => x.id === uid);
      if (!mem) return false;
      if (sv.owner === uid) return true;
      const roles = mem.roles || [];
      if (roles.some(rid => (sv.roles.find(r => r.id === rid) || {}).admin)) return true;
      if (!chName) return true;
      const c = sv.channels.find(x => x.name === chName);
      if (!c) return false;
      if (!c.roles || !c.roles.length) return true;
      return roles.some(rid => c.roles.includes(rid));
    }
    return true;
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
      if (a) o[a.id] = { name: a.name, admin: !!a.admin };
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
