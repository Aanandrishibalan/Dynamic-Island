/* AI providers for the island: Ollama (local, in main.js), Claude (Anthropic) and ChatGPT (OpenAI).
 *
 * Claude and OpenAI are used through their official APIs with an API key you create in your own account:
 *   Claude  -> https://console.anthropic.com/settings/keys
 *   OpenAI  -> https://platform.openai.com/api-keys
 * (A claude.ai or chatgpt.com subscription login cannot be used by third-party apps; API usage is billed separately.)
 *
 * Keys are kept in the encrypted vault (AES-256-GCM, optional passphrase; see vault.js), outside the settings the
 * windows can read. The renderer only ever learns "connected or not", never the key.
 *
 * What goes where when a cloud provider is selected:
 *   chat   -> your messages (and the system prompt) go to that provider
 *   vision -> the screenshot you ask about goes to that provider
 *   voice  -> speech-to-text uses OpenAI transcription when an OpenAI key is saved (Claude has no speech API);
 *             otherwise the local whisper.cpp in the whisper folder is used. Replies are read aloud by Windows speech.
 */

const PROVIDERS = {
  claude: { name: 'Claude', base: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-5-5' },
  openai: { name: 'ChatGPT (OpenAI)', base: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' }
};
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

module.exports = function createAI({ getDb, vault }) {
  const S = () => getDb().settings;
  // Keys live only in the encrypted vault (vault.js). They are read here, in the main process, at the moment a
  // request is made and are never sent to a window.
  const getKey = (p) => vault.get(p);
  const putKey = (p, key) => vault.set(p, key);
  const hasKey = (p) => vault.has(p);
  const provider = () => (PROVIDERS[S().aiProvider] ? S().aiProvider : 'ollama');
  const modelFor = (p) => clip(S()[p + 'Model'], 80) || PROVIDERS[p].defaultModel;
  const status = () => { const v = vault.status(); return { canStore: v.canStore, locked: v.locked, mode: v.mode, error: v.error, claude: hasKey('claude'), openai: hasKey('openai') }; };

  /* ---------- HTTP ---------- */
  const headers = (p, key, json) => p === 'claude'
    ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', ...(json ? { 'content-type': 'application/json' } : {}) }
    : { Authorization: 'Bearer ' + key, ...(json ? { 'content-type': 'application/json' } : {}) };

  async function fail(p, r) {
    let msg = '';
    try { const j = await r.json(); msg = (j.error && (j.error.message || j.error.type)) || ''; } catch {}
    const who = PROVIDERS[p].name;
    if (r.status === 401) return `${who} rejected the API key. Open Settings > AI & chat and connect again.`;
    if (r.status === 403) return `${who} refused the request (${clip(msg, 120) || 'permission denied'}).`;
    if (r.status === 404) return `${who}: model "${modelFor(p)}" was not found for this key. Pick another model in Settings > AI & chat.`;
    if (r.status === 429) return `${who} says you are over a rate or spending limit. ${clip(msg, 140)}`;
    if (r.status >= 500) return `${who} is having trouble right now (HTTP ${r.status}). Try again in a moment.`;
    return `${who} error (HTTP ${r.status}): ${clip(msg, 160)}`;
  }
  const net = (p, e) => `Can't reach ${PROVIDERS[p].name}. Check your internet connection. (${clip(e && e.message, 80)})`;

  /* ---------- connect / disconnect / models ---------- */
  async function listModels(p, key) {
    const r = await fetch(PROVIDERS[p].base + '/models?limit=100', { headers: headers(p, key), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Object.assign(new Error(await fail(p, r)), { shown: true });
    const j = await r.json();
    let ids = (j.data || []).map((m) => m.id).filter(Boolean);
    if (p === 'openai') ids = ids.filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|transcribe|tts|image|embedding|moderation|search|instruct|codex)/.test(id));
    return ids.sort();
  }
  async function connect(p, key) {
    if (!PROVIDERS[p]) return { ok: false, text: 'Unknown provider.' };
    key = String(key || '').trim();
    if (!key) return { ok: false, text: 'Paste your API key first.' };
    if (/\s/.test(key) || key.length < 20) return { ok: false, text: 'That does not look like an API key.' };
    const v = vault.status();
    if (v.locked) return { ok: false, text: 'Your saved keys are locked. Unlock them in Settings > Security first.' };
    if (!v.canStore) return { ok: false, text: 'Secure storage is not available on this PC. Set a passphrase in Settings > Security to store keys.' };
    let models;
    try { models = await listModels(p, key); }
    catch (e) { return { ok: false, text: e.shown ? e.message : net(p, e) }; }
    putKey(p, key);
    return { ok: true, text: 'Connected.', models };
  }
  function disconnect(p) { if (PROVIDERS[p]) { try { putKey(p, ''); } catch {} } return status(); }
  async function models(p) {
    const key = getKey(p);
    if (!PROVIDERS[p] || !key) return [];
    try { return await listModels(p, key); } catch { return []; }
  }

  /* ---------- chat ---------- */
  const needKey = (p) => vault.status().locked ? 'Your saved keys are locked. Open Settings > Security and enter your passphrase.' : `${PROVIDERS[p].name} is not connected. Open Settings > AI & chat and paste your API key.`;
  // opts.maxTokens: longer answers for the assistant (meeting notes, drafts). A role:"system" message in `messages` is allowed:
  // OpenAI takes it as is, Claude takes it as the top-level system prompt.
  async function chat(messages, opts) {
    const p = provider(), key = getKey(p), sys = S().systemPrompt;
    opts = opts || {};
    if (!key) return { ok: false, text: needKey(p) };
    try {
      let r;
      if (p === 'claude') {
        const hoisted = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n'), rest = messages.filter((m) => m.role !== 'system'), system = [sys, hoisted].filter(Boolean).join('\n\n');
        r = await fetch(PROVIDERS.claude.base + '/messages', {
          method: 'POST', headers: headers(p, key, true), signal: AbortSignal.timeout(90000),
          body: JSON.stringify({ model: modelFor(p), max_tokens: Math.min(4096, Math.max(256, opts.maxTokens | 0 || 1024)), ...(system ? { system } : {}), messages: rest })
        });
        if (!r.ok) return { ok: false, text: await fail(p, r) };
        const j = await r.json();
        const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        return text ? { ok: true, text } : { ok: false, text: 'Claude returned an empty answer.' };
      }
      r = await fetch(PROVIDERS.openai.base + '/chat/completions', {
        method: 'POST', headers: headers(p, key, true), signal: AbortSignal.timeout(90000),
        body: JSON.stringify({ model: modelFor(p), messages: [...(sys ? [{ role: 'system', content: sys }] : []), ...messages] })
      });
      if (!r.ok) return { ok: false, text: await fail(p, r) };
      const text = String((((await r.json()).choices || [])[0] || {}).message?.content || '').trim();
      return text ? { ok: true, text } : { ok: false, text: 'ChatGPT returned an empty answer.' };
    } catch (e) { return { ok: false, text: net(p, e) }; }
  }

  /* ---------- vision: one screenshot (JPEG, base64) + a question ---------- */
  async function vision(question, jpegB64) {
    const p = provider(), key = getKey(p), sys = S().systemPrompt;
    if (!key) return { ok: false, text: needKey(p) };
    try {
      let r;
      if (p === 'claude') {
        r = await fetch(PROVIDERS.claude.base + '/messages', {
          method: 'POST', headers: headers(p, key, true), signal: AbortSignal.timeout(90000),
          body: JSON.stringify({
            model: modelFor(p), max_tokens: 1024, ...(sys ? { system: sys } : {}),
            messages: [{ role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegB64 } },
              { type: 'text', text: question }] }]
          })
        });
        if (!r.ok) return { ok: false, text: await fail(p, r) };
        const text = ((await r.json()).content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        return text ? { ok: true, text } : { ok: false, text: 'Claude returned an empty answer.' };
      }
      r = await fetch(PROVIDERS.openai.base + '/chat/completions', {
        method: 'POST', headers: headers(p, key, true), signal: AbortSignal.timeout(90000),
        body: JSON.stringify({
          model: modelFor(p),
          messages: [...(sys ? [{ role: 'system', content: sys }] : []), { role: 'user', content: [
            { type: 'text', text: question },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + jpegB64 } }] }]
        })
      });
      if (!r.ok) return { ok: false, text: await fail(p, r) };
      const text = String((((await r.json()).choices || [])[0] || {}).message?.content || '').trim();
      return text ? { ok: true, text } : { ok: false, text: 'ChatGPT returned an empty answer.' };
    } catch (e) { return { ok: false, text: net(p, e) }; }
  }

  /* ---------- voice: speech to text with OpenAI (16 kHz mono WAV from the island) ---------- */
  async function transcribe(wav) {
    const key = getKey('openai');
    if (!key) return { ok: false, text: needKey('openai') };
    try {
      const fd = new FormData();
      fd.append('file', new Blob([Buffer.from(wav)], { type: 'audio/wav' }), 'speech.wav');
      fd.append('model', clip(S().openaiSttModel, 60) || 'whisper-1');
      const lang = S().whisperLang;
      if (lang && lang !== 'auto' && /^[a-z]{2,3}$/.test(lang)) fd.append('language', lang);
      const r = await fetch(PROVIDERS.openai.base + '/audio/transcriptions', { method: 'POST', headers: headers('openai', key, false), body: fd, signal: AbortSignal.timeout(60000) });
      if (!r.ok) return { ok: false, text: await fail('openai', r) };
      return { ok: true, text: String((await r.json()).text || '').trim() };
    } catch (e) { return { ok: false, text: net('openai', e) }; }
  }
  // Which engine will handle speech to text right now: 'openai' or 'local'
  const sttEngine = () => {
    const e = S().sttEngine || 'auto';
    if (e === 'local') return 'local';
    if (e === 'openai') return hasKey('openai') ? 'openai' : 'local';
    return hasKey('openai') ? 'openai' : 'local';
  };

  return { provider, status, hasKey, connect, disconnect, models, chat, vision, transcribe, sttEngine, modelFor, PROVIDERS };
};
