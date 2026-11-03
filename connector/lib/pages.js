'use strict';
/**
 * The Tulsi ERP pages the connector serves: sign-in, forgot/reset password,
 * error and home. English + Hindi (Tulsi ERP's own UI is bilingual).
 * Mobile-first (assistants often open these in an in-app browser), light and
 * dark mode, no external assets. Everything dynamic is HTML-escaped.
 */
const { escapeHtml: e } = require('./http');

const PRODUCT = 'Tulsi ERP';

const T = {
  en: {
    signinTitle: 'Sign in',
    wants: '<b>{client}</b> wants to use your {product} account.',
    goBack: "After you sign in you'll go back to <b>{host}</b>.",
    email: 'Email',
    password: 'Password',
    signin: 'Sign in',
    cancel: 'Cancel',
    forgot: 'Forgot password?',
    privacy: 'Your password is used once to sign you in. It is never stored or shown to {client}. You can disconnect any time from {client}.',
    otherLang: 'हिंदी',
    invalid: 'Invalid email or password.',
    attemptsLeft: '{n} more tries before a 15-minute pause.',
    locked: 'Too many wrong tries for this email. Try again in {m} minutes.',
    unreachable: "Tulsi ERP can't be reached right now. Please try again in a minute.",
    expired: 'This sign-in page has expired. Go back to {client} and connect again.',
    forgotTitle: 'Reset your password',
    forgotHelp: "Enter your Tulsi ERP email. We'll email you a 6-digit code.",
    sendCode: 'Send code',
    resetTitle: 'Enter the code',
    codeSent: 'If {email} has a Tulsi ERP account, a 6-digit code is on its way. It may take a minute.',
    otp: 'Code from the email',
    newPassword: 'New password',
    passwordRule: 'At least 8 characters, with upper- and lower-case letters, a number and a symbol.',
    resetBtn: 'Change password',
    resetDone: 'Password changed. Sign in with your new password.',
    backToSignin: 'Back to sign in',
    tooMany: 'Too many attempts. Try again in {m} minutes.',
    errorTitle: 'Something went wrong',
  },
  hi: {
    signinTitle: 'साइन इन',
    wants: '<b>{client}</b> आपके {product} खाते का इस्तेमाल करना चाहता है।',
    goBack: 'साइन इन के बाद आप <b>{host}</b> पर वापस जाएँगे।',
    email: 'ईमेल',
    password: 'पासवर्ड',
    signin: 'साइन इन करें',
    cancel: 'रद्द करें',
    forgot: 'पासवर्ड भूल गए?',
    privacy: 'आपका पासवर्ड सिर्फ़ एक बार साइन इन के लिए इस्तेमाल होता है। यह न सेव होता है, न {client} को दिखता है। आप कभी भी {client} से कनेक्शन हटा सकते हैं।',
    otherLang: 'English',
    invalid: 'ईमेल या पासवर्ड गलत है।',
    attemptsLeft: '15 मिनट की रोक से पहले {n} और कोशिश बाकी।',
    locked: 'इस ईमेल से बहुत बार गलत कोशिश हुई। {m} मिनट बाद फिर कोशिश करें।',
    unreachable: 'अभी Tulsi ERP से जुड़ नहीं पा रहे। एक मिनट बाद फिर कोशिश करें।',
    expired: 'यह साइन-इन पेज पुराना हो गया है। {client} पर वापस जाकर फिर से कनेक्ट करें।',
    forgotTitle: 'पासवर्ड रीसेट करें',
    forgotHelp: 'अपना Tulsi ERP ईमेल डालें। हम ईमेल पर 6 अंकों का कोड भेजेंगे।',
    sendCode: 'कोड भेजें',
    resetTitle: 'कोड डालें',
    codeSent: 'अगर {email} का Tulsi ERP खाता है, तो 6 अंकों का कोड भेजा जा रहा है। इसमें एक मिनट लग सकता है।',
    otp: 'ईमेल वाला कोड',
    newPassword: 'नया पासवर्ड',
    passwordRule: 'कम से कम 8 अक्षर: बड़ा और छोटा अक्षर, एक अंक और एक चिह्न।',
    resetBtn: 'पासवर्ड बदलें',
    resetDone: 'पासवर्ड बदल गया। नए पासवर्ड से साइन इन करें।',
    backToSignin: 'साइन इन पर वापस',
    tooMany: 'बहुत ज़्यादा कोशिशें। {m} मिनट बाद फिर कोशिश करें।',
    errorTitle: 'कुछ गड़बड़ हुई',
  },
};

/** Fills {placeholders} with escaped values; the template itself is trusted. */
function t(lang, key, vars = {}) {
  const s = (T[lang] || T.en)[key] || T.en[key] || key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (k === 'product' ? PRODUCT : e(vars[k] ?? '')));
}

const pickLang = (explicit, acceptLanguage) =>
  explicit === 'hi' || explicit === 'en' ? explicit : /^hi\b/i.test(String(acceptLanguage || '')) ? 'hi' : 'en';

const CSS = `
:root{--bg:#f4f7f7;--card:#fff;--text:#0f172a;--muted:#5b6b73;--line:#d7e0e2;--brand:#0f766e;--brand-ink:#fff;--err-bg:#fdecec;--err:#9b1c1c;--ok-bg:#e7f6ef;--ok:#166534}
@media (prefers-color-scheme:dark){:root{--bg:#0b1416;--card:#122023;--text:#e6eef0;--muted:#97a8ad;--line:#22363a;--brand:#2dd4bf;--brand-ink:#052e2b;--err-bg:#3b1515;--err:#fca5a5;--ok-bg:#0f2e22;--ok:#86efac}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Devanagari",sans-serif}
main{max-width:420px;margin:0 auto;padding:24px 16px 40px}
.brand{display:flex;align-items:center;gap:10px;margin:8px 0 20px;font-weight:700;font-size:20px}
.logo{width:36px;height:36px;border-radius:10px;background:var(--brand);color:var(--brand-ink);display:grid;place-items:center;font-weight:800}
.badge{margin-left:auto;font-size:12px;font-weight:700;padding:3px 8px;border-radius:999px;background:#fde68a;color:#713f12}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
h1{font-size:20px;margin:0 0 12px}p{margin:0 0 12px}.muted{color:var(--muted);font-size:14px}
label{display:block;font-weight:600;font-size:14px;margin:14px 0 6px}
input{width:100%;padding:12px;font-size:16px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--text)}
input:focus{outline:2px solid var(--brand);outline-offset:1px}
.row{display:flex;gap:10px;margin-top:18px}
button{flex:1;padding:12px;font-size:16px;font-weight:600;border-radius:10px;border:1px solid var(--brand);cursor:pointer}
.primary{background:var(--brand);color:var(--brand-ink)}.secondary{background:transparent;color:var(--text);border-color:var(--line)}
.msg{padding:10px 12px;border-radius:10px;margin:0 0 12px;font-size:14px}.err{background:var(--err-bg);color:var(--err)}.ok{background:var(--ok-bg);color:var(--ok)}
.links{display:flex;justify-content:space-between;margin-top:16px;font-size:14px}a{color:var(--brand)}
code{background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:2px 6px;word-break:break-all}
ol,ul{padding-left:20px}li{margin:4px 0}h2{font-size:16px;margin:20px 0 8px}
`;

function layout({ title, body, lang = 'en', badge }) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${e(title)} · ${PRODUCT}</title><style>${CSS}</style></head>
<body><main><div class="brand"><div class="logo">T</div><span>${PRODUCT}</span>${badge ? `<span class="badge">${e(badge)}</span>` : ''}</div>${body}</main></body></html>`;
}

const msgHtml = (m) => (m ? `<p class="msg ${m.ok ? 'ok' : 'err'}" role="${m.ok ? 'status' : 'alert'}">${m.html}</p>` : '');

function signInPage({ lang, requestId, clientName, redirectHost, email = '', message, badge, hint }) {
  const other = lang === 'hi' ? 'en' : 'hi';
  const body = `<div class="card">
<h1>${t(lang, 'signinTitle')}</h1>
<p>${t(lang, 'wants', { client: clientName })}</p>
<p class="muted">${t(lang, 'goBack', { host: redirectHost })}</p>
${msgHtml(message)}
<form method="post" action="/authorize" autocomplete="on">
<input type="hidden" name="request_id" value="${e(requestId)}"><input type="hidden" name="lang" value="${lang}">
<label for="email">${t(lang, 'email')}</label><input id="email" name="email" type="email" autocomplete="username" required value="${e(email)}" ${email ? '' : 'autofocus'}>
<label for="password">${t(lang, 'password')}</label><input id="password" name="password" type="password" autocomplete="current-password" required ${email ? 'autofocus' : ''}>
<div class="row"><button class="secondary" type="submit" name="action" value="cancel" formnovalidate>${t(lang, 'cancel')}</button><button class="primary" type="submit" name="action" value="signin">${t(lang, 'signin')}</button></div>
</form>
<div class="links"><a href="/forgot?request_id=${encodeURIComponent(requestId)}&lang=${lang}">${t(lang, 'forgot')}</a><a href="/authorize/back?request_id=${encodeURIComponent(requestId)}&lang=${other}">${t(lang, 'otherLang')}</a></div>
</div>
<p class="muted" style="margin-top:14px">${t(lang, 'privacy', { client: clientName })}</p>${hint ? `<p class="muted">${e(hint)}</p>` : ''}`;
  return layout({ title: t(lang, 'signinTitle'), body, lang, badge });
}

function forgotPage({ lang, requestId, email = '', message, badge }) {
  const body = `<div class="card"><h1>${t(lang, 'forgotTitle')}</h1><p class="muted">${t(lang, 'forgotHelp')}</p>${msgHtml(message)}
<form method="post" action="/forgot"><input type="hidden" name="request_id" value="${e(requestId)}"><input type="hidden" name="lang" value="${lang}">
<label for="email">${t(lang, 'email')}</label><input id="email" name="email" type="email" autocomplete="username" required autofocus value="${e(email)}">
<div class="row"><button class="primary" type="submit">${t(lang, 'sendCode')}</button></div></form>
<div class="links"><a href="/authorize/back?request_id=${encodeURIComponent(requestId)}&lang=${lang}">${t(lang, 'backToSignin')}</a></div></div>`;
  return layout({ title: t(lang, 'forgotTitle'), body, lang, badge });
}

function resetPage({ lang, requestId, email, message, badge }) {
  const body = `<div class="card"><h1>${t(lang, 'resetTitle')}</h1>${msgHtml(message)}
<form method="post" action="/reset"><input type="hidden" name="request_id" value="${e(requestId)}"><input type="hidden" name="lang" value="${lang}"><input type="hidden" name="email" value="${e(email)}">
<label for="otp">${t(lang, 'otp')}</label><input id="otp" name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus>
<label for="newPassword">${t(lang, 'newPassword')}</label><input id="newPassword" name="newPassword" type="password" autocomplete="new-password" minlength="8" required>
<p class="muted" style="margin-top:6px">${t(lang, 'passwordRule')}</p>
<div class="row"><button class="primary" type="submit">${t(lang, 'resetBtn')}</button></div></form>
<div class="links"><a href="/authorize/back?request_id=${encodeURIComponent(requestId)}&lang=${lang}">${t(lang, 'backToSignin')}</a></div></div>`;
  return layout({ title: t(lang, 'resetTitle'), body, lang, badge });
}

function errorPage({ lang = 'en', message, badge }) {
  return layout({ title: t(lang, 'errorTitle'), body: `<div class="card"><h1>${t(lang, 'errorTitle')}</h1><p>${e(message)}</p></div>`, lang, badge });
}

function homePage({ base, badge, actions, mode }) {
  const url = `${base}/mcp`;
  const body = `<div class="card">
<h1>Use Tulsi ERP from your AI assistant</h1>
<p>Ask about leads, follow-ups, stock, tasks, attendance, leave and targets in plain words, in English or Hinglish. You sign in with your own Tulsi ERP login; the assistant can do only what your role allows, and every change is shown to you before it is saved.</p>
<p>Connector address:</p><p><code>${e(url)}</code></p>
<h2>Claude (web, desktop, mobile; Free plan included)</h2>
<ol><li>Settings → Connectors → <b>Add custom connector</b>.</li><li>Name <b>Tulsi ERP</b>, URL above → <b>Connect</b> → sign in on the Tulsi ERP page.</li><li>Added once on web or desktop, it also appears in the mobile app.</li></ol>
<h2>Claude Code</h2><p><code>claude mcp add --transport http tulsi-erp ${e(url)}</code> then <code>/mcp</code> → Authenticate.</p>
<h2>ChatGPT (Developer mode)</h2>
<ol><li>Settings → Apps &amp; Connectors → Advanced → turn on <b>Developer mode</b>.</li><li><b>Create</b> → name <b>Tulsi ERP</b>, MCP server URL above, authentication <b>OAuth</b> → sign in.</li><li>In a chat, pick Tulsi ERP from the tools menu.</li></ol>
<h2>Gemini</h2>
<ul><li><b>Gemini CLI</b>: in <code>~/.gemini/settings.json</code> add <code>{"mcpServers":{"tulsi-erp":{"httpUrl":"${e(url)}"}}}</code>, then <code>/mcp auth tulsi-erp</code>.</li><li><b>Gemini app</b>: Settings → Connected apps → add a custom app with the URL above (where available).</li><li><b>Gemini Enterprise</b>: ask your admin; it needs a pre-registered client.</li></ul>
<h2>Others</h2><p>Mistral Le Chat, Perplexity, Copilot Studio, VS Code and Cursor use the same URL.</p>
<p class="muted">First question to try: “Who am I in Tulsi ERP?” · ${e(mode)} mode · ${actions} actions</p>
</div>`;
  return layout({ title: 'Connector', body, badge });
}

module.exports = { signInPage, forgotPage, resetPage, errorPage, homePage, pickLang, t, PRODUCT };
