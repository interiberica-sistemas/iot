const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const contadorPath = path.join(__dirname, 'contador.json');
const devicesPath = path.join(__dirname, 'devices.json');
const auditTxtPath = path.join(__dirname, 'public', 'device_audit.txt');

const APP_USER = process.env.APP_USER || 'admin';
const APP_PASSWORD = process.env.APP_PASSWORD || 'admin123';

function ensureFile(filePath, fallbackContent = '') {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, fallbackContent, 'utf8');
  }
}

function leerContadores() {
  ensureFile(contadorPath, '{}');
  return JSON.parse(fs.readFileSync(contadorPath, 'utf8'));
}

function guardarContadores(contadores) {
  fs.writeFileSync(contadorPath, JSON.stringify(contadores, null, 2));
}

function leerDispositivos() {
  ensureFile(
    devicesPath,
    JSON.stringify([
      { id: 'P3240005S3P', city: 'Monterrey', company: 'Bimbo' },
      { id: 'P3240279C94', city: 'Queretaro', company: 'Coca-cola' },
      { id: 'P3240367R8P', city: 'Sinaloa', company: 'Pepsi' },
      { id: 'P3240160I1M', city: 'León', company: 'Interiberica' }
    ], null, 2)
  );

  return JSON.parse(fs.readFileSync(devicesPath, 'utf8'));
}

function guardarDispositivos(devices) {
  fs.writeFileSync(devicesPath, JSON.stringify(devices, null, 2));
}

function appendAuditLog(action, { user, deviceId, before = null, after = null }) {
  ensureFile(auditTxtPath, '');
  const event = {
    action,
    user,
    deviceId,
    before,
    after,
    timestamp: Date.now()
  };
  fs.appendFileSync(auditTxtPath, `${JSON.stringify(event)}\n`, 'utf8');
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  return next();
}

app.use(bodyParser.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'iot-super-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);
app.use(express.static('public'));

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};

  if (username === APP_USER && password === APP_PASSWORD) {
    req.session.user = username;
    return res.json({ ok: true, user: username });
  }

  return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ ok: false });
  }
  return res.json({ ok: true, user: req.session.user });
});

app.get('/api/devices', requireAuth, (req, res) => {
  res.json(leerDispositivos());
});

app.post('/api/devices', requireAuth, (req, res) => {
  const { id, city = '', company = '' } = req.body || {};

  if (!id) {
    return res.status(400).json({ error: 'ID de dispositivo obligatorio' });
  }

  const devices = leerDispositivos();
  if (devices.some((d) => d.id === id)) {
    return res.status(409).json({ error: 'El dispositivo ya existe' });
  }

  const created = { id, city, company };
  devices.push(created);
  guardarDispositivos(devices);
  appendAuditLog('ADD', {
    user: req.session.user,
    deviceId: id,
    after: created
  });

  return res.status(201).json(created);
});

app.put('/api/devices/:id', requireAuth, (req, res) => {
  const currentId = req.params.id;
  const { id, city = '', company = '' } = req.body || {};
  const nextId = id || currentId;

  const devices = leerDispositivos();
  const index = devices.findIndex((d) => d.id === currentId);

  if (index === -1) {
    return res.status(404).json({ error: 'Dispositivo no encontrado' });
  }

  if (nextId !== currentId && devices.some((d) => d.id === nextId)) {
    return res.status(409).json({ error: 'El nuevo ID ya existe' });
  }

  const before = { ...devices[index] };
  devices[index] = { id: nextId, city, company };
  guardarDispositivos(devices);

  appendAuditLog('EDIT', {
    user: req.session.user,
    deviceId: currentId,
    before,
    after: devices[index]
  });

  return res.json(devices[index]);
});

app.delete('/api/devices/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const devices = leerDispositivos();
  const index = devices.findIndex((d) => d.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Dispositivo no encontrado' });
  }

  const [removed] = devices.splice(index, 1);
  guardarDispositivos(devices);

  appendAuditLog('DELETE', {
    user: req.session.user,
    deviceId: id,
    before: removed,
    after: null
  });

  return res.json({ ok: true });
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

app.get('/device_audit.txt', requireAuth, (req, res) => {
  ensureFile(auditTxtPath, '');
  res.sendFile(auditTxtPath);
});

app.listen(PORT, () => console.log(`Servidor corriendo en http://localhost:${PORT}`));
