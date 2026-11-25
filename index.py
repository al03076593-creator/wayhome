"""
Way2Home - Backend Flask en la raíz (index.py) para Vercel y local (sin Uvicorn)
En Vercel se ejecuta mediante @vercel/python desde vercel.json.
En local se ejecuta directamente con: python index.py
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from functools import wraps
from pathlib import Path
from typing import Callable, Dict, List, Optional

from flask import Flask, g, jsonify, request, send_file
from flask_cors import CORS

PROJECT_ROOT = Path(__file__).resolve().parent

# En Vercel solo /tmp permite escritura; en local guarda en la raíz
IS_VERCEL = os.environ.get("VERCEL") == "1"
DATA_DIR = Path("/tmp") if IS_VERCEL else PROJECT_ROOT
USERS_FILE = DATA_DIR / "usuarios.txt"
RENTALS_FILE = DATA_DIR / "rentals.json"

TOKEN_SECRET = os.environ.get("WAY2HOME_SECRET", secrets.token_hex(32)).encode("utf-8")
TOKEN_TTL_SECONDS = 60 * 60 * 12  # 12 horas

ALLOWED_IMAGES = {
    "hero_campus_mobility_1795451347228.jpg",
    "vehicle_scooter_studio_1795451346994.jpg",
    "vehicle_bicycle_studio_1795451347488.jpg",
}

MESES = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
]

TARIFAS: Dict[str, Dict[str, int]] = {
    "Bicicleta": {"Por día": 80, "Semanal": 380, "Mensual": 900},
    "Patín": {"Por día": 120, "Semanal": 420, "Mensual": 1200},
}

VALID_CLIENT_TYPES = {"Alumno", "Docente"}
VALID_VEHICLES = {"Patín", "Bicicleta"}
VALID_PACKAGES = {"Por día", "Semanal", "Mensual"}

app = Flask(__name__)

# CORS restringido a orígenes locales y dominio configurado de Vercel
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
]
if os.environ.get("VERCEL_URL"):
    ALLOWED_ORIGINS.append(f"https://{os.environ['VERCEL_URL']}")

CORS(
    app,
    resources={r"/api/*": {"origins": ALLOWED_ORIGINS}},
    supports_credentials=False,
    allow_headers=["Content-Type", "Authorization"],
    methods=["GET", "POST", "OPTIONS"],
)

REVOKED_TOKENS = set()


def ensure_storage() -> None:
    if not USERS_FILE.exists():
        USERS_FILE.touch()
    if not RENTALS_FILE.exists():
        RENTALS_FILE.write_text("[]", encoding="utf-8")


def hash_password(password: str, salt: Optional[bytes] = None) -> str:
    salt_bytes = salt or secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt_bytes, n=16384, r=8, p=1)
    return f"{salt_bytes.hex()}:{derived.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt_hex, hash_hex = stored_hash.split(":", 1)
        salt_bytes = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
        actual = hashlib.scrypt(password.encode("utf-8"), salt=salt_bytes, n=16384, r=8, p=1)
        return hmac.compare_digest(actual, expected)
    except ValueError:
        return False


def create_session_token(usuario: str) -> str:
    payload = json.dumps(
        {"u": usuario, "exp": int(time.time()) + TOKEN_TTL_SECONDS},
        separators=(",", ":"),
    ).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    sig = hmac.new(TOKEN_SECRET, payload_b64.encode("ascii"), hashlib.sha256).hexdigest()[:32]
    return f"{payload_b64}.{sig}"


def verify_session_token(token: str) -> Optional[str]:
    if token in REVOKED_TOKENS or "." not in token:
        return None
    try:
        payload_b64, sig = token.split(".", 1)
        expected_sig = hmac.new(
            TOKEN_SECRET, payload_b64.encode("ascii"), hashlib.sha256
        ).hexdigest()[:32]
        if not hmac.compare_digest(sig, expected_sig):
            return None
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
        if int(data.get("exp", 0)) < int(time.time()):
            return None
        usuario = data.get("u")
        return usuario if isinstance(usuario, str) and usuario else None
    except Exception:
        return None


def load_users() -> Dict[str, str]:
    ensure_storage()
    users: Dict[str, str] = {}
    with USERS_FILE.open("r", encoding="utf-8") as f:
        for line in f:
            clean = line.strip()
            if not clean or "," not in clean:
                continue
            username, pwd_hash = clean.split(",", 1)
            users[username] = pwd_hash
    return users


def save_user(usuario: str, password_hash: str) -> None:
    ensure_storage()
    with USERS_FILE.open("a", encoding="utf-8") as f:
        f.write(f"{usuario},{password_hash}\n")


def load_rentals() -> List[dict]:
    ensure_storage()
    try:
        data = json.loads(RENTALS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def save_rentals(rentals: List[dict]) -> None:
    ensure_storage()
    RENTALS_FILE.write_text(json.dumps(rentals, ensure_ascii=False, indent=2), encoding="utf-8")


def require_auth(fn: Callable) -> Callable:
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"detail": "Debes iniciar sesión para continuar."}), 401
        token = auth_header.split(" ", 1)[1].strip()
        usuario = verify_session_token(token)
        if not usuario:
            return jsonify({"detail": "Tu sesión expiró o no es válida. Inicia sesión nuevamente."}), 401
        g.auth_user = usuario
        return fn(*args, **kwargs)

    return wrapper


def calculate_pricing(vehiculo: str, paquete: str) -> dict:
    costo_paquete = TARIFAS[vehiculo][paquete]
    if paquete == "Mensual":
        costo_casco = 0
        mensaje_casco = "Por tu paquete, el casco te lo llevas gratis"
    else:
        costo_casco = 100
        mensaje_casco = "Debes comprar un casco para poder utilizar el vehículo ($100 pesos)"
    total = costo_paquete + costo_casco
    return {
        "costo_paquete": costo_paquete,
        "costo_casco": costo_casco,
        "mensaje_casco": mensaje_casco,
        "total": total,
    }


def validate_auth_payload(payload: object):
    if not isinstance(payload, dict):
        return None, "Datos inválidos."
    usuario = payload.get("usuario")
    contrasena = payload.get("contrasena")
    if not isinstance(usuario, str) or not isinstance(contrasena, str):
        return None, "Usuario y contraseña deben ser texto."
    usuario = usuario.strip()
    if len(usuario) < 3 or len(usuario) > 40:
        return None, "El usuario debe tener entre 3 y 40 caracteres."
    if "," in usuario or any(ch.isspace() for ch in usuario):
        return None, "El usuario no puede contener espacios ni comas."
    if len(contrasena) < 4 or len(contrasena) > 128:
        return None, "La contraseña debe tener al menos 4 caracteres."
    return (usuario, contrasena), None


# Rutas para servir archivos estáticos de la raíz en ejecución local
@app.get("/")
def serve_index():
    return send_file(PROJECT_ROOT / "index.html")


@app.get("/styles.css")
def serve_styles():
    return send_file(PROJECT_ROOT / "styles.css")


@app.get("/app.js")
def serve_js():
    return send_file(PROJECT_ROOT / "app.js")


@app.get("/<image_name>")
def serve_image(image_name: str):
    if image_name not in ALLOWED_IMAGES:
        return jsonify({"detail": "No encontrado."}), 404
    return send_file(PROJECT_ROOT / image_name)


@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "servicio": "Way2Home"})


@app.post("/api/register")
def registrar():
    parsed, err = validate_auth_payload(request.get_json(silent=True))
    if err or parsed is None:
        return jsonify({"detail": err or "Datos inválidos."}), 400
    usuario, contrasena = parsed

    users = load_users()
    if any(existing.lower() == usuario.lower() for existing in users):
        return jsonify({"detail": "Ese nombre de usuario ya está registrado."}), 409

    save_user(usuario, hash_password(contrasena))
    token = create_session_token(usuario)
    return (
        jsonify(
            {
                "mensaje": "¡Usuario registrado con éxito!",
                "usuario": usuario,
                "token": token,
            }
        ),
        201,
    )


@app.post("/api/login")
def iniciar_sesion():
    parsed, err = validate_auth_payload(request.get_json(silent=True))
    if err or parsed is None:
        return jsonify({"detail": err or "Datos inválidos."}), 400
    usuario, contrasena = parsed

    users = load_users()
    stored_hash = users.get(usuario)
    if not stored_hash or not verify_password(contrasena, stored_hash):
        return jsonify({"detail": "Usuario o contraseña incorrectos."}), 401

    token = create_session_token(usuario)
    return jsonify(
        {
            "mensaje": f"¡Bienvenido, {usuario}!",
            "usuario": usuario,
            "token": token,
        }
    )


@app.get("/api/me")
@require_auth
def get_me():
    return jsonify({"usuario": g.auth_user})


@app.post("/api/logout")
def logout():
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        REVOKED_TOKENS.add(token)
    return jsonify({"mensaje": "Sesión cerrada correctamente."})


@app.post("/api/quote")
def quote():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"detail": "Datos inválidos."}), 400
    vehiculo = payload.get("vehiculo")
    paquete = payload.get("paquete")
    if vehiculo not in VALID_VEHICLES or paquete not in VALID_PACKAGES:
        return jsonify({"detail": "Vehículo o paquete no válido."}), 400
    return jsonify(calculate_pricing(vehiculo, paquete))


@app.post("/api/rentals")
@require_auth
def create_rental():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"detail": "Cuerpo de solicitud inválido."}), 400

    nombre = payload.get("nombre")
    matricula = payload.get("matricula")
    carrera = payload.get("carrera")
    dia = payload.get("dia")
    mes = payload.get("mes")
    tipo_cliente = payload.get("tipo_cliente")
    vehiculo = payload.get("vehiculo")
    paquete = payload.get("paquete")

    if not isinstance(nombre, str) or not nombre.strip() or len(nombre.strip()) > 120:
        return jsonify({"detail": "ERROR: El nombre no puede quedar vacío."}), 400
    if not isinstance(matricula, str) or not matricula.strip() or len(matricula.strip()) > 40:
        return jsonify({"detail": "ERROR: La matrícula no puede quedar vacía."}), 400
    if not isinstance(carrera, str) or not carrera.strip() or len(carrera.strip()) > 100:
        return jsonify({"detail": "ERROR: La carrera no puede quedar vacía."}), 400
    if not isinstance(dia, int) or isinstance(dia, bool) or dia < 1 or dia > 31:
        return jsonify({"detail": "ERROR: El día debe estar entre 1 y 31."}), 400
    if not isinstance(mes, int) or isinstance(mes, bool) or mes < 1 or mes > 12:
        return jsonify({"detail": "ERROR: El mes debe estar entre 1 y 12."}), 400
    if tipo_cliente not in VALID_CLIENT_TYPES:
        return jsonify({"detail": "ERROR: Selecciona Alumno o Docente."}), 400
    if vehiculo not in VALID_VEHICLES:
        return jsonify({"detail": "ERROR: Selecciona Patín o Bicicleta."}), 400
    if paquete not in VALID_PACKAGES:
        return jsonify({"detail": "ERROR: Selecciona un paquete válido."}), 400

    ano = 2026
    fecha_renta = f"{dia} de {MESES[mes - 1]} de {ano}"
    pricing = calculate_pricing(vehiculo, paquete)

    rental = {
        "id": f"W2H-{secrets.token_hex(3).upper()}",
        "usuario": g.auth_user,
        "nombre": nombre.strip(),
        "matricula": matricula.strip(),
        "carrera": carrera.strip(),
        "dia": dia,
        "mes": mes,
        "ano": ano,
        "fecha_renta": fecha_renta,
        "tipo_cliente": tipo_cliente,
        "vehiculo": vehiculo,
        "paquete": paquete,
        **pricing,
        "creado_en": int(time.time()),
    }

    rentals = load_rentals()
    rentals.insert(0, rental)
    save_rentals(rentals)
    return jsonify({"mensaje": "Renta registrada con éxito", "renta": rental}), 201


@app.get("/api/rentals")
@require_auth
def list_rentals():
    rentals = [r for r in load_rentals() if r.get("usuario") == g.auth_user]
    return jsonify({"rentas": rentals})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="127.0.0.1", port=port, debug=False)
