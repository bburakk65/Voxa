const GOOGLE_CID = '145303300514-6lls1431abkc7l3gth87st2pnehjpumc.apps.googleusercontent.com';
const DISCORD_CID = '1555941897644671110';
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* ---- Google token doğrulama ---- */
let keys = null, keysAt = 0;
async function getKeys() {
  if (keys && Date.now() - keysAt < 36e5) return keys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  keys = (await r.json()).keys; keysAt = Date.now(); return keys;
}
async function verifyGoogle(tok) {
  const [h, p, s] = String(tok).split('.');
  const head = JSON.parse(dec.decode(b64(h)));
  const k = (await getKeys()).find(k => k.kid === head.kid);
  if (!k) throw new Error('key');
  const key = await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(s), enc.encode(h + '.' + p));
  const d = JSON.parse(dec.decode(b64(p)));
  const iss = ['accounts.google.com', 'https://accounts.google.com'];
  if (!ok || d.aud !== GOOGLE_CID || !iss.includes(d.iss) || d.exp * 1000 < Date.now()) throw new Error('bad token');
  return { id: 'g' + d.sub, name: d.name || 'Kullanıcı', picture: d.picture || '' };
}

/* ---- Voxa oturum token'ı (imzalı) ---- */
async function hmac(secret, data) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function sign(secret, u) {
  const p = b64u(enc.encode(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 30 * 86400 })));
  return 'v1.' + p + '.' + await hmac(secret, p);
}
async function unsign(secret, tok) {
  const [v, p, s] = String(tok).split('.');
  if (v !== 'v1' || !safeEq(s || '', await hmac(secret, p))) throw new Error('sig');
  const d = JSON.parse(dec.decode(b64(p)));
  if (d.exp * 1000 < Date.now()) throw new Error('exp');
  return d;
}

/* ---- Discord ile giriş ---- */
async function discordStart(u) {
  const state = crypto.randomUUID();
  const url = 'https://discord.com/oauth2/authorize?' + new URLSearchParams({
    client_id: DISCORD_CID, response_type: 'code', scope: 'identify',
    redirect_uri: u.origin + '/auth/discord', state, prompt: 'none'
  });
  return new Response(null, { status: 302, headers: {
    Location: url,
    'Set-Cookie': 'vs=' + state + '; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=600'
  }});
}
async function discordCallback(req, env, u) {
  if (!env.DISCORD_SECRET) return new Response('DISCORD_SECRET ayarlanmamış', { status: 500 });
  const code = u.searchParams.get('code'), state = u.searchParams.get('state');
  const ck = (req.headers.get('Cookie') || '').match(/(?:^|;\s*)vs=([^;]+)/);
  if (!code || !state || !ck || ck[1] !== state) return Response.redirect(u.origin + '/', 302);
  const tr = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: DISCORD_CID, client_secret: env.DISCORD_SECRET, grant_type: 'authorization_code',
      code, redirect_uri: u.origin + '/auth/discord'
    })
  });
  if (!tr.ok) return new Response('Discord girişi başarısız (token)', { status: 502 });
  const { access_token } = await tr.json();
  const ur = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: 'Bearer ' + access_token } });
  if (!ur.ok) return new Response('Discord girişi başarısız (kullanıcı)', { status: 502 });
  const d = await ur.json();
  const pic = d.avatar ? 'https://cdn.discordapp.com/avatars/' + d.id + '/' + d.avatar + '.png?size=64' : '';
  const tok = await sign(env.DISCORD_SECRET, { id: 'd' + d.id, name: d.global_name || d.username, picture: pic });
  return new Response(null, { status: 302, headers: {
    Location: u.origin + '/#vt=' + tok,
    'Set-Cookie': 'vs=; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=0'
  }});
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
  constructor(state, env) { this.s = state; this.env = env; }
  async fetch(req) {
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
        let u, fresh = false;
        if (String(m.token).startsWith('v1.')) {
          if (!secret) throw new Error('no secret');
          u = await unsign(secret, m.token);
        } else { u = await verifyGoogle(m.token); fresh = true; }
        ws.serializeAttachment({ id: u.id, name: u.name, pic: u.picture || '' });
        const hist = (await this.s.storage.get('msgs')) || {};
        ws.send(JSON.stringify({ t: 'ready', hist, online: this.users() }));
        if (fresh && secret) ws.send(JSON.stringify({ t: 'session', token: await sign(secret, u) }));
        this.bc({ t: 'online', online: this.users() });
      } catch { ws.send(JSON.stringify({ t: 'error' })); ws.close(1008, 'auth'); }
      return;
    }
    const me = ws.deserializeAttachment();
    if (!me) return;
    if (m.t === 'msg') {
      const text = String(m.text || '').trim().slice(0, 2000);
      const ch = String(m.ch || '').slice(0, 60);
      if (!text || !ch) return;
      const msg = { u: me.name, id: me.id, t: text, ts: Date.now() };
      const all = (await this.s.storage.get('msgs')) || {};
      all[ch] = (all[ch] || []).concat(msg).slice(-100);
      await this.s.storage.put('msgs', all);
      this.bc({ t: 'msg', ch, msg });
    }
  }
  webSocketClose(ws) { try { ws.close(); } catch {} this.bc({ t: 'online', online: this.users() }); }
  webSocketError() { this.bc({ t: 'online', online: this.users() }); }
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
    for (const w of this.s.getWebSockets()) { try { w.send(s); } catch {} }
  }
}
