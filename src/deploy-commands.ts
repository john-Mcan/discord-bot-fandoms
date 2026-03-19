import { REST, Routes } from "discord.js";
import { env } from "./env";
import { commandsJson } from "./commands";

async function main() {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

  console.log("[deploy:commands] Registrando comandos globalmente...");

  await rest.put(
    Routes.applicationCommands(env.DISCORD_CLIENT_ID),
    { body: commandsJson },
  );

  console.log("[deploy:commands] OK — puede tardar hasta 1 hora en aparecer en todos los servidores.");
}

main().catch((err) => {
  console.error("[deploy:commands] Error:", err);
  process.exitCode = 1;
});


