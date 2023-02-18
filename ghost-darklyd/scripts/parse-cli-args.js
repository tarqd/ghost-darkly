const fs = require('fs/promises')
async function read(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk); 
  return Buffer.concat(chunks).toString('utf8');
}
async function main() {
  const source = await read(process.stdin)
  const regex = /flag\.(?:(String|Bool|Int|Float64|Int64|Uint)(?:Var)?)\(:?(?:&.*?)?\s*"([\w-]+)"\s*,\s*(?:(?:"(.*?)")|([\d.]+)|(true|false))\s*,\s*"(.*?)"\s*\)/g
  const parsed = Array.from(source.matchAll(regex))
    .map((m) => 
    {
      const [full, kind, key, df, description] = m.filter(x => x !== undefined)
      let defaultValue = df
      let flagKind = kind.toLowerCase();
      if (kind.match(/int|float/i) !== null) {
        defaultValue = parseFloat(defaultValue)
        flagKind = "number"
      } else if (kind.match(/bool/i) !== null) {
        defaultValue = df.match(/true/i) !== null
        flagKind = "boolean"
      }
      const required = description.includes("(mandatory)")

      return {kind,flagKind, key, defaultValue, description, required}
    })
    .filter(({key}) => !["help", "version"].includes(key))
    //.filter(({description}) => !description.includes("(mandatory)"))

   process.stdout.write(JSON.stringify(parsed, null, 2))
   process.stdout.write('\n')
   

}
main().catch(e => {console.error(e); process.exit(1)})