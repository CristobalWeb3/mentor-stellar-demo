// ============================================================
// SOLO PARA PRUEBAS — no es parte del producto
// Crea una cuenta desechable en testnet y la fondea con Friendbot.
// Solo testnet. La clave secreta NO se imprime ni se guarda.
// ============================================================

import { Keypair } from "@stellar/stellar-sdk";

console.log("SOLO PARA PRUEBAS — no es parte del producto");

const par = Keypair.random(); // se genera al vuelo, vive solo en memoria
const llavePublica = par.publicKey();

try {
  const respuesta = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(llavePublica)}`);
  if (!respuesta.ok) {
    console.log(`❌ Friendbot respondió con error (código ${respuesta.status}). Intenta de nuevo.`);
    process.exit(1);
  }
  console.log("✅ Cuenta de prueba creada y fondeada en testnet.");
  console.log(`Llave pública: ${llavePublica}`);
  console.log("(La clave secreta se descartó a propósito: es una cuenta desechable.)");
} catch {
  console.log("❌ No pude conectarme a Friendbot. Revisa tu conexión a internet.");
  process.exit(1);
}
