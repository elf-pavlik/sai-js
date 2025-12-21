import net from 'node:net'

function proxy(listenPort, targetHost, targetPort) {
  net
    .createServer((client) => {
      const upstream = net.connect(targetPort, targetHost)

      client.pipe(upstream)
      upstream.pipe(client)

      client.on('error', () => upstream.destroy())
      upstream.on('error', () => client.destroy())
    })
    .listen(listenPort, '0.0.0.0', () => {
      console.log(`Inspector proxy ${listenPort} → ${targetHost}:${targetPort}`)
    })
}

// Debug service inspector
proxy(9240, 'debug', 9240)

// Auth (or other) service inspector
proxy(9229, 'auth', 9229)
