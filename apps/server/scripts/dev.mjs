import { spawn } from "node:child_process";

const port = process.env.PERCH_DEV_PORT || "4600";
const args = [
  "run",
  ".",
  "serve",
  "--no-open",
  "--port",
  port,
  "--allow-origin",
  "http://localhost:5173",
  "--allow-origin",
  "http://127.0.0.1:5173",
  ...process.argv.slice(2),
];

const child = spawn("go", args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

child.on("error", (error) => {
  console.error(`Failed to start the Go server: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : code ?? 0);
});
