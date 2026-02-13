const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;
const fs = require('fs');
const path = require('path');

const contadorPath = path.join(__dirname, 'contador.json');
const entriesTxtPath = path.join(__dirname, 'dashboard_entries.txt');

const AUTH_USER = process.env.AUTH_USER || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'cambia-este-secreto-en-produccion';

function leerContadores() {
  if (!fs.existsSync(contadorPath)) {
    return {};
  }
  const data = fs.readFileSync(contadorPath);
  return JSON.parse(data);
}

function guardarContadores(contadores) {
  fs.writeFileSync(contadorPath, JSON.stringify(contadores, null, 2));
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  next();
}

app.use(bodyParser.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax'
  }
}));
app.use(express.static('public'));

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};

  if (username === AUTH_USER && password === AUTH_PASSWORD) {
    req.session.user = { username };
    return res.json({ ok: true, user: req.session.user });
  }

  return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error cerrando sesión:', err);
      return res.status(500).json({ ok: false, error: 'No se pudo cerrar sesión' });
    }
    res.clearCookie('connect.sid');
    return res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({ authenticated: true, user: req.session.user });
});

app.post('/api/status', requireAuth, async (req, res) => {
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

app.post('/api/contador', requireAuth, (req, res) => {
  const { deviceId } = req.body;
  const contadores = leerContadores();
  const count = contadores[deviceId] || 0;
  res.json({ deviceId, count });
});

app.post('/api/contador/incrementar', requireAuth, (req, res) => {
  const { deviceId } = req.body;

  const contadores = leerContadores();
  contadores[deviceId] = (contadores[deviceId] || 0) + 1;
  guardarContadores(contadores);

  res.json({ success: true, count: contadores[deviceId] });
});

app.post('/api/save-entry', requireAuth, (req, res) => {
  const entry = req.body || {};
  const normalized = {
    deviceId: entry.id || entry.deviceId || '',
    city: entry.city || '',
    company: entry.company || '',
    timestamp: entry.timestamp || Date.now()
  };

  const line = JSON.stringify(normalized) + '\n';
  try {
    fs.appendFileSync(entriesTxtPath, line, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    console.error('Error guardando entrada:', err);
    res.status(500).json({ ok: false, error: 'No se pudo guardar la entrada' });
  }
});

app.get('/dashboard_entries.txt', requireAuth, (req, res) => {
  if (fs.existsSync(entriesTxtPath)) {
    res.sendFile(entriesTxtPath);
  } else {
    res.status(404).send('No hay entradas todavía.');
  }
});

app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
