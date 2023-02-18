const util = require('util');
const {spawn} = require('child_process');
const net = require('net')
const LDClient = require('launchdarkly-node-server-sdk');
const winston = require('winston');
const winstonTransport = require('winston-transport');
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const {argv} = yargs(hideBin(process.argv))
const ghostArgsSpec = require('./ghost-args.json')
const os = require('os');
const hostname = os.hostname()
const SDK_KEY = process.env.LD_SDK_KEY
const FLAG_PREFIX = process.env.LD_GHOST_PREFIX || 'ghost';
const GHOST_CMD = process.env.GHOST_CMD = 'g-host'
const ld = LDClient.init(SDK_KEY)
const sleep = async (timeout) => new Promise((resolve) => setTimeout(timeout, resolve))
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
];


async function ghostSpawn(args) {
  const cmd = GHOST_CMD
  const opts = {
    stdio: ['pipe', 'pipe', 'pipe']
  }
  console.log(args)
  return spawn(cmd,args,opts)
}
function getGhostUser() {
  return {
    key: `ghost-migration-${argv._[0]}`,
    custom: {
      "Ghost: Source Table": argv.table,
      "Ghost: Database": argv.database,
      "Ghost: Host": argv.host,
      "Ghost: Alter": argv.alter,
      "Ghost: Local Hostname": hostname,
      "Ghost: Dry Run": !!argv.execute
    }
  }
}
async function getGhostArgumentsFromFlags() {
  const args = []
  for (const spec of ghostArgsSpec) {
    const {flagKind, key} = spec
    const value = await ghostArgFromFlag(spec)
    if (value === null) continue;
    if (value === "" && flagKind == "string") continue;
    if (flagKind === "boolean") {
      if(value === true) {
        args.push(`--${key}`)
      } else {
        args.push(`--${key}=false`)
      }
    } else {
      args.push(`--${key}=${value}`)
    } 
  }
  return args
}
async function ghostArgFromFlag({key, flagKind, defaultValue}) {
  const flagValue = await ld.variation(`${FLAG_PREFIX}-${key}`, getGhostUser(), defaultValue);
  if (flagKind == "string") {
    const trimmedValue = flagValue.trim()
    if(defaultValue === trimmedValue) {
      return null
    }
    return trimmedValue
  } else {
    if (defaultValue === flagValue) {
      return null
    }
  }
  return flagValue
}
async function waitForSocket(sock) {
  return new Promise(async (resolve, reject) => {
      for (let retries = 0; retries < 20; retries++) {
        try {
          return resolve(openSocket(sock))
        } catch (e) {
          console.warn(`Failed to open ghost admin socket. Attempt ${retries}, sleeping for 500ms`,e)
          await sleep(500)
        }
      
      }
      return reject(new Error('Too many failures while opening ghost admin sock, giving up'))
    })
}
async function main() {
  await ld.waitForInitialization()
  const [flagKey] = argv._
  const gargs = await getGhostArgumentsFromFlags()
  const wrapped = ['host', 'database', 'table', 'alter'].map(v => `--${v}=${argv[v]}`)
  const pid = process.pid
  const sock = `./ghost-${flagKey}.sock`
  const extra = [
      `--serve-socket-file=${sock}`,
      `--postpone-cut-over-flag-file=./ghost-${flagKey}.postpone.flag`,
      `--hooks-hint=${flagKey}`,
    ].concat(argv._.slice(1))
  
  
  const ghost = await ghostSpawn(gargs.concat(wrapped, extra))
  ghost.on('exit', shutdown)
  const afterSpawn = new Promise((resolve, reject) => ghost.on('spawn', resolve))
  ghost.on('error', handleError)
  ghost.stderr.pipe(process.stderr)
  ghost.stdout.pipe(process.stdout)
  process.stdin.pipe(ghost.stdin)
  ghostAdmin.pipe(process.stderr)
  await afterSpawn
  const ghostAdmin = await waitForSocket(sock)
  ghostAdmin.on('error', handleError)
  const startAllowcutover = await ld.variation(`${FLAG_PREFIX}-allow-cutover`, false)
  const startThrottled = await ld.variation(`${FLAG_PREFIX}-throttle`, false)
  if (startAllowcutover) {
    ghostAdmin.write(`unpostpone\n`)
  }
  if (startThrottled) {
    ghostAdmin.write('throttle\n')
  }
  ghostAdmin.flush()
  interactiveCommands.forEach(cmd => {
    ld.on(`update:${FLAG_PREFIX}-${cmd}`, () => {
      const value = ld.variation(`${FLAG_PREFIX}-${cmd}`, getGhostUser())
        if (cmd == "throttle") {
          ghostAdmin.write(`${value ? "throttle" : "no-throttle"}\n`) 
        } else if (cmd == "allow-cutover") {
          ghostAdmin.write(`unpostpone\n`)
        } else if (cmd == "panic") {
          ghostAdmin.write(`panic\n`)
        } else { 
          ghostAdmin.write(`${cmd}=${value}\n`)
        }
        ghostAdmin.flush()
      
    })
  })
  
}

function openSocket(path) {
  return new Promise((resolve, reject) => {
    const con = net.createConnection(path)
    con.on('connect', () => resolve(con))
    con.on('error', reject)
  })
}

async function shutdown() {
  await ld.flush()
  ld.close()
}

async function handleError(e) {
  console.error(e)
  return shutdown()
}

main().catch(handleError)