import type { H3Error } from 'h3'
import type { Peer } from 'crossws'

declare module 'crossws' {
  interface PeerContext {
    playerId: string
  }
}

export interface ChatMessage {
  type: 'chat'
  gameId: string
  civName: string
  message: string
}

export interface JoinMessage {
  type: 'join'
  gameIds: string[]
}

export interface LeaveMessage {
  type: 'leave'
  gameIds: string[]
}

export type Message = ChatMessage | JoinMessage | LeaveMessage

export interface ChatResponse {
  type: 'chat'
  gameId: string
  civName: string
  message: string
}

export interface JoinSuccessResponse {
  type: 'joinSuccess'
  gameIds: string[]
}

export interface ErrorResponse {
  type: 'error'
  message: string
}

const log = logger.withTag('ws')

const playerPeersMap = new Map<string, Set<Peer>>()

export default defineWebSocketHandler({
  async open(peer) {
    try {
      const authHeader = peer.request.headers.get('authorization')
      const playerId = await loadPlayerId(authHeader)
      peer.context.playerId = playerId
      log.withTag('open').info(playerId)
    } catch (e) {
      const error = e as H3Error
      log.withTag('open').error('authentication error:', error)
      peer.send({ type: 'error', message: error.message } satisfies ErrorResponse)
      peer.close()
    }
  },
  async message(peer, message) {
    if (message.text() === 'ping') {
      peer.send('pong')
      return
    }
    const playerId = peer.context.playerId as string
    if (!playerId) {
      log.withTag('msg').error('authentication error')
      peer.send({ type: 'error', message: 'authentication error' } satisfies ErrorResponse)
      return
    }
    try {
      const msg: Message = message.json()
      if (msg.type === 'join') {
        log.withTag(msg.type).info(playerId, msg.gameIds)
        if (playerPeersMap.has(playerId)) {
          playerPeersMap.get(playerId).add(peer)
        } else {
          playerPeersMap.set(playerId, new Set([peer]))
        }
        peer.send({ type: 'joinSuccess', gameIds: msg.gameIds } satisfies JoinSuccessResponse)
      } else if (msg.type === 'chat') {
        log.withTag(msg.type).info(playerId, msg.gameId, msg.civName, msg.message)
        const data: ChatResponse = msg
        const playerIds = await getPlayerIdsFromGameId(msg.gameId)
        playerIds?.forEach((playerId) => {
          playerPeersMap.get(playerId)?.forEach((peer) => {
            peer.send(data)
          })
        })
      } else if (msg.type === 'leave') {
        log.withTag(msg.type).info(playerId, msg.gameIds)
        const peers = playerPeersMap.get(playerId)
        if (peers) {
          peers.delete(peer)
          if (!peers.size) {
            playerPeersMap.delete(playerId)
          }
        }
      } else {
        log.withTag('unknown').info(playerId, msg)
      }
    } catch (error) {
      log.error(error)
      peer.send({ type: 'error', message: 'Invalid message format.' } satisfies ErrorResponse)
    }
  },
  error(peer, error) {
    const playerId = peer.context.playerId as string
    log.withTag('error').error(playerId, error)
  },
  close(peer, event) {
    const playerId = peer.context.playerId as string
    log.withTag('close').info(playerId, event)
    const peers = playerPeersMap.get(playerId)
    if (peers) {
      peers.delete(peer)
      if (!peers.size) {
        playerPeersMap.delete(playerId)
      }
    }
  },
})
