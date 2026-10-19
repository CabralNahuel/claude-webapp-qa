// Tiny static server for the fixtures: node serve.mjs [port]
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.argv[2] || 4710)
http
  .createServer((req, res) => {
    const name = path.basename(new URL(req.url, 'http://x').pathname) || 'ok.html'
    const file = path.join(dir, name.endsWith('.html') ? name : `${name}.html`)
    if (!fs.existsSync(file)) {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(fs.readFileSync(file))
  })
  .listen(port, () => console.log(`fixtures on http://localhost:${port}`))
