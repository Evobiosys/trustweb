// Local relay for the dev preview (scripts/tw_dev.sh): a RelayServer on loopback, in memory, so two local browsers can sync
// (apps/trustweb sync_link.ts) without touching a production relay. Usage: tsx scripts/tw_dev_relay.mts <port>
import { RelayServer } from '../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../packages/transport/src/relay_queue_store.ts'

const relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
const { port } = await relay.listen(Number(process.argv[2]), '127.0.0.1')
console.log(`dev relay on 127.0.0.1:${port}`)
