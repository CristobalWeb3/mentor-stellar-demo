// Verificador de cuentas Stellar — solo lectura; en mainnet solo se consulta si la cuenta existe.
// Uso por línea de comandos: node verificar-cuenta.js G...
// Uso como módulo: import { verificarCuenta } from "./verificar-cuenta.js";
// No usa claves secretas, no firma, no mueve fondos.

import { Horizon, StrKey } from "@stellar/stellar-sdk";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// Direcciones fijas en el código. La testnet es la red de PRUEBAS. La red principal (mainnet)
// solo se usa para saber si una cuenta existe: su saldo y demás datos se descartan aquí mismo.
const HORIZON = {
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
};
// Tiempo máximo de espera SOLO para la consulta a mainnet (testnet no tiene límite propio).
const TIEMPO_MAXIMO_MAINNET_MS = 4 * 1000;

// Verifica una llave pública en la red indicada ("testnet" por defecto, o "mainnet").
// No imprime nada y no termina el proceso: solo DEVUELVE un objeto con el campo "estado":
//   { estado: "ACTIVA", llave, saldoXLM }   saldoXLM: texto tal como lo da la red, p. ej. "10000.0000000"
//   { estado: "EXISTE", llave }             solo en mainnet: la cuenta existe (sin saldo ni otros datos)
//   { estado: "NO_ENCONTRADA", llave }
//   { estado: "FALLA_RED", llave }
//   { estado: "ERROR_SERVIDOR", llave, codigo }
//   { estado: "INVALIDA", llave }
export async function verificarCuenta(llavePublica, red = "testnet") {
  const llave = String(llavePublica ?? "").trim();

  // Entrada inválida
  if (!llave || !llave.startsWith("G") || !StrKey.isValidEd25519PublicKey(llave)) {
    return { estado: "INVALIDA", llave };
  }

  const esMainnet = red === "mainnet";
  const servidor = new Horizon.Server(HORIZON[esMainnet ? "mainnet" : "testnet"]);

  let reloj;
  try {
    let consulta = servidor.loadAccount(llave);
    if (esMainnet) {
      // Reloj propio de 4 s (solo mainnet): si se acaba, se trata como falla y se abandona la consulta.
      const limite = new Promise((_, rechazar) => {
        reloj = setTimeout(() => rechazar(new Error("tiempo agotado")), TIEMPO_MAXIMO_MAINNET_MS);
      });
      consulta = Promise.race([consulta, limite]);
      consulta.catch(() => {}); // evita un aviso si la consulta perdedora falla más tarde
    }
    const cuenta = await consulta;
    // En mainnet solo importa que exista: no se lee el saldo ni nada más.
    if (esMainnet) return { estado: "EXISTE", llave };
    const nativo = cuenta.balances.find((b) => b.asset_type === "native");
    // Cuenta activa
    return { estado: "ACTIVA", llave, saldoXLM: nativo ? nativo.balance : "0" };
  } catch (error) {
    const estado = error?.response?.status ?? error?.status;
    if (error?.name === "NotFoundError" || estado === 404) {
      // Cuenta no encontrada (la red respondió y dijo que no existe)
      return { estado: "NO_ENCONTRADA", llave };
    } else if (estado) {
      // La red respondió, pero con otro error del servidor
      return { estado: "ERROR_SERVIDOR", llave, codigo: estado };
    } else {
      // Sin respuesta: problema de conexión, NO es "cuenta inexistente"
      return { estado: "FALLA_RED", llave };
    }
  } finally {
    clearTimeout(reloj);
  }
}

// Verificación completa para el bot: primero testnet. SOLO si testnet dice "no existe" se mira
// mainnet, y solo para saber si existe ahí. Devuelve lo mismo que verificarCuenta, más:
//   { estado: "SOLO_EN_MAINNET", llave }   no existe en testnet pero sí en la red principal
// Cualquier otro resultado de mainnet (no existe, error, falla, tiempo agotado) deja "NO_ENCONTRADA".
export async function verificarCuentaConMainnet(llavePublica) {
  const resultado = await verificarCuenta(llavePublica, "testnet");
  if (resultado.estado !== "NO_ENCONTRADA") return resultado;
  const enMainnet = await verificarCuenta(resultado.llave, "mainnet");
  return enMainnet.estado === "EXISTE" ? { estado: "SOLO_EN_MAINNET", llave: resultado.llave } : resultado;
}

// ------------------------------------------------------------
// Uso por línea de comandos. Este bloque SOLO corre cuando el archivo
// se ejecuta directamente (node verificar-cuenta.js ...), no cuando se importa.
// ------------------------------------------------------------

function mostrarAyuda() {
  console.log("Uso:  node verificar-cuenta.js <llave-publica>");
  console.log("Ejemplo:  node verificar-cuenta.js GABC...XYZ");
  console.log("La llave pública debe empezar con la letra G y tener 56 caracteres.");
}

const seEjecutaDirectamente =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (seEjecutaDirectamente) {
  const resultado = await verificarCuenta(process.argv[2]);

  switch (resultado.estado) {
    case "INVALIDA":
      console.log("Hola. No recibí una llave pública de Stellar válida.");
      mostrarAyuda();
      process.exit(1);
      break;
    case "ACTIVA":
      console.log(`✅ La cuenta existe y está activa en testnet: ${resultado.llave}`);
      console.log(`Saldo: ${Number(resultado.saldoXLM).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 7 })} XLM`);
      break;
    case "NO_ENCONTRADA":
      console.log("⚠️ Esa cuenta no existe o aún no está activa en testnet.");
      console.log("Una cuenta se activa cuando recibe fondos por primera vez.");
      process.exit(1);
      break;
    case "ERROR_SERVIDOR":
      console.log(`❌ La red de pruebas respondió con un error (código ${resultado.codigo}). Intenta de nuevo en un rato.`);
      process.exit(1);
      break;
    case "FALLA_RED":
      console.log("❌ No pude conectarme a la red de pruebas de Stellar.");
      console.log("Revisa tu conexión a internet e intenta otra vez. (Esto no significa que la cuenta no exista).");
      process.exit(1);
      break;
  }
}
