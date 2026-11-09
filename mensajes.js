// ============================================================
// CAJÓN DE FRASES DEL MENTOR
// Aquí están TODOS los textos que ve el alumno.
// Para cambiar la voz del mentor, edita solo este archivo.
// (Aquí no hay lógica: solo frases).
// ============================================================

// Nombre del mentor. Todo texto que lo nombre usa esta constante.
const NOMBRE_MENTOR = "[NOMBRE]";

// Da formato al saldo para leerlo cómodo, p. ej. "10000.0000000" -> "10.000,00"
function formatearSaldo(saldo) {
  return Number(saldo).toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  });
}

// Frase para cuando no se pudo leer la red (sin conexión o error del servidor).
// La usan fallaRed y errorServidor. JAMÁS decir aquí que la cuenta no existe.
const textoFallaRed =
  "Intenté mirar la red y no me respondió. No es tu cuenta, es la conexión. Vuelve a mandármela en un minuto.";

// Link que abre ESA cuenta en un explorador público de la testnet.
const linkExplorador = (llave) => `https://stellar.expert/explorer/testnet/account/${llave}`;

// Parte común del mensaje de hito cumplido. La usan cuentaActiva y cuentaActivaRepetida.
const textoHitoCumplido = (saldo, llave) =>
  `¡Lo lograste! Acabo de mirar la testnet y tu cuenta está activa, con ${formatearSaldo(saldo)} XLM de prueba. ` +
  "No es de palabra: lo verifiqué directamente en la red, y cualquiera puede comprobarlo. Hito 1 cumplido.\n" +
  `Compruébalo tú mismo: ${linkExplorador(llave)}`;

export const mensajes = {
  // /start, saludos o cualquier texto que no tenga forma de llave.
  bienvenida:
    `Hola, soy ${NOMBRE_MENTOR}, tu mentor de Stellar. Terminaste el taller y te voy a acompañar paso a paso: ` +
    "tú avanzas, me lo cuentas aquí, y cada avance lo compruebo en la red. " +
    "Primer hito: crea tu cuenta en la testnet de Stellar y pégame aquí tu llave pública, la que empieza con G.",

  // Tiene forma de llave (G, 56 caracteres), pero no es una llave pública válida.
  noPareceLlave:
    "Para verificar tu avance necesito tu llave pública: el texto largo que empieza con G. Pégamela aquí.",

  // La cuenta existe y está activa en testnet (saldo leído en vivo de la red).
  // Primera vez: incluye el aviso de que el mentor volverá a escribir.
  cuentaActiva: (saldo, llave) =>
    textoHitoCumplido(saldo, llave) + "\n" + "En un rato te vuelvo a escribir con el siguiente paso.",

  // Igual que cuentaActiva, pero sin el aviso: para cuando el seguimiento ya está programado o enviado.
  cuentaActivaRepetida: (saldo, llave) => textoHitoCumplido(saldo, llave),

  // La cuenta no existe en testnet, pero sí en la red principal (mainnet). No cuenta como hito.
  cuentaEnRedPrincipal:
    "Veo tu cuenta en la red principal de Stellar, pero este hito es en testnet, la red de práctica (gratis, sin dinero real). " +
    "Crea una cuenta en testnet y pégame esa llave.",

  // La red respondió que la cuenta aún no existe / no está activa.
  cuentaNoEncontrada:
    "Todavía no veo esa cuenta activa en la testnet. Casi siempre falta fondearla: hazlo y vuelve a mandármela.",

  // No hubo conexión con la red.
  fallaRed: textoFallaRed,

  // La red respondió, pero con un error suyo. Mismo texto que fallaRed.
  errorServidor: textoFallaRed,

  // Seguimiento proactivo: se envía solo, unos minutos después de confirmar la cuenta activa.
  seguimiento:
    "Volví, como te dije. Así van a ser estos 30 días: no tienes que acordarte de mí, yo te busco. " +
    "Tu próximo hito es desplegar tu primer contrato en la testnet.",
};
