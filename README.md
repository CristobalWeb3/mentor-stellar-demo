# Estela · La mentora que no te cree de palabra

**Estela** es una mentora de IA en Telegram que acompaña a los alumnos de los talleres de Stellar durante 30 días y **verifica cada avance directamente en la red de Stellar**. No le cree al alumno: lo comprueba on-chain.

Proyecto de **Stellar Chile** para **Instawards 2026**.

- **Pruébala:** [t.me/mentor_stellar_cl_bot](https://t.me/mentor_stellar_cl_bot)
- **Video demo:** [Ver en Loom](https://www.loom.com/share/db0786c56e2447e584328ea99f00082b)

---

## El desafío

Stellar ya es el segundo ecosistema del mundo en developers activos. El siguiente desafío es que se queden: que quienes salen entusiasmados de un taller sigan construyendo semanas después. Estela acompaña a cada alumno en ese tramo, orientándolo en desarrollo y en product-market fit, porque un builder que encuentra su PMF es un builder que se queda.

## Qué hace hoy (demo funcional)

- **Escribe primero** y pregunta por la idea del alumno antes que por su código.
- **Da feedback de producto** con un modelo de IA de bajo costo (Claude Haiku), con topes de gasto por alumno.
- **Verifica la cuenta de testnet** del alumno leyendo la red en vivo y entrega el link al explorador público como prueba.
- **Distingue** entre "la cuenta no existe" y "no pude leer la red", y orienta si la cuenta solo existe en mainnet.
- **Vuelve sola**: después de cumplir un hito, envía el seguimiento sin que el alumno escriba.
- **Bloquea llaves secretas**: si alguien pega una, la advierte y nunca la envía a la IA ni la guarda.

## Seguridad

- Estela **solo lee** la red. Nunca crea cuentas, firma transacciones, mueve fondos ni toca llaves de los alumnos.
- Todo ocurre en la **red de pruebas** (testnet). En mainnet solo consulta si una cuenta existe, sin leer saldos.
- Los secretos viven en variables de entorno (`.env`), nunca en el código.
- A la IA solo llega el texto del mensaje: nunca el nombre ni el usuario de Telegram.

## Cómo está hecho

| Archivo | Qué hace |
| --- | --- |
| `bot.js` | El bot de Telegram: recibe mensajes, decide qué responder y programa el seguimiento. |
| `verificar-cuenta.js` | Lee la red de Stellar para comprobar si una cuenta existe y está activa. |
| `mentor-ia.js` | La conversación con Claude Haiku, con topes de uso y manejo de fallas. |
| `instrucciones-mentor.js` | La voz y las reglas de Estela para la IA. |
| `mensajes.js` | Todos los textos fijos que ve el alumno. |
| `crear-cuenta-prueba.js` | Herramienta de prueba: crea y fondea una cuenta desechable en testnet. |

## Correrlo localmente

Requisitos: **Node.js 22.12 o superior**, un bot de Telegram (creado con BotFather) y una clave de la API de Anthropic.

```bash
npm ci
cp .env.example .env   # completa los valores en .env
node bot.js
```

Para probar la verificación sin Telegram:

```bash
node crear-cuenta-prueba.js          # crea una cuenta de prueba en testnet
node verificar-cuenta.js <LLAVE_G>   # verifica esa cuenta leyendo la red
```

## Próximos pasos (sprint de 30 días)

- Piloto con alumnos reales del capítulo, medido contra una línea base.
- Integración con **Stellar Raven** para responder dudas del ecosistema en español.
- Verificación del segundo hito: el primer contrato desplegado en testnet.
- Cada hito como credencial portátil y verificable, compatible con Stellar Passport si acepta emisores externos.
- Guía para que cualquier chapter de Stellar despliegue su propia Estela.

---

Construido por un embajador de Stellar Chile **no desarrollador**, con [Claude Code](https://www.anthropic.com/claude-code): la misma palanca que Estela quiere darle a cada alumno.
