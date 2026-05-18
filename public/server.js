const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const contadorPath   = path.join(__dirname, 'contador.json');
const entriesTxtPath = path.join(__dirname, 'public', 'dashboard_entries.txt');
const usersPath = (() => {
  for (const name of ['users.txt.txt', 'users.txt', 'users']) {
    const p = path.join(__dirname, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, 'users.txt');
})();
const devicesPath = path.join(__dirname, 'devices.json');

// ── sesiones en memoria ────────────────────────────────────────────────────
const sessions = new Map();

function crearSesion(user) {
  const token   = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 8 * 60 * 60 * 1000;
  sessions.set(token, { user, expires });
  return token;
}

function verificarSesion(req) {
  // Lee cookie manualmente (sin cookie-parser)
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/iot_session=([^;]+)/);
  if (!match) return null;
  const token   = match[1];
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expires) { sessions.delete(token); return null; }
  return session.user;
}

function setCookie(res, token) {
  res.setHeader('Set-Cookie', `iot_session=${token}; HttpOnly; Path=/; Max-Age=28800; SameSite=Strict`);
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', 'iot_session=; HttpOnly; Path=/; Max-Age=0');
}

// ── helpers ────────────────────────────────────────────────────────────────

// ── helpers ────────────────────────────────────────────────────────────────

function leerContadores() {
  if (!fs.existsSync(contadorPath)) return {};
  return JSON.parse(fs.readFileSync(contadorPath));
}

function guardarContadores(c) {
  fs.writeFileSync(contadorPath, JSON.stringify(c, null, 2));
}

function leerUsuarios() {
  if (!fs.existsSync(usersPath)) return [];
  return fs.readFileSync(usersPath, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l));
}

function guardarUsuario(user) {
  fs.appendFileSync(usersPath, JSON.stringify(user) + '\n', 'utf8');
}

function leerDispositivos() {
  if (!fs.existsSync(devicesPath)) {
    const defaults = [
      { id: 'P3240005S3P', city: 'Monterrey',  company: 'Bimbo',       createdAt: Date.now() },
      { id: 'P3240279C94', city: 'Queretaro',   company: 'Coca-cola',   createdAt: Date.now() },
      { id: 'P3240367R8P', city: 'Sinaloa',     company: 'Pepsi',       createdAt: Date.now() },
      { id: 'P3240160I1M', city: 'León',         company: 'Interiberica',createdAt: Date.now() }
    ];
    fs.writeFileSync(devicesPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(devicesPath));
}

function guardarDispositivos(devs) {
  fs.writeFileSync(devicesPath, JSON.stringify(devs, null, 2));
}

// ── middleware ─────────────────────────────────────────────────────────────

app.use(bodyParser.json());
// NOTE: express.static is registered AFTER all API routes (see bottom of file)

// ── auth ───────────────────────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password)
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

    const users = leerUsuarios();
    const user  = users.find(u => u.username === username && u.password === password);
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const { password: _pw, ...safe } = user;
    const token = crearSesion(safe);
    setCookie(res, token);
    res.json({ ok: true, user: safe });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/logout', (req, res) => {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/iot_session=([^;]+)/);
  if (match) sessions.delete(match[1]);
  clearCookie(res);
  res.json({ ok: true });
});

// ── Proteger index.html ────────────────────────────────────────────────────
app.get(['/', '/index.html'], (req, res) => {
  if (verificarSesion(req)) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.redirect('/login.html');
});

// DEBUG GET - probar shadow desde navegador
app.get('/api/test-shadow/:deviceId', async (req, res) => {
  const deviceId = req.params.deviceId;
  try {
    const response = await fetch('https://sqj6a1yysl.execute-api.us-west-1.amazonaws.com/default/IWSS_GetDeviceShadow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'YedYxiPP3n5rbjlwb24cQag44EjobK2fa4plfnMT'
      },
      body: JSON.stringify({ DeviceId: deviceId })
    });
    const text = await response.text();
    res.send(`<pre>HTTP Status: ${response.status}\n\nRespuesta raw:\n${text}</pre>`);
  } catch (err) {
    res.send(`<pre>ERROR: ${err.message}</pre>`);
  }
});
app.post('/api/debug-status', async (req, res) => {
  const { deviceId } = req.body;
  try {
    const response = await fetch('https://sqj6a1yysl.execute-api.us-west-1.amazonaws.com/default/IWSS_GetDeviceStatus', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'YedYxiPP3n5rbjlwb24cQag44EjobK2fa4plfnMT'
      },
      body: JSON.stringify({ DeviceId: deviceId })
    });
    const text = await response.text();
    res.json({ raw: text, status: response.status });
  } catch (err) {
    res.json({ error: err.message });
  }
});
app.get('/api/debug-users', (req, res) => {
  try {
    const raw = fs.readFileSync(usersPath, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim());
    const parsed = lines.map((l, i) => {
      try { return { line: i, ok: true, data: JSON.parse(l) }; }
      catch (e) { return { line: i, ok: false, raw: l, error: e.message }; }
    });
    res.json({ usersPath, raw, parsed });
  } catch (err) {
    res.json({ error: err.message, usersPath });
  }
});

app.get('/api/devices', (req, res) => {
  res.json(leerDispositivos());
});

app.post('/api/devices', (req, res) => {
  const { id, city, company } = req.body;
  if (!id) return res.status(400).json({ error: 'ID requerido' });
  const devs = leerDispositivos();
  if (devs.find(d => d.id === id)) return res.status(409).json({ error: 'Dispositivo ya existe' });
  const newDev = { id, city: city || '', company: company || '', createdAt: Date.now() };
  devs.push(newDev);
  guardarDispositivos(devs);
  res.json({ ok: true, device: newDev });
});

app.put('/api/devices/:id', (req, res) => {
  const devs = leerDispositivos();
  const idx = devs.findIndex(d => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
  devs[idx] = { ...devs[idx], ...req.body, id: req.params.id };
  guardarDispositivos(devs);
  res.json({ ok: true, device: devs[idx] });
});

app.delete('/api/devices/:id', (req, res) => {
  let devs = leerDispositivos();
  const before = devs.length;
  devs = devs.filter(d => d.id !== req.params.id);
  if (devs.length === before) return res.status(404).json({ error: 'No encontrado' });
  guardarDispositivos(devs);
  res.json({ ok: true });
});

// ── status ─────────────────────────────────────────────────────────────────

app.post('/api/status', async (req, res) => {
  const { deviceId } = req.body;
  try {
    const response = await fetch('https://sqj6a1yysl.execute-api.us-west-1.amazonaws.com/default/IWSS_GetDeviceStatus', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'YedYxiPP3n5rbjlwb24cQag44EjobK2fa4plfnMT'
      },
      body: JSON.stringify({ DeviceId: deviceId })
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error al consultar el estado:', error);
    res.status(500).json({ error: 'Error al consultar el estado del dispositivo' });
  }
});

// ── shadow (dailyCount + command) ─────────────────────────────────────────

app.post('/api/shadow', async (req, res) => {
  const { deviceId } = req.body;
  try {
    const response = await fetch('https://sqj6a1yysl.execute-api.us-west-1.amazonaws.com/default/IWSS_GetDeviceShadow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'YedYxiPP3n5rbjlwb24cQag44EjobK2fa4plfnMT'
      },
      body: JSON.stringify({ DeviceId: deviceId })
    });

    const outer = await response.json();
    // Lambda via API Gateway devuelve body como string
    const data = typeof outer.body === 'string' ? JSON.parse(outer.body) : outer;

    const result = {
      dailyCount: data.dailyCount || 0,
      command:    data.command    || '0',
      time:       data.time       || null,
      status:     data.status     || null
    };

    // Guardar snapshot en historial automáticamente
    guardarHistorialSnapshot(deviceId, result.dailyCount);

    res.json(result);
  } catch (err) {
    console.error('Shadow error:', err.message);
    const contadores = leerContadores();
    res.json({ dailyCount: contadores[deviceId] || 0, command: '0', time: null, status: null });
  }
});

// ── contador local ─────────────────────────────────────────────────────────

app.post('/api/contador', (req, res) => {
  const { deviceId } = req.body;
  const c = leerContadores();
  res.json({ deviceId, count: c[deviceId] || 0 });
});

app.post('/api/contador/incrementar', (req, res) => {
  const { deviceId } = req.body;
  const c = leerContadores();
  c[deviceId] = (c[deviceId] || 0) + 1;
  guardarContadores(c);
  res.json({ success: true, count: c[deviceId] });
});

// ── historial diario ───────────────────────────────────────────────────────

const historyPath = path.join(__dirname, 'wash_history.json');
const historyTxtPath = path.join(__dirname, 'wash_history.txt');

function leerHistorial() {
  if (!fs.existsSync(historyPath)) return [];
  try { return JSON.parse(fs.readFileSync(historyPath)); } catch { return []; }
}

function guardarHistorialSnapshot(deviceId, dailyCount) {
  if (!dailyCount || dailyCount === 0) return;
  const today = new Date().toISOString().split('T')[0];
  const hist  = leerHistorial();

  // Actualiza o inserta el registro de hoy para este dispositivo
  const idx = hist.findIndex(h => h.deviceId === deviceId && h.date === today);
  if (idx >= 0) {
    hist[idx].count = dailyCount;
    hist[idx].ts    = Date.now();
  } else {
    hist.push({ deviceId, date: today, count: dailyCount, ts: Date.now() });
  }

  fs.writeFileSync(historyPath, JSON.stringify(hist, null, 2));

  // También escribe en TXT legible
  const linea = `${today}\t${deviceId}\t${dailyCount}\n`;
  // Evita duplicados en TXT: reescribe completo
  const txtLines = hist.map(h => `${h.date}\t${h.deviceId}\t${h.count}`).join('\n') + '\n';
  fs.writeFileSync(historyTxtPath, txtLines, 'utf8');
}

app.get('/api/history', (req, res) => {
  res.json(leerHistorial());
});

app.post('/api/history', (req, res) => {
  const { deviceId, count, date } = req.body;
  guardarHistorialSnapshot(deviceId, count);
  res.json({ ok: true });
});

app.get('/wash_history.txt', (req, res) => {
  if (fs.existsSync(historyTxtPath)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.sendFile(historyTxtPath);
  } else {
    res.status(404).send('Sin historial todavía.');
  }
});

// ── entries ────────────────────────────────────────────────────────────────

app.post('/api/save-entry', (req, res) => {
  const entry = req.body || {};
  const normalized = {
    deviceId: entry.id || entry.deviceId || '',
    city: entry.city || '',
    company: entry.company || '',
    timestamp: entry.timestamp || Date.now()
  };
  try {
    fs.appendFileSync(entriesTxtPath, JSON.stringify(normalized) + '\n', 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

app.get('/dashboard_entries.txt', (req, res) => {
  if (fs.existsSync(entriesTxtPath)) {
    res.sendFile(entriesTxtPath);
  } else {
    res.status(404).send('No hay entradas todavía.');
  }
});

// ── static files LAST (after all API routes) ───────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
