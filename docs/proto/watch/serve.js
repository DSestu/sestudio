// Serves the below-player prototype and saves its feedback, so Claude can read it.
// node serve.js [port]  ->  http://localhost:<port>/  (also on the LAN for a phone)
const http = require('http'), fs = require('fs'), path = require('path')
const PORT = +process.argv[2] || 5390
const DIR = __dirname
const OUT = '/tmp/watch-proto-feedback.json'
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/feedback') {
    let body = ''
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy() })
    req.on('end', () => {
      try {
        const entry = { at: new Date().toISOString(), ...JSON.parse(body) }
        const all = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : []
        all.push(entry)
        fs.writeFileSync(OUT, JSON.stringify(all, null, 2))
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
      } catch (e) { res.writeHead(400).end(String(e)) }
    })
    return
  }
  const file = path.join(DIR, req.url === '/' ? 'below-player.html' : path.normalize(req.url.split('?')[0]))
  if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain', 'cache-control': 'no-store' })
  fs.createReadStream(file).pipe(res)
}).listen(PORT, '0.0.0.0', () => console.log(`http://localhost:${PORT}/`))
