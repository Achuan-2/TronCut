import { runRust } from "./build-rust.mjs";
runRust(["test", "--locked", "--workspace"]);
