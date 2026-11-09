// Verificador de cuentas Stellar — SOLO LECTURA, SOLO TESTNET.
// Uso por línea de comandos: node verificar-cuenta.js G...
// Uso como módulo: import { verificarCuenta } from "./verificar-cuenta.js";
// No usa claves secretas, no firma, no mueve fondos.

import { Horizon, StrKey } from "@stellar/stellar-sdk";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// Red de PRUEBAS (testnet). Fija en el código: nunca apunta a mainnet.
const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";

// Verifica una llave pública en testnet. No imprime nada y no termina el proceso:
// solo DEVUELVE un objeto con el campo "estado":
//   { estado: "ACTIVA", llave, saldoXLM }   saldoXLM: texto tal como lo da la red, p. ej. "10000.0000000"
//   { estado: "NO_ENCONTRADA", llave }
//   { estado: "FALLA_RED", llave }
//   { estado: "ERROR_SERVIDOR", llave, codigo }
//   { estado: "INVALIDA", llave }
export async function verificarCuenta(llavePublica) {
  const llave = String(llavePublica ?? "").trim();

  // Entrada inválida
  if (!llave || !llave.startsWith("G") || !StrKey.isValidEd25519PublicKey(llave)) {
    return { estado: "INVALIDA", llave };
  }

  const servidor = new Horizon.Server(HORIZON_TESTNET);

  try {
    const cuenta = await servidor.loadAccount(llave);
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
  }
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
