const util = require("util");
const net = require("net");
const fs = require("fs/promises");
const LDClient = require("launchdarkly-node-server-sdk");
const winston = require("winston");
const winstonTransport = require("winston-transport");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const { argv } = yargs(hideBin(process.argv));
// TODO: use command line arguments and implement some validation/help messages
const SDK_KEY = argv["sdk-key"] || process.env.LD_SDK_KEY;
const FLAG_PREFIX = argv["flag-prefix"] ? `${argv["flag-prefix"]}-` : "";
const postponeFlag = argv["postpone-flag-file"];
const ld = LDClient.init(SDK_KEY);

const interactiveCommands = [
  "chunk-size",
  "dml-batch-size",
  "max-lag-millis",
  "max-load",
  "critical-load",
  "nice-ratio",
  "throttle-control-replicas",
  "throttle-http",
  "throttle-query",
  "throttle",
  "allow-cutover",
  "panic"
];

const toCamelCase = (v) =>
  v
    .split("_")
    .filter(Boolean)
    .map((v, i) =>
      i == 0
        ? v.toLowerCase()
        : `${v[0].toUpperCase()}${v.substr(1).toLowerCase()}`
    )
    .join("");

const toTitleCase = (v) =>
  v
    .split("_")
    .filter(Boolean)
    .map((v, i) => `${v[0].toUpperCase()}${v.substr(1).toLowerCase()}`)
    .join(" ");



const toSlug = (v) =>
  v
    .replace(/([^\w]+)/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/, "")
    .toLowerCase();
const toLabel = (prefix) => (k) => `${prefix}${toTitleCase(k)}`;
const toCustomAttributeLabel = toLabel("Ghost: ");
const flagKeyFor = (cmd) => `${FLAG_PREFIX}${cmd}`;
const cmdForFlag = (cmd) =>
  cmd.startsWith(FLAG_PREFIX) ? cmd.substring(FLAG_PREFIX.length) : cmd;
const sleep = async (timeout) =>
  new Promise((resolve) => setTimeout(resolve, timeout));


const hasOwnProperty = (obj, ...rest) =>
  Reflect.apply(Object.prototype.hasOwnProperty, obj, rest);


const isNumericAttribute = (k) => 
  k.endsWith("_SECONDS") || 
  ["PROGRESS", "INSPECTED_LAG", "ESTIMATED_ROWS"].includes(k)

const ghostMetadata = Object.fromEntries(Object.entries(process.env)
  .filter(([k]) => k.startsWith("GH_OST_"))
  .map(([k, v]) => [k.replace(/^GH_OST_/, ""), v])
  .map(([k, v]) => [k, k == "DRY_RUN" ? v === "true" : v])
  .map(([k, v]) => [k, isNumericAttribute(k) ? +v : v]))


const { HOOKS_HINT } = ghostMetadata;

const ghostAttributeKeys = [
  "DATABASE_NAME",
  "TABLE_NAME",
  "GHOST_TABLE_NAME",
  "OLD_TABLE_NAME",
  "MIGRATED_HOST",
  "INSPECTED_HOST",
  "EXECUTING_HOST",
  "DDL",
  "HOOKS_HINT",
  "HOOKS_HINT_OWNER",
  "HOOKS_HINT_TOKEN",
  "DRY_RUN",
];

function getGhostUser() {
  const MIGRATION_ID = toSlug(HOOKS_HINT || process.pid.toString());
  const USER_KEY = `ghost-migration-${MIGRATION_ID}`;
  const ghostAttributes = Object.fromEntries(
    Object.entries(ghostMetadata)
      .filter(([k]) => ghostAttributeKeys.includes(k))
      .map(([k, v]) => [toCustomAttributeLabel(k), v])
  );

  return {
    key: USER_KEY,
    name: `Migration: ${HOOKS_HINT || process.pid}`,
    anonymous: !!HOOKS_HINT,
    custom: ghostAttributes,
  };
}

console.log(getGhostUser());

function openSocket(path) {
  return new Promise((resolve, reject) => {
    const con = net.createConnection(path);
    con.on("connect", () => {
      con.off("error", reject);
      resolve(con);
    });
    con.once("error", reject);
  });
}

async function waitForSocket(sock) {
  const retries = 20;
  const delay = 500;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await openSocket(sock);
    } catch (e) {
      console.warn(
        `Failed to open ghost admin socket. Attempt ${attempt}/${retries}, sleeping for ${delay}ms`,
        e
      );
      await sleep(delay);
    }
  }
  throw new Error(
    "Too many failures while opening ghost admin sock, giving up"
  );
}

const withFlag = (flag, defaultValue, fn) => async () => {
    const value = await ld.variation(flag, getGhostUser(), defaultValue)
    if (value !== null) return fn(value)
}

const withSocket =
  (fn) =>
  (...args) => {
    return waitForSocket(argv.socket)
      .then((socket) => {
        socket.pipe(process.stderr);
        return socket;
      })
      .then((socket) => fn(socket, ...args));
  };


const sendCommand = (cmd) =>
  withSocket((socket, v) =>
    socket.end(v !== undefined ? `${cmd}=${v}\r\n` : `${cmd}\r\n`)
  );

const toggleCommand = (onCmd, offCmd) => (v) =>
  v ? sendCommand(onCmd) : sendCommand(offCmd);



const handlerForCommand = (cmd) => {
  if (cmd == "throttle") {
    return toggleCommand("throttle", "no-throttle");
  } else if (cmd == "allow-cutover") {
    // we need to remove the cutover flag
    // we use this instead of `unpostpone` because
    // there doesn't seem to be a way to re-postpone
    return (v) =>
      v
        ? fs.unlink(postponeFlag).catch((e) => {
          console.error("failed to remove postpone flag", e)
        })
        : fs.open(postponeFlag, "w").then((f) => f.close());
  } else if (cmd == "panic") {
    const sendPanic = sendCommand("panic");
    return v => v && sendPanic();
  } else {
    return sendCommand(cmd);
  }
};

async function main() {
  if (argv["pid-file"]) {
    try {
      await fs.writeFile(argv["pid-file"], process.pid.toString());
    } catch (e) {
      console.log("failed to write pid file");
    }
  }

  await ld.waitForInitialization();
  const user = getGhostUser();
  // make show in dashboard more fast
  ld.identify(user);
  await ld.flush();
  await sendCommand("sup")();

  
  const runHandler = (cmd) =>
    withFlag(flagKeyFor(cmd), null, handlerForCommand(cmd))

  const handlers = Object.fromEntries(
    interactiveCommands.map(cmd => [cmd, runHandler(cmd)])
  );
  console.log(interactiveCommands)

  // run once at start
  await Promise.all(Object.values(handlers).map((fn) => fn()));

  // listen for updates
  ld.on("update", ({ key }) => {
    const cmd = cmdForFlag(key);
    if (hasOwnProperty(handlers, cmd)) {
      handlers[cmd]();
    } else {
      console.log(`No handler registered for flag '${key}'`);
    }
  });
}

async function shutdown() {
  await ld.flush();
  ld.close();
}

async function handleError(e) {
  console.error(e);
  return shutdown();
}

main().catch(handleError);
