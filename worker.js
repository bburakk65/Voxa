const CID = '145303300514-6lls1431abkc7l3gth87st2pnehjpumc.apps.googleusercontent.com';
let keys = null, keysAt = 0;
async function getKeys() {
  if (keys && Date.now() - keysAt < 36e5) return keys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  keys = (await r.json()).keys; keysAt = Date.now(); return keys;
}
const b64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function verify(tok) {
  const [h, p, s] = String(tok).split('.');
  const head = JSON.parse(new TextDecoder().decode(b64(h)));
  const k = (await getKeys()).find(k => k.kid === head.kid);
  if (!k) throw new Error('key');
  const key = await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(s), new TextEncoder().encode(h + '.' + p));
  const d = JSON.parse(new TextDecoder().decode(b64(p)));
  const iss = ['accounts.google.com', 'https://accounts.google.com'];
  if (!ok || d.aud !== CID || !iss.includes(d.iss) || d.exp * 1000 < Date.now()) throw new Error('bad token');
  return d;
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === '/ws') return env.HUB.get(env.HUB.idFromName('main')).fetch(req);
    return new Response('Not found', { status: 404 });
  }
};

export class Hub {
  constructor(state) { this.s = state; }
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
        const d = await verify(m.token);
        ws.serializeAttachment({ id: d.sub, name: d.name || 'Kullanıcı', pic: d.picture || '' });
        const hist = (await this.s.storage.get('msgs')) || {};
        ws.send(JSON.stringify({ t: 'ready', hist, online: this.users() }));
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
