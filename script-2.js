// ---------- storage helpers ----------
const LS = {
  get(k, d){ try{ return JSON.parse(localStorage.getItem(k)) ?? d; }catch{ return d; } },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
};

let settings = LS.get('sq_settings', { geminiKey:'', gClientId:'' });
let favorites = LS.get('sq_favorites', []);
let history = LS.get('sq_history', []);
let currentQuest = null;
let currentImageDataUrl = null;
let tokenClient = null;
let accessToken = null;

// ---------- settings panel ----------
const settingsPanel = document.getElementById('settingsPanel');
document.getElementById('settingsBtn').onclick = () => settingsPanel.classList.toggle('hidden');
document.getElementById('geminiKey').value = settings.geminiKey;
document.getElementById('gClientId').value = settings.gClientId;
document.getElementById('saveSettings').onclick = () => {
  settings.geminiKey = document.getElementById('geminiKey').value.trim();
  settings.gClientId = document.getElementById('gClientId').value.trim();
  LS.set('sq_settings', settings);
  initGoogleAuth();
  toast('Settings saved');
  settingsPanel.classList.add('hidden');
};

// ---------- budget slider ----------
const budgetSlider = document.getElementById('budgetSlider');
const budgetVal = document.getElementById('budgetVal');
budgetSlider.oninput = () => budgetVal.textContent = budgetSlider.value;

// ---------- toast ----------
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>t.classList.add('hidden'), 2500);
}

// ---------- Gemini generation ----------
async function generateQuest(){
  if(!settings.geminiKey){ toast('Add your Gemini API key in ⚙ settings'); settingsPanel.classList.remove('hidden'); return; }
  const location = document.getElementById('locationInput').value.trim() || 'anywhere nearby';
  const budget = budgetSlider.value;

  const prompt = `You are a generator of fun, safe, real-world "sidequests" (small personal challenges) for a person in or near Bengaluru, India.
Location context: ${location}
Max budget: ₹${budget}
Return ONLY valid JSON (no markdown, no backticks) matching exactly this schema:
{"title": string, "description": string, "location": string, "budget": number, "duration": string, "difficulty": "Easy"|"Medium"|"Hard", "objective": string, "items": string[], "mapsQuery": string}
Make it creative, specific, doable in a few hours, and budget must not exceed ${budget}.`;

  setLoading(true);
  try{
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${settings.geminiKey}`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        contents:[{ parts:[{ text: prompt }] }],
        generationConfig:{ responseMimeType:'application/json' }
      })
    });
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if(!raw) throw new Error(data?.error?.message || 'No response from Gemini');
    const quest = JSON.parse(raw);
    currentQuest = quest;
    renderQuestCard(quest);
    history.unshift({ ...quest, img: currentImageDataUrl, ts: Date.now() });
    history = history.slice(0, 50);
    LS.set('sq_history', history);
    renderLists();
  }catch(err){
    toast('Error: ' + err.message);
  }finally{
    setLoading(false);
  }
}

function setLoading(on){
  document.getElementById('generateBtn').disabled = on;
  document.getElementById('generateBtn').textContent = on ? '⏳ Summoning quest...' : '🎲 Generate Sidequest';
}

document.getElementById('generateBtn').onclick = generateQuest;
document.getElementById('rerollBtn').onclick = generateQuest;

// ---------- canvas quest-card image template ----------
function hashStr(s){ let h=0; for(let i=0;i<s.length;i++){ h = (h*31 + s.charCodeAt(i)) >>> 0; } return h; }

const PALETTES = [
  ['#1b1035','#3a1f5d','#d4af37'],
  ['#07202b','#0f4c5c','#5fd6c4'],
  ['#2b0f16','#5c1f2d','#e2685a'],
  ['#0d1b2a','#1b3a4b','#8ecae6'],
  ['#1a1b0d','#3d3b1f','#d4af37'],
];

function drawQuestImage(quest, questNumber){
  const canvas = document.getElementById('renderCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const pal = PALETTES[hashStr(quest.title) % PALETTES.length];

  // background gradient
  const grad = ctx.createLinearGradient(0,0,W,H);
  grad.addColorStop(0, pal[0]);
  grad.addColorStop(1, pal[1]);
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,W,H);

  // procedural decorative rings (seeded)
  const seed = hashStr(quest.title + quest.location);
  ctx.globalAlpha = 0.15;
  for(let i=0;i<6;i++){
    const rx = ((seed >> (i*3)) % W);
    const ry = ((seed >> (i*5)) % (H*0.6)) + 100;
    const r = 60 + ((seed >> (i*2)) % 160);
    ctx.beginPath();
    ctx.arc(rx, ry, r, 0, Math.PI*2);
    ctx.strokeStyle = pal[2];
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // border frame
  ctx.strokeStyle = pal[2];
  ctx.lineWidth = 6;
  ctx.strokeRect(20,20,W-40,H-40);

  // header label
  ctx.fillStyle = pal[2];
  ctx.font = '600 26px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`SIDEQUEST #${String(questNumber).padStart(3,'0')}`, W/2, 90);

  // title (wrapped)
  ctx.fillStyle = '#f4f1ea';
  ctx.font = '700 46px Georgia, serif';
  wrapText(ctx, quest.title.toUpperCase(), W/2, 180, W-140, 54);

  // stats block
  const statsY = 420;
  ctx.textAlign = 'left';
  ctx.font = '500 26px "IBM Plex Mono", monospace';
  const stats = [
    ['📍', quest.location],
    ['💰', `₹${quest.budget}`],
    ['⏱', quest.duration],
    ['⚡', quest.difficulty]
  ];
  stats.forEach((s, i) => {
    const y = statsY + i*54;
    ctx.fillStyle = pal[2];
    ctx.fillText(s[0], 90, y);
    ctx.fillStyle = '#f4f1ea';
    ctx.fillText(truncate(s[1], 34), 140, y);
  });

  // objective quote
  ctx.font = 'italic 28px Georgia, serif';
  ctx.fillStyle = '#e9e7e0';
  wrapText(ctx, `"${quest.objective}"`, W/2, 680, W-160, 38, true);

  // footer
  ctx.font = '400 18px "IBM Plex Mono", monospace';
  ctx.fillStyle = pal[2];
  ctx.textAlign = 'center';
  ctx.fillText('generated with sidequests · gemini', W/2, H-40);

  return canvas.toDataURL('image/png');
}

function truncate(s, n){ return s.length>n ? s.slice(0,n-1)+'…' : s; }

function wrapText(ctx, text, cx, y, maxWidth, lineHeight, centered){
  const words = text.split(' ');
  let line = '', lines = [];
  for(const w of words){
    const test = line + w + ' ';
    if(ctx.measureText(test).width > maxWidth && line){
      lines.push(line.trim()); line = w + ' ';
    } else line = test;
  }
  lines.push(line.trim());
  ctx.textAlign = 'center';
  lines.forEach((l,i)=> ctx.fillText(l, cx, y + i*lineHeight));
}

// ---------- render quest card in DOM ----------
function renderQuestCard(quest){
  currentImageDataUrl = drawQuestImage(quest, history.length + 1);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(quest.mapsQuery || quest.location)}`;
  const area = document.getElementById('questArea');
  area.innerHTML = `
    <div class="quest-card">
      <div class="stub"><span>SIDEQUEST #${String(history.length+1).padStart(3,'0')}</span><span>${quest.difficulty}</span></div>
      <img class="thumb" src="${currentImageDataUrl}" alt="quest image">
      <div class="body">
        <h3>${escapeHtml(quest.title)}</h3>
        <div class="stats">
          <div><span>Location</span>${escapeHtml(quest.location)}</div>
          <div><span>Budget</span>₹${quest.budget}</div>
          <div><span>Duration</span>${escapeHtml(quest.duration)}</div>
          <div><span>Difficulty</span>${escapeHtml(quest.difficulty)}</div>
        </div>
        <p>${escapeHtml(quest.description)}</p>
        <div class="objective">${escapeHtml(quest.objective)}</div>
        <ul class="items">${(quest.items||[]).map(i=>`<li>${escapeHtml(i)}</li>`).join('')}</ul>
        <a class="maps" href="${mapsUrl}" target="_blank" rel="noopener">🗺 Open in Google Maps</a>
        <div class="actionrow">
          <button class="btn small" id="favBtn">❤ Favorite</button>
          <button class="btn small" id="driveBtn">☁ Save to Drive</button>
          <button class="btn small" id="pdfBtn">📄 Download PDF</button>
          <button class="btn small" id="dlBtn">⬇ Download PNG</button>
        </div>
      </div>
    </div>`;
  document.getElementById('favBtn').onclick = () => addFavorite(quest, currentImageDataUrl);
  document.getElementById('driveBtn').onclick = () => saveToDrive(quest, currentImageDataUrl);
  document.getElementById('pdfBtn').onclick = () => exportImagesToPdf([currentImageDataUrl], quest.title);
  document.getElementById('dlBtn').onclick = () => downloadImage(currentImageDataUrl, quest.title);
}

function escapeHtml(s=''){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function downloadImage(dataUrl, title){
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${(title||'sidequest').replace(/\W+/g,'_')}.png`;
  a.click();
}

// ---------- favorites & history ----------
function addFavorite(quest, img){
  favorites.unshift({ ...quest, img, ts: Date.now() });
  LS.set('sq_favorites', favorites);
  toast('Added to favorites');
  renderLists();
}
function removeFavorite(ts){
  favorites = favorites.filter(f => f.ts !== ts);
  LS.set('sq_favorites', favorites);
  renderLists();
}
function clearHistoryItem(ts){
  history = history.filter(h => h.ts !== ts);
  LS.set('sq_history', history);
  renderLists();
}

function renderLists(){
  const fEl = document.getElementById('favoritesList');
  const hEl = document.getElementById('historyList');
  fEl.innerHTML = favorites.length ? favorites.map(f => miniItem(f, true)).join('') : `<div class="empty">No favorites yet.</div>`;
  hEl.innerHTML = history.length ? history.map(h => miniItem(h, false)).join('') : `<div class="empty">No quests yet.</div>`;
  favorites.forEach(f => { const b = document.getElementById('rm_'+f.ts); if(b) b.onclick = () => removeFavorite(f.ts); });
  history.forEach(h => { const b = document.getElementById('rm_'+h.ts); if(b) b.onclick = () => clearHistoryItem(h.ts); });
}

function miniItem(q, isFav){
  return `<div class="mini-item">
    ${q.img ? `<img src="${q.img}">` : ''}
    <div class="meta"><b>${escapeHtml(q.title)}</b><span>${escapeHtml(q.location)} · ₹${q.budget}</span></div>
    <button id="rm_${q.ts}">${isFav ? '✕' : '🗑'}</button>
  </div>`;
}

// ---------- tabs ----------
document.querySelectorAll('.tabbtn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tabbtn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('questArea').classList.toggle('hidden', tab !== 'current');
    document.querySelector('.controls').classList.toggle('hidden', tab !== 'current');
    document.getElementById('favoritesList').classList.toggle('hidden', tab !== 'favorites');
    document.getElementById('historyList').classList.toggle('hidden', tab !== 'history');
    document.getElementById('favoritesBar').classList.toggle('hidden', tab !== 'favorites');
    document.getElementById('historyBar').classList.toggle('hidden', tab !== 'history');
  };
});

// ---------- PDF export (no external libraries) ----------
function strToBytes(s){ return new TextEncoder().encode(s); }
function base64ToBytes(b64){
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// canvas PNG dataURLs -> JPEG dataURL (PDF embeds JPEG directly via DCTDecode)
function toJpeg(dataUrl){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const cx = c.getContext('2d');
      cx.drawImage(img, 0, 0);
      resolve({ dataUrl: c.toDataURL('image/jpeg', 0.9), width: img.width, height: img.height });
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function buildPdfBlob(pngDataUrls){
  const chunks = [];
  const offsets = [];
  let offset = 0;
  function push(part){
    const bytes = typeof part === 'string' ? strToBytes(part) : part;
    chunks.push(bytes);
    offset += bytes.length;
  }
  function markObj(){ offsets.push(offset); }

  const jpegs = await Promise.all(pngDataUrls.map(toJpeg));
  const n = jpegs.length;

  push('%PDF-1.4\n');

  let objCounter = 3;
  const pageInfos = jpegs.map(() => ({ page: objCounter++, content: objCounter++, image: objCounter++ }));

  markObj();
  push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);

  markObj();
  const kids = pageInfos.map(p => `${p.page} 0 R`).join(' ');
  push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${n} >>\nendobj\n`);

  for(let i=0;i<n;i++){
    const { dataUrl, width, height } = jpegs[i];
    const p = pageInfos[i];
    const imgBytes = base64ToBytes(dataUrl.split(',')[1]);

    markObj();
    push(`${p.page} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${p.image} 0 R >> >> /Contents ${p.content} 0 R >>\nendobj\n`);

    const contentStr = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
    markObj();
    push(`${p.content} 0 obj\n<< /Length ${contentStr.length} >>\nstream\n${contentStr}\nendstream\nendobj\n`);

    markObj();
    push(`${p.image} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\nstream\n`);
    push(imgBytes);
    push(`\nendstream\nendobj\n`);
  }

  const xrefOffset = offset;
  const totalObjs = 2 + n * 3;
  let xref = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for(const off of offsets) xref += String(off).padStart(10, '0') + ' 00000 n \n';
  push(xref);
  push(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new Blob(chunks, { type: 'application/pdf' });
}

async function exportImagesToPdf(pngDataUrls, name = 'sidequests'){
  if(!pngDataUrls.length){ toast('Nothing to export'); return; }
  toast('Building PDF...');
  try{
    const blob = await buildPdfBlob(pngDataUrls);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/\W+/g, '_')}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('PDF downloaded ✔');
  }catch(err){
    toast('PDF error: ' + err.message);
  }
}

document.getElementById('favPdfBtn').onclick = () => exportImagesToPdf(favorites.map(f => f.img), 'favorites');
document.getElementById('histPdfBtn').onclick = () => exportImagesToPdf(history.map(h => h.img).filter(Boolean), 'history');

// ---------- Google Drive upload ----------
function initGoogleAuth(){
  if(!settings.gClientId || !window.google) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: settings.gClientId,
    scope: 'https://www.googleapis.com/auth/drive.file',
    callback: (resp) => { accessToken = resp.access_token; }
  });
}
window.addEventListener('load', () => setTimeout(initGoogleAuth, 500));

async function saveToDrive(quest, imgDataUrl){
  if(!settings.gClientId){ toast('Add a Google Client ID in ⚙ settings'); settingsPanel.classList.remove('hidden'); return; }
  if(!tokenClient){ initGoogleAuth(); }
  if(!accessToken){
    tokenClient.callback = async (resp) => { accessToken = resp.access_token; await uploadToDrive(quest, imgDataUrl); };
    tokenClient.requestAccessToken();
    return;
  }
  await uploadToDrive(quest, imgDataUrl);
}

async function uploadToDrive(quest, imgDataUrl){
  try{
    toast('Uploading to Drive...');
    const blob = await (await fetch(imgDataUrl)).blob();
    const filename = `${quest.title.replace(/\W+/g,'_')}_${Date.now()}.png`;
    const metadata = { name: filename, mimeType: 'image/png' };

    const boundary = 'sq_boundary_' + Date.now();
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: image/png\r\n\r\n`;
    const closing = `\r\n--${boundary}--`;

    const buf = await blob.arrayBuffer();
    const encoder = new TextEncoder();
    const bodyBytes = new Blob([encoder.encode(body), buf, encoder.encode(closing)]);

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method:'POST',
      headers:{ 'Authorization': `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: bodyBytes
    });
    const data = await res.json();
    if(data.id) toast('Saved to Google Drive ✔');
    else throw new Error(data.error?.message || 'Upload failed');
  }catch(err){
    accessToken = null;
    toast('Drive error: ' + err.message);
  }
}

// ---------- init ----------
renderLists();
