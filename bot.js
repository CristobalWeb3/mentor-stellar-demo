// Bot mentor de Stellar (demo): el alumno pega su llave pública y el bot
// verifica en vivo, en la testnet (solo lectura), si su cuenta está activa.
// Sin IA: las respuestas son frases fijas de mensajes.js. No usa base de datos ni archivos:
// solo recuerda en memoria a qué chats ya les programó el seguimiento (se pierde al reiniciar).
// Usa long-polling (el bot le pregunta a Telegram si hay mensajes nuevos). Sin webhooks.

import "dotenv/config"; // carga las variables del archivo .env
import TelegramBot from "node-telegram-bot-api";
import { verificarCuenta } from "./verificar-cuenta.js";
import { mensajes } from "./mensajes.js";

// El token se lee SOLO desde la variable de entorno. Nunca va escrito en el código.
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token || token.trim() === "" || token === "pega_tu_token_aqui") {
  console.error(
    "ERROR: falta la variable TELEGRAM_BOT_TOKEN.\n" +
      "Crea un archivo .env (copia .env.example) y pon tu token real en la línea:\n" +
      "TELEGRAM_BOT_TOKEN=tu_token\n" +
      "El bot no se iniciará sin token."
  );
  process.exit(1);
}

// ------------------------------------------------------------
// Tiempos del guardián de conexión (todos en milisegundos)
// ------------------------------------------------------------

// Tiempo máximo que puede durar cualquier petición a Telegram. La librería no pone ninguno,
// así que una conexión "zombi" (wifi cortado, notebook suspendido) quedaría esperando para siempre.
// La escucha normal dura hasta 10 s (Telegram espera ese tiempo por mensajes), así que 30 s es holgado.
const TIEMPO_MAXIMO_PETICION_MS = 30 * 1000;
// Cada cuánto el guardián revisa que Telegram responde.
const PERIODO_GUARDIAN_MS = 60 * 1000;
// Tiempo máximo propio para la revisión liviana (getMe), para que tampoco pueda quedarse colgada.
const TIEMPO_MAXIMO_GETME_MS = 10 * 1000;
// Cuántas revisiones seguidas pueden fallar antes de reiniciar la escucha.
const FALLAS_SEGUIDAS_PARA_REINICIAR = 3;
// Si la petición de escucha actual lleva más que esto sin terminar, se considera colgada.
const TIEMPO_MAXIMO_ESCUCHA_COLGADA_MS = 40 * 1000;
// Si entre dos revisiones del guardián pasó más que esto, se asume que el equipo estuvo suspendido.
const UMBRAL_SUSPENSION_MS = 90 * 1000;
// Al reiniciar: espera tras cancelar la escucha vieja antes de comprobar si hace falta abrir otra.
// Debe ser mayor que los 0,3 s que tarda la librería en reanudar su propia escucha.
const ESPERA_TRAS_CANCELAR_MS = 1500;
// Mientras la conexión está caída, como máximo un resumen en la terminal cada tanto.
const INTERVALO_RESUMEN_CAIDA_MS = 60 * 1000;

const bot = new TelegramBot(token.trim(), {
  polling: true,
  request: { timeout: TIEMPO_MAXIMO_PETICION_MS },
});

// Evita que el token aparezca en la consola si algún error lo incluye.
const ocultarToken = (texto) => String(texto).split(token.trim()).join("***");

// Mensaje en la terminal con fecha y hora, siempre ocultando el token.
function fechaHora() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const log = (texto) => console.log(`[${fechaHora()}] ${ocultarToken(texto)}`);
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------
// Seguimiento proactivo (modo demo, todo en memoria)
// ------------------------------------------------------------

// Minutos de espera antes del seguimiento. Se leen de SEGUIMIENTO_MINUTOS en el .env.
// Si falta, está vacía o no es un número válido mayor que 0, se usan 2 minutos.
const MINUTOS_POR_DEFECTO = 2;
// Límite técnico del temporizador de Node (unos 24 días); por encima se usa el valor por defecto.
const MINUTOS_MAXIMOS = 35000;

const valorEnv = (process.env.SEGUIMIENTO_MINUTOS ?? "").trim();
const numeroEnv = Number(valorEnv);
const valorEnvValido =
  valorEnv !== "" && Number.isFinite(numeroEnv) && numeroEnv > 0 && numeroEnv <= MINUTOS_MAXIMOS;
const minutosSeguimiento = valorEnvValido ? numeroEnv : MINUTOS_POR_DEFECTO;

// Chats a los que ya se les programó el seguimiento. Un chat entra aquí una sola vez
// y no sale mientras el bot siga encendido (aunque el seguimiento ya se haya enviado).
const chatsConSeguimiento = new Set();

function programarSeguimiento(chatId) {
  if (chatsConSeguimiento.has(chatId)) return; // ya tiene uno: no se duplica
  chatsConSeguimiento.add(chatId);

  setTimeout(async () => {
    try {
      await bot.sendMessage(chatId, mensajes.seguimiento);
    } catch (error) {
      // Por ejemplo, el alumno bloqueó el bot. Se registra y el bot sigue funcionando.
      console.error(`No pude enviar el seguimiento al chat ${chatId}:`, ocultarToken(error.message));
    }
  }, minutosSeguimiento * 60 * 1000);
}

// Traduce el resultado de verificarCuenta a la frase del mentor.
function respuestaSegunEstado(resultado, chatId) {
  switch (resultado.estado) {
    case "ACTIVA":
      // Si este chat ya tiene seguimiento (programado o enviado), no se promete otro.
      return chatsConSeguimiento.has(chatId)
        ? mensajes.cuentaActivaRepetida(resultado.saldoXLM)
        : mensajes.cuentaActiva(resultado.saldoXLM);
    case "NO_ENCONTRADA":
      return mensajes.cuentaNoEncontrada;
    case "INVALIDA":
      return mensajes.noPareceLlave;
    case "ERROR_SERVIDOR":
      return mensajes.errorServidor;
    case "FALLA_RED":
    default:
      // Ante cualquier cosa inesperada, nunca decir que la cuenta no existe.
      return mensajes.fallaRed;
  }
}

bot.on("message", async (msg) => {
  if (!msg.text) return; // ignora fotos, stickers, etc.: solo mensajes de texto

  const texto = msg.text.trim();
  let respuesta;
  let cuentaActiva = false; // solo será true si el verificador devolvió "ACTIVA"

  // "Parece una llave": empieza con G mayúscula, tiene 56 caracteres y no tiene espacios.
  const pareceLlave = texto.startsWith("G") && texto.length === 56 && !/\s/.test(texto);

  if (pareceLlave) {
    // Parece una llave: leer la testnet en vivo.
    try {
      const resultado = await verificarCuenta(texto);
      respuesta = respuestaSegunEstado(resultado, msg.chat.id);
      cuentaActiva = resultado.estado === "ACTIVA";
    } catch (error) {
      // Seguro extra: si algo falla inesperadamente, se trata como falla de red.
      console.error("Error inesperado al verificar:", ocultarToken(error.message));
      respuesta = mensajes.fallaRed;
    }
  } else {
    // No parece una llave: saludo de mentor e invitación a pegarla.
    respuesta = mensajes.bienvenida;
  }

  try {
    await bot.sendMessage(msg.chat.id, respuesta);
    // Solo si la cuenta está activa Y el mensaje de cuenta activa se envió bien.
    if (cuentaActiva) programarSeguimiento(msg.chat.id);
  } catch (error) {
    console.error("No pude enviar la respuesta:", ocultarToken(error.message));
  }
});

// ------------------------------------------------------------
// Estado de la conexión: avisos sin inundar la terminal
// ------------------------------------------------------------

const estadoConexion = {
  caida: false,
  inicioCaida: null,
  ultimoResumen: null,
  erroresDesdeResumen: 0,
};

// Se llama en cada error de conexión (escucha o getMe). Imprime el primero de la racha,
// luego como máximo un resumen por INTERVALO_RESUMEN_CAIDA_MS.
function registrarErrorConexion(motivo) {
  const ahora = Date.now();
  if (!estadoConexion.caida) {
    estadoConexion.caida = true;
    estadoConexion.inicioCaida = ahora;
    estadoConexion.ultimoResumen = ahora;
    estadoConexion.erroresDesdeResumen = 1;
    log(`Conexión con Telegram caída: ${motivo}`);
    return;
  }
  estadoConexion.erroresDesdeResumen += 1;
  if (ahora - estadoConexion.ultimoResumen >= INTERVALO_RESUMEN_CAIDA_MS) {
    log(
      `Conexión con Telegram sigue caída: ${estadoConexion.erroresDesdeResumen} errores en el último minuto (último: ${motivo})`
    );
    estadoConexion.ultimoResumen = ahora;
    estadoConexion.erroresDesdeResumen = 0;
  }
}

// Se llama en cada respuesta exitosa de Telegram (escucha o getMe). Avisa una sola vez por caída.
function registrarRespuestaExitosa() {
  if (!estadoConexion.caida) return;
  const segundos = Math.round((Date.now() - estadoConexion.inicioCaida) / 1000);
  log(`Conexión con Telegram recuperada tras ${segundos} segundos.`);
  estadoConexion.caida = false;
  estadoConexion.inicioCaida = null;
  estadoConexion.ultimoResumen = null;
  estadoConexion.erroresDesdeResumen = 0;
}

const describirError = (error) =>
  error && error.code ? `${error.code} ${error.message}` : String(error && error.message ? error.message : error);

// ------------------------------------------------------------
// Escucha: cuándo empezó la petición actual (para detectar una escucha colgada)
// ------------------------------------------------------------

// Envuelve bot.getUpdates (la petición que usa la librería para escuchar) SIN tocar la librería:
// anota cuándo empieza y cuándo termina cada petición, y avisa si fue exitosa.
let inicioPeticionEscucha = null;
const getUpdatesOriginal = bot.getUpdates.bind(bot);
bot.getUpdates = (...args) => {
  inicioPeticionEscucha = Date.now();
  return getUpdatesOriginal(...args).then(
    (resultado) => {
      inicioPeticionEscucha = null;
      registrarRespuestaExitosa();
      return resultado;
    },
    (error) => {
      inicioPeticionEscucha = null;
      throw error;
    }
  );
};

// ------------------------------------------------------------
// Reinicio de la escucha (dentro del mismo programa, nunca se mata el proceso)
// ------------------------------------------------------------

// Cerrojo: mientras es true, ningún otro reinicio puede empezar.
let reiniciando = false;

// Cómo se garantiza UNA sola escucha:
// 1) Si ya hay un reinicio en curso, este pedido se ignora (cerrojo `reiniciando`).
// 2) Se cancela la petición colgada. La propia librería reanuda su escucha sola ~0,3 s después.
// 3) Se espera ESPERA_TRAS_CANCELAR_MS (más que esos 0,3 s) y se pregunta si ya hay escucha.
//    Solo si NO la hay se abre una, con restart:false (que no hace nada si ya existe una).
async function reiniciarEscucha(motivo) {
  if (reiniciando) {
    log(`Guardián: ya hay un reinicio en curso, se ignora el pedido (${motivo}).`);
    return false;
  }
  reiniciando = true;
  try {
    log(`Guardián: reiniciando la escucha. Motivo: ${motivo}.`);
    await bot.stopPolling({ cancel: true, reason: "Reinicio por guardián" });
    inicioPeticionEscucha = null;
    await esperar(ESPERA_TRAS_CANCELAR_MS);
    if (!bot.isPolling()) {
      await bot.startPolling({ restart: false });
    }
    log("Guardián: escucha reiniciada.");
    return true;
  } catch (error) {
    log(`Guardián: no pude reiniciar la escucha (${describirError(error)}). Se reintentará en la próxima revisión.`);
    return false;
  } finally {
    reiniciando = false;
  }
}

// ------------------------------------------------------------
// Guardián: revisión periódica de que Telegram responde
// ------------------------------------------------------------

// getMe con un reloj propio: si no responde a tiempo, cuenta como falla (no se queda colgado).
function getMeConTiempoMaximo() {
  return new Promise((resolve) => {
    const reloj = setTimeout(
      () => resolve({ ok: false, motivo: `getMe sin respuesta en ${TIEMPO_MAXIMO_GETME_MS / 1000} s` }),
      TIEMPO_MAXIMO_GETME_MS
    );
    bot.getMe().then(
      () => {
        clearTimeout(reloj);
        resolve({ ok: true });
      },
      (error) => {
        clearTimeout(reloj);
        resolve({ ok: false, motivo: `getMe falló: ${describirError(error)}` });
      }
    );
  });
}

let fallasSeguidasGetMe = 0;

async function revisionGuardian(programadoEn) {
  const transcurrido = Date.now() - programadoEn;

  // Vuelta de una suspensión: pasó mucho más tiempo del esperado entre dos revisiones.
  if (transcurrido > UMBRAL_SUSPENSION_MS) {
    log(
      `Guardián: pasaron ${Math.round(transcurrido / 1000)} s desde la revisión anterior (esperaba ~${PERIODO_GUARDIAN_MS / 1000}): parece una vuelta de suspensión.`
    );
    await reiniciarEscucha("vuelta de suspensión");
    return;
  }

  // Escucha colgada: la petición actual lleva demasiado tiempo sin terminar.
  // El silencio por falta de mensajes NO cuenta: una escucha sana termina cada ~10 s aunque nadie escriba.
  if (inicioPeticionEscucha !== null && Date.now() - inicioPeticionEscucha > TIEMPO_MAXIMO_ESCUCHA_COLGADA_MS) {
    const segundos = Math.round((Date.now() - inicioPeticionEscucha) / 1000);
    await reiniciarEscucha(`escucha colgada (${segundos} s sin terminar)`);
    return;
  }

  // Revisión liviana.
  const resultado = await getMeConTiempoMaximo();
  if (resultado.ok) {
    fallasSeguidasGetMe = 0;
    registrarRespuestaExitosa();
    return;
  }
  fallasSeguidasGetMe += 1;
  registrarErrorConexion(resultado.motivo);
  if (fallasSeguidasGetMe >= FALLAS_SEGUIDAS_PARA_REINICIAR) {
    fallasSeguidasGetMe = 0;
    await reiniciarEscucha(`getMe fallando ${FALLAS_SEGUIDAS_PARA_REINICIAR} veces seguidas`);
  }
}

// Una revisión se programa recién cuando termina la anterior: nunca corren dos a la vez.
function iniciarGuardian() {
  const programar = () => {
    const programadoEn = Date.now();
    setTimeout(async () => {
      try {
        await revisionGuardian(programadoEn);
      } catch (error) {
        log(`Guardián: error inesperado en la revisión: ${describirError(error)}`);
      }
      programar();
    }, PERIODO_GUARDIAN_MS);
  };
  programar();
}

bot.on("polling_error", (error) => {
  registrarErrorConexion(describirError(error));
});

log(
  valorEnvValido
    ? `Seguimiento: ${minutosSeguimiento} minuto(s) (desde SEGUIMIENTO_MINUTOS).`
    : `Seguimiento: ${minutosSeguimiento} minuto(s) (por defecto; SEGUIMIENTO_MINUTOS falta o no es válido).`
);
iniciarGuardian();
log(
  `Guardián de conexión activo: revisa cada ${PERIODO_GUARDIAN_MS / 1000} s; tiempo máximo por petición ${TIEMPO_MAXIMO_PETICION_MS / 1000} s.`
);
log("Bot iniciado. Esperando mensajes... (Ctrl+C para detenerlo)");
