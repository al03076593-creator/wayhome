// Way2Home Frontend Controller (Vanilla ES Module)
// Conecta con los endpoints REST del backend (/api/register, /api/login, /api/logout, /api/me, /api/quote, /api/rentals)

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
];

const TARIFAS = {
  Bicicleta: { 'Por día': 80, Semanal: 380, Mensual: 900 },
  Patín: { 'Por día': 120, Semanal: 420, Mensual: 1200 },
};

// Token de sesión mantenido únicamente en memoria JS (seguridad)
let authToken = null;
let currentUser = null;
let authMode = 'login';

const rentalSelection = {
  tipo_cliente: 'Alumno',
  vehiculo: 'Patín',
  paquete: 'Por día',
};

// Referencias del DOM
const headerAuthAction = document.getElementById('headerAuthAction');
const mobileMenuToggle = document.getElementById('mobileMenuToggle');
const mobileNavDrawer = document.getElementById('mobileNavDrawer');

const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const authForm = document.getElementById('authForm');
const authUsuario = document.getElementById('authUsuario');
const authContrasena = document.getElementById('authContrasena');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const authSubmitLabel = document.getElementById('authSubmitLabel');
const authFeedback = document.getElementById('authFeedback');
const authLoggedOutView = document.getElementById('authLoggedOutView');
const authLoggedInView = document.getElementById('authLoggedInView');
const activeUsernameDisplay = document.getElementById('activeUsernameDisplay');
const logoutBtn = document.getElementById('logoutBtn');

const rentalForm = document.getElementById('rentalForm');
const inputNombre = document.getElementById('inputNombre');
const inputMatricula = document.getElementById('inputMatricula');
const inputCarrera = document.getElementById('inputCarrera');
const inputDia = document.getElementById('inputDia');
const inputMes = document.getElementById('inputMes');
const rentalFeedback = document.getElementById('rentalFeedback');
const rentalSubmitBtn = document.getElementById('rentalSubmitBtn');
const rentalSubmitLabel = document.getElementById('rentalSubmitLabel');

const previewCliente = document.getElementById('previewCliente');
const previewVehiculo = document.getElementById('previewVehiculo');
const previewPaquete = document.getElementById('previewPaquete');
const previewFecha = document.getElementById('previewFecha');
const previewCostoPaquete = document.getElementById('previewCostoPaquete');
const previewCostoCasco = document.getElementById('previewCostoCasco');
const previewHelmetNote = document.getElementById('previewHelmetNote');
const previewTotal = document.getElementById('previewTotal');

const receiptSection = document.getElementById('receiptSection');
const receiptFolio = document.getElementById('receiptFolio');
const receiptUsuario = document.getElementById('receiptUsuario');
const receiptNombre = document.getElementById('receiptNombre');
const receiptMatricula = document.getElementById('receiptMatricula');
const receiptCarrera = document.getElementById('receiptCarrera');
const receiptFecha = document.getElementById('receiptFecha');
const receiptCliente = document.getElementById('receiptCliente');
const receiptVehiculo = document.getElementById('receiptVehiculo');
const receiptPaquete = document.getElementById('receiptPaquete');
const receiptCostoPaquete = document.getElementById('receiptCostoPaquete');
const receiptCostoCasco = document.getElementById('receiptCostoCasco');
const receiptTotal = document.getElementById('receiptTotal');
const printReceiptBtn = document.getElementById('printReceiptBtn');
const newRentalBtn = document.getElementById('newRentalBtn');

const historySection = document.getElementById('historySection');
const historyList = document.getElementById('historyList');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');

function formatCurrency(amount) {
  return `$${Number(amount).toLocaleString('es-MX')} MXN`;
}

function setLoading(button, labelEl, isLoading, defaultText, loadingText) {
  const spinner = button.querySelector('.btn-spinner');
  button.disabled = isLoading;
  if (spinner) {
    spinner.hidden = !isLoading;
  }
  labelEl.textContent = isLoading ? loadingText : defaultText;
}

function showFeedback(el, type, message) {
  el.textContent = message;
  el.classList.remove('is-success', 'is-error');
  el.classList.add(type === 'success' ? 'is-success' : 'is-error');
  el.hidden = false;
}

function clearFeedback(el) {
  el.textContent = '';
  el.classList.remove('is-success', 'is-error');
  el.hidden = true;
}

async function apiRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || 'Ocurrió un error al comunicarse con el servidor.');
  }
  return data;
}

function setAuthMode(mode) {
  authMode = mode;
  clearFeedback(authFeedback);

  const isLogin = mode === 'login';
  tabLogin.classList.toggle('is-active', isLogin);
  tabLogin.setAttribute('aria-selected', String(isLogin));
  tabRegister.classList.toggle('is-active', !isLogin);
  tabRegister.setAttribute('aria-selected', String(!isLogin));

  authContrasena.setAttribute('autocomplete', isLogin ? 'current-password' : 'new-password');
  authSubmitLabel.textContent = isLogin ? 'Iniciar sesión' : 'Registrar usuario';
}

function updateSessionUI() {
  const loggedIn = Boolean(authToken && currentUser);
  authLoggedOutView.hidden = loggedIn;
  authLoggedInView.hidden = !loggedIn;
  historySection.hidden = !loggedIn;

  if (loggedIn) {
    activeUsernameDisplay.textContent = currentUser;
    headerAuthAction.textContent = 'Cerrar sesión';
    loadRentalHistory();
  } else {
    activeUsernameDisplay.textContent = '';
    headerAuthAction.textContent = 'Iniciar sesión';
    historyList.replaceChildren();
  }
}

async function updatePreview() {
  const diaNum = Number.parseInt(inputDia.value, 10);
  const mesNum = Number.parseInt(inputMes.value, 10);
  const diaTexto = Number.isInteger(diaNum) && diaNum >= 1 && diaNum <= 31 ? diaNum : '—';
  const mesTexto = mesNum >= 1 && mesNum <= 12 ? MESES[mesNum - 1] : '—';

  previewCliente.textContent = rentalSelection.tipo_cliente;
  previewVehiculo.textContent = rentalSelection.vehiculo;
  previewPaquete.textContent = rentalSelection.paquete;
  previewFecha.textContent = `${diaTexto} de ${mesTexto} de 2026`;

  // Cálculo local inmediato mientras consultamos /api/quote
  const localPaquete = TARIFAS[rentalSelection.vehiculo][rentalSelection.paquete];
  const localCasco = rentalSelection.paquete === 'Mensual' ? 0 : 100;
  const localTotal = localPaquete + localCasco;

  previewCostoPaquete.textContent = formatCurrency(localPaquete);
  previewCostoCasco.textContent = formatCurrency(localCasco);
  previewTotal.textContent = formatCurrency(localTotal);
  previewHelmetNote.textContent =
    localCasco === 0
      ? 'Por tu paquete mensual, el casco te lo llevas gratis.'
      : 'Debes comprar un casco para poder utilizar el vehículo ($100 pesos).';

  try {
    const quote = await apiRequest('/api/quote', {
      method: 'POST',
      body: JSON.stringify({
        vehiculo: rentalSelection.vehiculo,
        paquete: rentalSelection.paquete,
      }),
    });
    previewCostoPaquete.textContent = formatCurrency(quote.costo_paquete);
    previewCostoCasco.textContent = formatCurrency(quote.costo_casco);
    previewTotal.textContent = formatCurrency(quote.total);
    previewHelmetNote.textContent = quote.mensaje_casco;
  } catch {
    // Mantiene la vista previa local si la red falla momentáneamente
  }
}

function selectGroupOption(group, value) {
  rentalSelection[group] = value;
  const buttons = document.querySelectorAll(`.choice-card[data-group="${group}"]`);
  buttons.forEach((btn) => {
    const selected = btn.dataset.value === value;
    btn.classList.toggle('is-selected', selected);
    btn.setAttribute('aria-checked', String(selected));
  });
  updatePreview();
}

function renderReceipt(renta) {
  receiptFolio.textContent = renta.id;
  receiptUsuario.textContent = renta.usuario;
  receiptNombre.textContent = renta.nombre;
  receiptMatricula.textContent = renta.matricula;
  receiptCarrera.textContent = renta.carrera;
  receiptFecha.textContent = renta.fecha_renta;
  receiptCliente.textContent = renta.tipo_cliente;
  receiptVehiculo.textContent = renta.vehiculo;
  receiptPaquete.textContent = renta.paquete;
  receiptCostoPaquete.textContent = formatCurrency(renta.costo_paquete);
  receiptCostoCasco.textContent =
    renta.costo_casco === 0 ? '$0 MXN (Gratis)' : formatCurrency(renta.costo_casco);
  receiptTotal.textContent = formatCurrency(renta.total);

  receiptSection.hidden = false;
  receiptSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderHistory(rentas) {
  historyList.replaceChildren();

  if (!rentas.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'Aún no tienes rentas registradas con esta cuenta.';
    historyList.appendChild(empty);
    return;
  }

  rentas.forEach((renta) => {
    const item = document.createElement('div');
    item.className = 'history-item';

    const col1 = document.createElement('div');
    const title = document.createElement('p');
    title.className = 'history-primary';
    title.textContent = `${renta.vehiculo} · ${renta.paquete}`;
    const sub1 = document.createElement('p');
    sub1.className = 'history-sub';
    sub1.textContent = `${renta.id} · ${renta.fecha_renta}`;
    col1.append(title, sub1);

    const col2 = document.createElement('div');
    const client = document.createElement('p');
    client.className = 'history-primary';
    client.textContent = renta.nombre;
    const sub2 = document.createElement('p');
    sub2.className = 'history-sub';
    sub2.textContent = `${renta.tipo_cliente} · ${renta.matricula}`;
    col2.append(client, sub2);

    const col3 = document.createElement('div');
    const helmet = document.createElement('p');
    helmet.className = 'history-sub';
    helmet.textContent =
      renta.costo_casco === 0 ? 'Casco incluido ($0)' : 'Casco incluido ($100)';
    col3.appendChild(helmet);

    const col4 = document.createElement('div');
    col4.className = 'history-total tabular-nums';
    col4.textContent = formatCurrency(renta.total);

    item.append(col1, col2, col3, col4);
    historyList.appendChild(item);
  });
}

async function loadRentalHistory() {
  if (!authToken) {
    return;
  }
  try {
    const data = await apiRequest('/api/rentals', { method: 'GET' });
    renderHistory(Array.isArray(data.rentas) ? data.rentas : []);
  } catch (err) {
    historyList.replaceChildren();
    const errorBox = document.createElement('div');
    errorBox.className = 'history-empty';
    errorBox.textContent = err.message || 'No se pudo cargar tu historial.';
    historyList.appendChild(errorBox);
  }
}

// Event Listeners
mobileMenuToggle.addEventListener('click', () => {
  const isOpen = !mobileNavDrawer.hidden;
  mobileNavDrawer.hidden = isOpen;
  mobileMenuToggle.setAttribute('aria-expanded', String(!isOpen));
});

document.querySelectorAll('.mobile-nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    mobileNavDrawer.hidden = true;
    mobileMenuToggle.setAttribute('aria-expanded', 'false');
  });
});

headerAuthAction.addEventListener('click', async () => {
  if (authToken) {
    await handleLogout();
  } else {
    document.getElementById('mi-cuenta').scrollIntoView({ behavior: 'smooth', block: 'center' });
    authUsuario.focus();
  }
});

tabLogin.addEventListener('click', () => setAuthMode('login'));
tabRegister.addEventListener('click', () => setAuthMode('register'));

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFeedback(authFeedback);

  const usuario = authUsuario.value.trim();
  const contrasena = authContrasena.value;

  if (usuario.length < 3 || /[\s,]/.test(usuario)) {
    showFeedback(
      authFeedback,
      'error',
      'Ingresa un usuario válido (mínimo 3 caracteres, sin espacios ni comas).'
    );
    authUsuario.focus();
    return;
  }
  if (contrasena.length < 4) {
    showFeedback(authFeedback, 'error', 'La contraseña debe tener al menos 4 caracteres.');
    authContrasena.focus();
    return;
  }

  const endpoint = authMode === 'login' ? '/api/login' : '/api/register';
  const defaultLabel = authMode === 'login' ? 'Iniciar sesión' : 'Registrar usuario';
  const loadingLabel = authMode === 'login' ? 'Buscando usuario...' : 'Creando cuenta...';

  setLoading(authSubmitBtn, authSubmitLabel, true, defaultLabel, loadingLabel);
  try {
    const data = await apiRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify({ usuario, contrasena }),
    });
    authToken = data.token;
    currentUser = data.usuario;
    authContrasena.value = '';
    clearFeedback(rentalFeedback);
    updateSessionUI();
  } catch (err) {
    showFeedback(authFeedback, 'error', err.message);
  } finally {
    setLoading(authSubmitBtn, authSubmitLabel, false, defaultLabel, loadingLabel);
  }
});

async function handleLogout() {
  try {
    await apiRequest('/api/logout', { method: 'POST' });
  } catch {
    // Continuar con limpieza local
  }
  authToken = null;
  currentUser = null;
  receiptSection.hidden = true;
  updateSessionUI();
}

logoutBtn.addEventListener('click', handleLogout);

document.querySelectorAll('.select-vehicle-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    selectGroupOption('vehiculo', btn.dataset.vehicle);
    document.getElementById('reservar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

document.querySelectorAll('.choice-card').forEach((btn) => {
  btn.addEventListener('click', () => {
    selectGroupOption(btn.dataset.group, btn.dataset.value);
  });
});

inputDia.addEventListener('input', updatePreview);
inputMes.addEventListener('change', updatePreview);

rentalForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFeedback(rentalFeedback);
  [inputNombre, inputMatricula, inputCarrera, inputDia].forEach((el) =>
    el.classList.remove('is-invalid')
  );

  if (!authToken) {
    showFeedback(
      rentalFeedback,
      'error',
      'Inicia sesión o crea una cuenta arriba antes de confirmar tu renta.'
    );
    document.getElementById('mi-cuenta').scrollIntoView({ behavior: 'smooth', block: 'center' });
    authUsuario.focus();
    return;
  }

  const nombre = inputNombre.value.trim();
  const matricula = inputMatricula.value.trim();
  const carrera = inputCarrera.value.trim();
  const dia = Number.parseInt(inputDia.value, 10);
  const mes = Number.parseInt(inputMes.value, 10);

  if (!nombre) {
    inputNombre.classList.add('is-invalid');
    showFeedback(rentalFeedback, 'error', 'ERROR: El nombre no puede quedar vacío.');
    inputNombre.focus();
    return;
  }
  if (!matricula) {
    inputMatricula.classList.add('is-invalid');
    showFeedback(rentalFeedback, 'error', 'ERROR: La matrícula no puede quedar vacía.');
    inputMatricula.focus();
    return;
  }
  if (!carrera) {
    inputCarrera.classList.add('is-invalid');
    showFeedback(rentalFeedback, 'error', 'ERROR: La carrera no puede quedar vacía.');
    inputCarrera.focus();
    return;
  }
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    inputDia.classList.add('is-invalid');
    showFeedback(rentalFeedback, 'error', 'ERROR: El día debe estar entre 1 y 31.');
    inputDia.focus();
    return;
  }
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    showFeedback(rentalFeedback, 'error', 'ERROR: El mes debe estar entre 1 y 12.');
    inputMes.focus();
    return;
  }

  setLoading(
    rentalSubmitBtn,
    rentalSubmitLabel,
    true,
    'Confirmar y generar resumen',
    'Procesando renta...'
  );

  try {
    const data = await apiRequest('/api/rentals', {
      method: 'POST',
      body: JSON.stringify({
        nombre,
        matricula,
        carrera,
        dia,
        mes,
        tipo_cliente: rentalSelection.tipo_cliente,
        vehiculo: rentalSelection.vehiculo,
        paquete: rentalSelection.paquete,
      }),
    });

    showFeedback(rentalFeedback, 'success', data.mensaje || 'Renta registrada con éxito.');
    renderReceipt(data.renta);
    await loadRentalHistory();
  } catch (err) {
    showFeedback(rentalFeedback, 'error', err.message);
  } finally {
    setLoading(
      rentalSubmitBtn,
      rentalSubmitLabel,
      false,
      'Confirmar y generar resumen',
      'Procesando renta...'
    );
  }
});

printReceiptBtn.addEventListener('click', () => {
  window.print();
});

newRentalBtn.addEventListener('click', () => {
  receiptSection.hidden = true;
  clearFeedback(rentalFeedback);
  document.getElementById('reservar').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

refreshHistoryBtn.addEventListener('click', loadRentalHistory);

// Inicialización
updateSessionUI();
updatePreview();
