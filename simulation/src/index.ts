import { createContext } from "./context.js";
import { runAlphaLoop } from "./agents/alpha.js";
import { runBetaLoop } from "./agents/beta.js";
import { runGammaLoop } from "./agents/gamma.js";
import { TaskState } from "./state.js";
import { runValidatorLoop } from "./validator.js";

async function main(): Promise<void> {
  const ctx = createContext();
  const state = new TaskState();

  console.log("Starting S3 simulation loops on Arc testnet...");
  console.log(
    `alpha=${ctx.alpha.address} beta=${ctx.beta.address} gamma=${ctx.gamma.address} validator=${ctx.validator.address}`,
  );

  await Promise.all([
    runAlphaLoop(ctx, state),
    runBetaLoop(ctx, state),
    runGammaLoop(ctx, state),
    runValidatorLoop(ctx, state),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
