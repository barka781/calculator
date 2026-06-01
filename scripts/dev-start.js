#!/usr/bin/env node

const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const backendDir = path.join(rootDir, "backend");
const frontendDir = path.join(rootDir, "frontend");

const backendPort = Number(process.env.BACKEND_PORT || 8001);
const frontendPort = Number(process.env.FRONTEND_PORT || 4173);
const host = process.env.DEV_HOST || "127.0.0.1";
const pythonBin = process.env.PYTHON || "python3";
const uvicornBin =
  process.env.UVICORN ||
  path.join(
    backendDir,
    ".venv",
    process.platform === "win32" ? "Scripts/uvicorn.exe" : "bin/uvicorn",
  );

const children = new Set();
let stopping = false;

const execFileAsync = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const log = (scope, message) => {
  process.stdout.write(`[${scope}] ${message}\n`);
};

const getListeningPids = async (port) => {
  try {
    const { stdout } = await execFileAsync("lsof", [
      `-tiTCP:${port}`,
      "-sTCP:LISTEN",
    ]);
    return stdout
      .split(/\s+/)
      .map((pid) => Number(pid))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  } catch (error) {
    if (error.code === 1) return [];
    throw error;
  }
};

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const killPort = async (port) => {
  const pids = await getListeningPids(port);
  if (!pids.length) {
    log("dev", `port ${port} is free`);
    return;
  }

  log("dev", `stopping ${pids.join(", ")} on port ${port}`);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may have exited between lsof and kill.
    }
  }

  await sleep(700);

  for (const pid of pids) {
    if (!isAlive(pid)) continue;
    log("dev", `forcing ${pid} on port ${port}`);
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
};

const prefixOutput = (child, scope) => {
  child.stdout.on("data", (chunk) => {
    String(chunk)
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => log(scope, line));
  });
  child.stderr.on("data", (chunk) => {
    String(chunk)
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => log(scope, line));
  });
};

const spawnService = (scope, command, args, cwd) => {
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  children.add(child);
  prefixOutput(child, scope);

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!stopping && code !== 0) {
      log(scope, `exited with code ${code ?? "null"} signal ${signal ?? "null"}`);
      stopAll(1);
    }
  });

  return child;
};

const stopAll = async (exitCode = 0) => {
  if (stopping) return;
  stopping = true;
  log("dev", "stopping services");

  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // Already stopped.
    }
  }

  await sleep(500);

  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    try {
      child.kill("SIGKILL");
    } catch {
      // Already stopped.
    }
  }

  process.exit(exitCode);
};

const assertReady = () => {
  if (!fs.existsSync(uvicornBin)) {
    throw new Error(
      `Missing backend runner: ${uvicornBin}\nRun: cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements-dev.txt`,
    );
  }
  if (!fs.existsSync(path.join(frontendDir, "index.html"))) {
    throw new Error(`Missing frontend index.html in ${frontendDir}`);
  }
};

const main = async () => {
  assertReady();

  process.on("SIGINT", () => stopAll(0));
  process.on("SIGTERM", () => stopAll(0));

  await killPort(backendPort);
  await killPort(frontendPort);

  spawnService(
    "backend",
    uvicornBin,
    ["app.main:app", "--reload", "--host", host, "--port", String(backendPort)],
    backendDir,
  );

  spawnService(
    "frontend",
    pythonBin,
    ["-m", "http.server", String(frontendPort), "--bind", host, "-d", frontendDir],
    rootDir,
  );

  log("dev", `frontend: http://${host}:${frontendPort}`);
  log("dev", `backend:  http://${host}:${backendPort}`);
  log("dev", "press Ctrl+C to stop both");
};

main().catch((error) => {
  process.stderr.write(`[dev] ${error.message}\n`);
  process.exit(1);
});
