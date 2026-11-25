import express, {type Request, type Response, type NextFunction} from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer as createViteServer} from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = __dirname;
const USERS_FILE = path.resolve(DATA_DIR, 'users.json');
const RENTALS_FILE = path.resolve(DATA_DIR, 'rentals.json');

const SESSION_SECRET =
  process.env.WAY2HOME_SESSION_SECRET && process.env.WAY2HOME_SESSION_SECRET.length >= 16
    ? process.env.WAY2HOME_SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

type VehicleType = 'Patín' | 'Bicicleta';
type PackageType = 'Por día' | 'Semanal' | 'Mensual';
type ClientType = 'Alumno' | 'Docente';

const TARIFAS: Record<VehicleType, Record<PackageType, number>> = {
  Bicicleta: {
    'Por día': 80,
    Semanal: 380,
    Mensual: 900,
  },
  Patín: {
    'Por día': 120,
    Semanal: 420,
    Mensual: 1200,
  },
};

interface StoredUser {
  usuario: string;
  passwordHash: string;
  createdAt: number;
}

interface StoredRental {
  id: string;
  usuario: string;
  nombre: string;
  matricula: string;
  carrera: string;
  dia: number;
  mes: number;
  ano: number;
  fecha_renta: string;
  tipo_cliente: ClientType;
  vehiculo: VehicleType;
  paquete: PackageType;
  costo_paquete: number;
  costo_casco: number;
  mensaje_casco: string;
  total: number;
  creado_en: number;
}

interface AuthenticatedRequest extends Request {
  authUser?: string;
}

function ensureDataStore(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {recursive: true});
  }
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, '[]', 'utf8');
  }
  if (!fs.existsSync(RENTALS_FILE)) {
    fs.writeFileSync(RENTALS_FILE, '[]', 'utf8');
  }
}

function readJsonArray<T>(filePath: string): T[] {
  const resolved = path.resolve(filePath);
  if (resolved !== USERS_FILE && resolved !== RENTALS_FILE) {
    throw new Error('Invalid data path');
  }
  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeJsonArray<T>(filePath: string, data: T[]): void {
  const resolved = path.resolve(filePath);
  if (resolved !== USERS_FILE && resolved !== RENTALS_FILE) {
    throw new Error('Invalid data path');
  }
  fs.writeFileSync(resolved, JSON.stringify(data, null, 2), 'utf8');
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return false;
  }
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) {
    return false;
  }
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

const activeSessions = new Map<string, string>();

function createSessionToken(usuario: string): string {
  const nonce = crypto.randomBytes(18).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`${usuario}:${nonce}`)
    .digest('base64url')
    .slice(0, 24);
  const token = `${nonce}.${sig}`;
  activeSessions.set(token, usuario);
  return token;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({detail: 'Debes iniciar sesión para continuar.'});
    return;
  }
  const token = authHeader.slice(7).trim();
  const usuario = activeSessions.get(token);
  if (!usuario) {
    res.status(401).json({detail: 'Tu sesión expiró o no es válida. Inicia sesión nuevamente.'});
    return;
  }
  req.authUser = usuario;
  next();
}

function isValidVehicle(value: unknown): value is VehicleType {
  return value === 'Patín' || value === 'Bicicleta';
}

function isValidPackage(value: unknown): value is PackageType {
  return value === 'Por día' || value === 'Semanal' || value === 'Mensual';
}

function isValidClientType(value: unknown): value is ClientType {
  return value === 'Alumno' || value === 'Docente';
}

function calculatePricing(vehiculo: VehicleType, paquete: PackageType) {
  const costo_paquete = TARIFAS[vehiculo][paquete];
  const isMonthly = paquete === 'Mensual';
  const costo_casco = isMonthly ? 0 : 100;
  const mensaje_casco = isMonthly
    ? 'Por tu paquete, el casco te lo llevas gratis'
    : 'Debes comprar un casco para poder utilizar el vehículo ($100 pesos)';
  const total = costo_paquete + costo_casco;
  return {
    costo_paquete,
    costo_casco,
    mensaje_casco,
    total,
  };
}

function validateAuthBody(body: unknown): {usuario: string; contrasena: string} | {error: string} {
  if (!body || typeof body !== 'object') {
    return {error: 'Datos inválidos.'};
  }
  const raw = body as Record<string, unknown>;
  const usuario = typeof raw.usuario === 'string' ? raw.usuario.trim() : '';
  const contrasena = typeof raw.contrasena === 'string' ? raw.contrasena : '';

  if (usuario.length < 3 || usuario.length > 40) {
    return {error: 'El usuario debe tener entre 3 y 40 caracteres.'};
  }
  if (/[\s,]/.test(usuario)) {
    return {error: 'El usuario no puede contener espacios ni comas.'};
  }
  if (contrasena.length < 4 || contrasena.length > 128) {
    return {error: 'La contraseña debe tener al menos 4 caracteres.'};
  }
  return {usuario, contrasena};
}

async function startServer(): Promise<void> {
  ensureDataStore();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({limit: '64kb'}));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({status: 'ok', servicio: 'Way2Home'});
  });

  app.post('/api/register', (req: Request, res: Response) => {
    const validated = validateAuthBody(req.body);
    if ('error' in validated) {
      res.status(400).json({detail: validated.error});
      return;
    }

    const users = readJsonArray<StoredUser>(USERS_FILE);
    const exists = users.some((u) => u.usuario.toLowerCase() === validated.usuario.toLowerCase());
    if (exists) {
      res.status(409).json({detail: 'Ese nombre de usuario ya está registrado.'});
      return;
    }

    users.push({
      usuario: validated.usuario,
      passwordHash: hashPassword(validated.contrasena),
      createdAt: Date.now(),
    });
    writeJsonArray(USERS_FILE, users);

    const token = createSessionToken(validated.usuario);
    res.status(201).json({
      mensaje: '¡Usuario registrado con éxito!',
      usuario: validated.usuario,
      token,
    });
  });

  app.post('/api/login', (req: Request, res: Response) => {
    const validated = validateAuthBody(req.body);
    if ('error' in validated) {
      res.status(400).json({detail: validated.error});
      return;
    }

    const users = readJsonArray<StoredUser>(USERS_FILE);
    const user = users.find((u) => u.usuario === validated.usuario);
    if (!user || !verifyPassword(validated.contrasena, user.passwordHash)) {
      res.status(401).json({detail: 'Usuario o contraseña incorrectos.'});
      return;
    }

    const token = createSessionToken(user.usuario);
    res.json({
      mensaje: `¡Bienvenido, ${user.usuario}!`,
      usuario: user.usuario,
      token,
    });
  });

  app.get('/api/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({usuario: req.authUser});
  });

  app.post('/api/logout', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      activeSessions.delete(token);
    }
    res.json({mensaje: 'Sesión cerrada correctamente.'});
  });

  app.post('/api/quote', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown> | undefined;
    const vehiculo = body?.vehiculo;
    const paquete = body?.paquete;

    if (!isValidVehicle(vehiculo) || !isValidPackage(paquete)) {
      res.status(400).json({detail: 'Vehículo o paquete no válido.'});
      return;
    }

    res.json(calculatePricing(vehiculo, paquete));
  });

  app.post('/api/rentals', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as Record<string, unknown> | undefined;
    if (!body) {
      res.status(400).json({detail: 'Cuerpo de solicitud inválido.'});
      return;
    }

    const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
    const matricula = typeof body.matricula === 'string' ? body.matricula.trim() : '';
    const carrera = typeof body.carrera === 'string' ? body.carrera.trim() : '';
    const dia = Number(body.dia);
    const mes = Number(body.mes);
    const tipo_cliente = body.tipo_cliente;
    const vehiculo = body.vehiculo;
    const paquete = body.paquete;

    if (!nombre || nombre.length > 120) {
      res.status(400).json({detail: 'ERROR: El nombre no puede quedar vacío.'});
      return;
    }
    if (!matricula || matricula.length > 40) {
      res.status(400).json({detail: 'ERROR: La matrícula no puede quedar vacía.'});
      return;
    }
    if (!carrera || carrera.length > 100) {
      res.status(400).json({detail: 'ERROR: La carrera no puede quedar vacía.'});
      return;
    }
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
      res.status(400).json({detail: 'ERROR: El día debe estar entre 1 y 31.'});
      return;
    }
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
      res.status(400).json({detail: 'ERROR: El mes debe estar entre 1 y 12.'});
      return;
    }
    if (!isValidClientType(tipo_cliente)) {
      res.status(400).json({detail: 'ERROR: Selecciona Alumno o Docente.'});
      return;
    }
    if (!isValidVehicle(vehiculo)) {
      res.status(400).json({detail: 'ERROR: Selecciona Patín o Bicicleta.'});
      return;
    }
    if (!isValidPackage(paquete)) {
      res.status(400).json({detail: 'ERROR: Selecciona un paquete válido.'});
      return;
    }

    const ano = 2026;
    const mesNombre = MESES[mes - 1];
    const fecha_renta = `${dia} de ${mesNombre} de ${ano}`;
    const pricing = calculatePricing(vehiculo, paquete);

    const rental: StoredRental = {
      id: `W2H-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      usuario: req.authUser || '',
      nombre,
      matricula,
      carrera,
      dia,
      mes,
      ano,
      fecha_renta,
      tipo_cliente,
      vehiculo,
      paquete,
      ...pricing,
      creado_en: Math.floor(Date.now() / 1000),
    };

    const rentals = readJsonArray<StoredRental>(RENTALS_FILE);
    rentals.unshift(rental);
    writeJsonArray(RENTALS_FILE, rentals);

    res.status(201).json({
      mensaje: 'Renta registrada con éxito',
      renta: rental,
    });
  });

  app.get('/api/rentals', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const rentals = readJsonArray<StoredRental>(RENTALS_FILE).filter(
      (r) => r.usuario === req.authUser
    );
    res.json({rentas: rentals});
  });

  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Way2Home server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Way2Home server:', err);
  process.exit(1);
});
