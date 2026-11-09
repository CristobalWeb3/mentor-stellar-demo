// Conversación con la IA (Claude Haiku) para el bot mentor.
// Llama a la API de Anthropic con fetch (sin librerías). Guarda una memoria corta por chat
// y lleva topes diarios de gasto, todo en memoria (se pierde al reiniciar).
// PRIVACIDAD: a la API solo viaja el texto de los mensajes y el estado del hito.
// Nunca nombre, usuario ni ID de Telegram. El ID del chat solo se usa aquí como llave interna.
// REGISTROS: nunca se imprime el contenido de mensajes ni respuestas; solo contadores.

import { mensajes } from "./mensajes.js";
import { instruccionesMentor } from "./instrucciones-mentor.js";

// ------------------------------------------------------------
// Constantes
// ------------------------------------------------------------

// Modelo de IA. Verificado en la documentación oficial de Anthropic (página de modelos).
const MODELO_IA = "claude-haiku-5-5";
const URL_API = "https://api.anthropic.com/v1/messages";
// Versión de la API (encabezado obligatorio anthropic-version), según la página de versiones.
const VERSION_API = "2026-10-21";
// Largo máximo de cada respuesta de la IA, en tokens (con el razonamiento apagado, todo es texto).
const MAX_TOKENS_RESPUESTA = 300;
// Tiempo máximo de espera por la IA en CADA intento. Si se pasa, se corta ese intento.
const TIEMPO_MAXIMO_INTENTO_MS = 8 * 1000;
// Cuántos intentos como máximo por mensaje del alumno. Solo se reintenta si no hubo respuesta
// (tiempo agotado o error de conexión); si la API respondió con error, no se reintenta.
// Con 2 intentos de 8 s, el alumno nunca espera más de ~17 s en total.
const INTENTOS_MAXIMOS = 2;
// Cada mensaje del alumno se recorta a este largo antes de enviarlo (para que nadie gaste de más).
const MAX_CARACTERES_MENSAJE_ALUMNO = 1000;
// Memoria corta por chat: cuántos mensajes se recuerdan (alumno y mentor alternados).
const MENSAJES_EN_MEMORIA = 6;
// Topes de gasto por día (hora del servidor). Cada llamada cuenta, salga bien o mal.
const MAX_MENSAJES_IA_POR_PERSONA_DIA = 20;
const MAX_MENSAJES_IA_TOTAL_DIA = 300;

// La clave se lee SOLO desde la variable de entorno. Nunca va en el código ni en los registros.
const claveApi = (process.env.ANTHROPIC_API_KEY ?? "").trim();
export const iaDisponible = claveApi !== "" && claveApi !== "pega_tu_clave_aqui";

// ------------------------------------------------------------
// Memoria corta por chat
// ------------------------------------------------------------

// chatId -> lista de { role: "user" | "assistant", content: texto }, siempre empezando por "user".
const historiales = new Map();

// Agrega el par alumno/mentor y recorta. Como siempre se agregan de a pares y el límite es par,
// el primer mensaje que queda es siempre del alumno. El guardián final lo asegura igual.
function recordar(chatId, textoAlumno, textoMentor) {
  const historial = historiales.get(chatId) ?? [];
  historial.push({ role: "user", content: textoAlumno }, { role: "assistant", content: textoMentor });
  while (historial.length > MENSAJES_EN_MEMORIA) historial.shift();
  while (historial.length > 0 && historial[0].role !== "user") historial.shift();
  historiales.set(chatId, historial);
}

// ------------------------------------------------------------
// Topes diarios (en memoria, se reinician al cambiar de día)
// ------------------------------------------------------------

const contadores = { dia: null, llamadas: 0, porChat: new Map(), tokensEntrada: 0, tokensSalida: 0 };

function reiniciarSiCambioElDia() {
  const hoy = new Date().toDateString();
  if (contadores.dia === hoy) return;
  contadores.dia = hoy;
  contadores.llamadas = 0;
  contadores.porChat = new Map();
  contadores.tokensEntrada = 0;
  contadores.tokensSalida = 0;
}

function resumenDelDia() {
  return `Hoy: ${contadores.llamadas} llamadas, ${contadores.tokensEntrada} tokens de entrada, ${contadores.tokensSalida} de salida.`;
}

// ------------------------------------------------------------
// Ayudas
// ------------------------------------------------------------

// Si la respuesta quedó cortada por largo, la deja en la última frase completa.
// Si no hay ninguna frase completa, devuelve "" (y se usará el mensaje fijo de falla).
function recortarEnUltimaFrase(texto) {
  const ultimoCierre = Math.max(...[".", "!", "?", "…"].map((signo) => texto.lastIndexOf(signo)));
  return ultimoCierre === -1 ? "" : texto.slice(0, ultimoCierre + 1).trim();
}

// ------------------------------------------------------------
// Respuesta de la IA
// ------------------------------------------------------------

// Devuelve SIEMPRE un texto para el alumno: la respuesta de la IA o un mensaje fijo
// (tope alcanzado o falla). Nunca lanza error ni devuelve vacío.
// `log` es la función de registro del bot (fecha y hora; oculta secretos).
export async function responderConIA(chatId, textoAlumno, hitoCumplido, log) {
  if (!iaDisponible) {
    log("IA: no hay ANTHROPIC_API_KEY, se responde el mensaje fijo de falla.");
    return mensajes.fallaIA;
  }

  reiniciarSiCambioElDia();
  const llamadasDeEsteChat = contadores.porChat.get(chatId) ?? 0;
  if (llamadasDeEsteChat >= MAX_MENSAJES_IA_POR_PERSONA_DIA || contadores.llamadas >= MAX_MENSAJES_IA_TOTAL_DIA) {
    log(
      `IA: tope alcanzado (${llamadasDeEsteChat}/${MAX_MENSAJES_IA_POR_PERSONA_DIA} de esta persona, ${contadores.llamadas}/${MAX_MENSAJES_IA_TOTAL_DIA} total hoy).`
    );
    return mensajes.topeAlcanzado;
  }
  // El mensaje cuenta desde ya, salga bien o mal, y UNA sola vez aunque haya reintento.
  contadores.porChat.set(chatId, llamadasDeEsteChat + 1);
  contadores.llamadas += 1;

  const textoRecortado = textoAlumno.slice(0, MAX_CARACTERES_MENSAJE_ALUMNO);
  const historial = historiales.get(chatId) ?? [];
  const hito1 = hitoCumplido ? "sí" : "no";

  const cuerpo = {
    model: MODELO_IA,
    max_tokens: MAX_TOKENS_RESPUESTA,
    // Conversación corta: razonamiento apagado y esfuerzo bajo (permitido en Haiku 5.5 según la
    // documentación oficial). Así los tokens de respuesta son todos para el texto.
    // No se envían temperature, top_p ni top_k: en este modelo dan error 400.
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
    system: instruccionesMentor(hitoCumplido),
    // Empieza siempre con un mensaje del alumno y alterna: historial (en pares) + mensaje nuevo.
    messages: [...historial, { role: "user", content: textoRecortado }],
  };

  const cuerpoJson = JSON.stringify(cuerpo);

  for (let intento = 1; intento <= INTENTOS_MAXIMOS; intento++) {
    const etiqueta = intento === 1 ? "intento 1" : `reintento ${intento}`;
    const inicio = Date.now();
    const controlador = new AbortController();
    const reloj = setTimeout(() => controlador.abort(), TIEMPO_MAXIMO_INTENTO_MS);
    try {
      const respuesta = await fetch(URL_API, {
        method: "POST",
        headers: {
          "x-api-key": claveApi,
          "anthropic-version": VERSION_API,
          "content-type": "application/json",
          // Cierra la conexión al terminar: así nunca se reutiliza una conexión "muerta"
          // (la causa de las esperas de 15 s sin respuesta). Cuesta ~0,2 s por llamada.
          connection: "close",
        },
        body: cuerpoJson,
        signal: controlador.signal,
      });
      const duracion = Date.now() - inicio;

      if (!respuesta.ok) {
        // La API respondió con error (clave inválida, sin saldo, saturada...): no se reintenta.
        // Solo el código HTTP, nunca el cuerpo de la respuesta.
        log(`IA falló (${etiqueta}, ${duracion} ms, hito1: ${hito1}): HTTP ${respuesta.status}. ${resumenDelDia()}`);
        return mensajes.fallaIA;
      }

      const datos = await respuesta.json();
      const entrada = datos?.usage?.input_tokens ?? 0;
      const salida = datos?.usage?.output_tokens ?? 0;
      contadores.tokensEntrada += entrada;
      contadores.tokensSalida += salida;
      const stopReason = datos?.stop_reason ?? "desconocido";
      log(
        `IA ok (${etiqueta}, ${duracion} ms, hito1: ${hito1}, stop: ${stopReason}): ${entrada} tokens de entrada, ${salida} de salida. ${resumenDelDia()}`
      );

      if (stopReason === "refusal") return mensajes.fallaIA;

      let texto = (Array.isArray(datos?.content) ? datos.content : [])
        .filter((bloque) => bloque?.type === "text" && typeof bloque.text === "string")
        .map((bloque) => bloque.text)
        .join("")
        .trim();
      if (!texto) return mensajes.fallaIA;
      if (stopReason === "max_tokens") {
        texto = recortarEnUltimaFrase(texto);
        if (!texto) return mensajes.fallaIA;
      }

      // Solo si la IA respondió bien se guarda el par en la memoria.
      recordar(chatId, textoRecortado, texto);
      return texto;
    } catch (error) {
      // No hubo respuesta: tiempo agotado o error de conexión. Si quedan intentos, se reintenta.
      const duracion = Date.now() - inicio;
      const motivo =
        error?.name === "AbortError"
          ? `sin respuesta en ${TIEMPO_MAXIMO_INTENTO_MS / 1000} s`
          : `error de conexión (${error?.cause?.code ?? error?.code ?? error?.name ?? "desconocido"})`;
      const quedanIntentos = intento < INTENTOS_MAXIMOS;
      log(
        `IA falló (${etiqueta}, ${duracion} ms, hito1: ${hito1}): ${motivo}.${quedanIntentos ? " Se reintenta." : ""} ${resumenDelDia()}`
      );
      if (!quedanIntentos) return mensajes.fallaIA;
    } finally {
      clearTimeout(reloj);
    }
  }
  return mensajes.fallaIA; // no debería llegarse aquí; seguro extra
}
