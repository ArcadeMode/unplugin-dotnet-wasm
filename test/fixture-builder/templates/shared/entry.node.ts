import { dotnet } from '_framework/dotnet';
import { Echo } from 'typeshim';

async function main(): Promise<void> {
  const runtimeInfo = await dotnet.create();
  runtimeInfo.runMain();

  const echo = new Echo();
  // Emitted on stdout so the node runner can assert the current greeting.
  console.log(`GREETING:${echo.Greet('world')}`);
}

main();
