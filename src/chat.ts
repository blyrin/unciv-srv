import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { RawData } from 'ws'
import { WebSocket, WebSocketServer } from 'ws'
import type { ServerType } from '@hono/node-server'
import { getGameByID } from './database.js'
import { validatePlayer } from './middleware.js'
import {
  decodeHeaderValue, getBaseGameID, isPreviewID, normalizeClientIP, parseBasicAuthCredentials, validateGameID,
} from './utils.js'

export type MessageType =
  | 'join'
  | 'leave'
  | 'chat'
  | 'joinSuccess'
  | 'error'
  | 'gameUpdated'
  | 'onlineQuery'
  | 'onlineResponse'

export interface GenericMessage {
  type?: MessageType
  gameId?: string
  gameIds?: string[]
  civName?: string
  message?: string
}

interface Peer {
  ws: WebSocket
  playerId: string
  ip: string
  ua: string
  alive: boolean
  heartbeat: NodeJS.Timeout
  connectedAt: number
}

const gameSubscribers = new Map<string, Set<Peer>>()
const peerSubscriptions = new Map<Peer, Set<string>>()
const playerPeers = new Map<string, Set<Peer>>()

/**
 * 读取请求头中的首个值。
 */
function firstHeaderValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

/**
 * 获取 WebSocket 客户端 IP。
 */
function getWebSocketClientIP(request: IncomingMessage): string {
  const forwardedFor = firstHeaderValue(request.headers['x-forwarded-for'])
  if (forwardedFor) {
    const comma = forwardedFor.indexOf(',')
    return normalizeClientIP(comma >= 0 ? forwardedFor.slice(0, comma).trim() : forwardedFor)
  }

  const realIP = firstHeaderValue(request.headers['x-real-ip'])
  return normalizeClientIP(realIP || request.socket.remoteAddress || 'unknown')
}

/**
 * 获取连接当前订阅数量。
 */
function getPeerSubscriptionCount(peer: Peer): number {
  return peerSubscriptions.get(peer)?.size ?? 0
}

/**
 * 读取日志中使用的消息类型。
 */
function getMessageLogType(message: unknown): string {
  if (!message || typeof message !== 'object' || !('type' in message)) {
    return ''
  }
  const type = (message as { type?: unknown }).type
  return typeof type === 'string' ? type : ''
}

/**
 * 判断聊天频道是否为普通游戏 ID。
 */
function isValidGameChannelID(gameId: string | undefined): gameId is string {
  return Boolean(gameId && validateGameID(gameId) && !isPreviewID(gameId))
}

/**
 * 向连接发送 JSON 消息。
 */
function sendJSON(peer: Peer, message: unknown): void {
  if (peer.ws.readyState !== WebSocket.OPEN) {
    cleanupPeer(peer)
    return
  }
  peer.ws.send(JSON.stringify(message), (error) => {
    if (error) {
      console.error('WebSocket 发送消息失败', {
        playerId: peer.playerId,
        ip: peer.ip,
        messageType: getMessageLogType(message),
      }, error)
      cleanupPeer(peer)
    }
  })
}

/**
 * 向连接发送错误消息。
 */
function sendError(peer: Peer, message: string): void {
  sendJSON(peer, { type: 'error', message })
}

/**
 * 登记玩家在线连接。
 */
function registerPlayerPeer(peer: Peer): void {
  const peers = playerPeers.get(peer.playerId) ?? new Set<Peer>()
  peers.add(peer)
  playerPeers.set(peer.playerId, peers)
}

/**
 * 清理玩家在线连接。
 */
function unregisterPlayerPeer(peer: Peer): void {
  const peers = playerPeers.get(peer.playerId)
  if (!peers) {
    return
  }
  peers.delete(peer)
  if (peers.size === 0) {
    playerPeers.delete(peer.playerId)
  }
}

/**
 * 订阅游戏频道并返回有效 ID 列表。
 */
function subscribePeer(peer: Peer, gameIds: string[] | undefined): string[] {
  const validGameIds: string[] = []
  const subscriptions = peerSubscriptions.get(peer) ?? new Set<string>()
  peerSubscriptions.set(peer, subscriptions)

  for (const gameId of gameIds ?? []) {
    if (!isValidGameChannelID(gameId)) {
      continue
    }
    subscriptions.add(gameId)
    const subscribers = gameSubscribers.get(gameId) ?? new Set<Peer>()
    subscribers.add(peer)
    gameSubscribers.set(gameId, subscribers)
    validGameIds.push(gameId)
  }

  return validGameIds
}

/**
 * 取消订阅游戏频道。
 */
function unsubscribePeer(peer: Peer, gameIds: string[] | undefined): string[] {
  const subscriptions = peerSubscriptions.get(peer)
  if (!subscriptions) {
    return []
  }

  const removedGameIds: string[] = []
  for (const gameId of gameIds ?? []) {
    if (!isValidGameChannelID(gameId)) {
      continue
    }
    if (subscriptions.delete(gameId)) {
      removedGameIds.push(gameId)
    }
    const subscribers = gameSubscribers.get(gameId)
    subscribers?.delete(peer)
    if (subscribers?.size === 0) {
      gameSubscribers.delete(gameId)
    }
  }

  if (subscriptions.size === 0) {
    peerSubscriptions.delete(peer)
  }
  return removedGameIds
}

/**
 * 清理连接持有的全部订阅。
 */
function cleanupPeerSubscriptions(peer: Peer): void {
  const subscriptions = peerSubscriptions.get(peer)
  if (!subscriptions) {
    return
  }
  for (const gameId of subscriptions) {
    const subscribers = gameSubscribers.get(gameId)
    subscribers?.delete(peer)
    if (subscribers?.size === 0) {
      gameSubscribers.delete(gameId)
    }
  }
  peerSubscriptions.delete(peer)
}

/**
 * 清理连接状态。
 */
function cleanupPeer(peer: Peer): void {
  clearInterval(peer.heartbeat)
  cleanupPeerSubscriptions(peer)
  unregisterPlayerPeer(peer)
}

/**
 * 判断连接是否订阅了指定游戏频道。
 */
function isPeerSubscribed(peer: Peer, gameId: string): boolean {
  return peerSubscriptions.get(peer)?.has(gameId) ?? false
}

/**
 * 获取游戏频道订阅者。
 */
function getGameSubscriberPeers(gameId: string): Peer[] {
  return Array.from(gameSubscribers.get(gameId) ?? [])
}

/**
 * 获取玩家在线连接。
 */
function getPlayerPeers(playerId: string): Peer[] {
  return Array.from(playerPeers.get(playerId) ?? [])
}

/**
 * 向连接列表去重广播消息。
 */
function publishToPeers(peers: Peer[], message: unknown): number {
  const sent = new Set<Peer>()
  for (const peer of peers) {
    if (sent.has(peer)) {
      continue
    }
    sent.add(peer)
    sendJSON(peer, message)
  }
  return sent.size
}

/**
 * 获取旧客户端依赖的玩家在线连接。
 */
function getLegacyChatPeers(playerId: string, gameId: string): { peers: Peer[]; allowed: boolean } {
  const game = getGameByID(gameId)
  if (!game || !game.players.includes(playerId)) {
    return { peers: [], allowed: false }
  }

  const peers: Peer[] = []
  for (const gamePlayerId of game.players) {
    peers.push(...getPlayerPeers(gamePlayerId))
  }
  return { peers, allowed: true }
}

/**
 * 处理加入频道消息。
 */
function handleJoin(peer: Peer, msg: GenericMessage): void {
  const gameIds = subscribePeer(peer, msg.gameIds)
  sendJSON(peer, {
    type: 'joinSuccess',
    gameIds,
  })
  console.info('WebSocket 订阅频道', {
    playerId: peer.playerId,
    ip: peer.ip,
    requested: msg.gameIds?.length ?? 0,
    accepted: gameIds.length,
    subscriptions: getPeerSubscriptionCount(peer),
    gameIds,
  })
}

/**
 * 处理离开频道消息。
 */
function handleLeave(peer: Peer, msg: GenericMessage): void {
  const gameIds = unsubscribePeer(peer, msg.gameIds)
  console.info('WebSocket 取消订阅频道', {
    playerId: peer.playerId,
    ip: peer.ip,
    requested: msg.gameIds?.length ?? 0,
    removed: gameIds.length,
    subscriptions: getPeerSubscriptionCount(peer),
    gameIds,
  })
}

/**
 * 处理聊天广播消息。
 */
function handleChat(peer: Peer, msg: GenericMessage): void {
  if (!isValidGameChannelID(msg.gameId)) {
    console.info('WebSocket 拒绝聊天消息', {
      playerId: peer.playerId,
      ip: peer.ip,
      gameId: msg.gameId ?? '',
      reason: '无效游戏ID',
    })
    sendJSON(peer, {
      type: 'chat',
      civName: 'Server',
      message: '无效的游戏ID，无法转发消息',
    })
    return
  }

  const response = {
    type: 'chat',
    gameId: msg.gameId,
    civName: msg.civName,
    message: msg.message,
  }

  const subscribed = isPeerSubscribed(peer, msg.gameId)
  let targetPeers = getGameSubscriberPeers(msg.gameId)
  let legacyAllowed = false

  try {
    const legacy = getLegacyChatPeers(peer.playerId, msg.gameId)
    targetPeers = targetPeers.concat(legacy.peers)
    legacyAllowed = legacy.allowed
  } catch (error) {
    if (!subscribed) {
      console.error('WebSocket 获取游戏失败', {
        playerId: peer.playerId,
        ip: peer.ip,
        gameId: msg.gameId,
      }, error)
      sendError(peer, '发送消息失败')
      return
    }
    console.error('WebSocket 旧客户端聊天广播失败', {
      playerId: peer.playerId,
      ip: peer.ip,
      gameId: msg.gameId,
    }, error)
  }

  if (!subscribed && !legacyAllowed) {
    console.info('WebSocket 拒绝聊天消息', {
      playerId: peer.playerId,
      ip: peer.ip,
      gameId: msg.gameId,
      reason: '未订阅频道',
    })
    sendError(peer, '未订阅此频道')
    return
  }
  const targets = publishToPeers(targetPeers, response)
  console.info('WebSocket 转发聊天消息', {
    playerId: peer.playerId,
    ip: peer.ip,
    gameId: msg.gameId,
    civName: msg.civName ?? '',
    targets,
    subscribed,
    legacyAllowed,
  })
}

/**
 * 转发在线状态消息。
 */
function handleOnlineMessage(peer: Peer, msg: GenericMessage): void {
  if (!isValidGameChannelID(msg.gameId)) {
    console.info('WebSocket 忽略在线状态消息', {
      playerId: peer.playerId,
      ip: peer.ip,
      type: msg.type ?? '',
      gameId: msg.gameId ?? '',
      reason: '无效游戏ID',
    })
    return
  }

  if (!isPeerSubscribed(peer, msg.gameId)) {
    console.info('WebSocket 忽略在线状态消息', {
      playerId: peer.playerId,
      ip: peer.ip,
      type: msg.type ?? '',
      gameId: msg.gameId,
      reason: '未订阅频道',
    })
    return
  }
  const targets = publishToPeers(getGameSubscriberPeers(msg.gameId), {
    type: msg.type,
    gameId: msg.gameId,
    civName: msg.civName,
  })
  console.info('WebSocket 转发在线状态消息', {
    playerId: peer.playerId,
    ip: peer.ip,
    type: msg.type ?? '',
    gameId: msg.gameId,
    civName: msg.civName ?? '',
    targets,
  })
}

/**
 * 解析并分发 WebSocket 消息。
 */
function handleMessage(peer: Peer, data: RawData): void {
  let msg: GenericMessage
  const text = data.toString()
  try {
    msg = JSON.parse(text) as GenericMessage
  } catch {
    console.info('WebSocket 拒绝消息', {
      playerId: peer.playerId,
      ip: peer.ip,
      reason: '无效消息格式',
      bytes: Buffer.byteLength(text),
    })
    sendError(peer, '无效的消息格式')
    return
  }

  switch (msg.type) {
    case 'join':
      handleJoin(peer, msg)
      break
    case 'leave':
      handleLeave(peer, msg)
      break
    case 'chat':
      handleChat(peer, msg)
      break
    case 'onlineQuery':
    case 'onlineResponse':
      handleOnlineMessage(peer, msg)
      break
    default:
      console.info('WebSocket 忽略未知消息类型', {
        playerId: peer.playerId,
        ip: peer.ip,
        type: msg.type ?? '',
      })
      break
  }
}

/**
 * 解析 WebSocket Basic Auth。
 */
export function parseWebSocketAuth(request: IncomingMessage): string {
  const credentials = parseBasicAuthCredentials(request.headers.authorization)
  if (!validatePlayer(credentials.playerId, credentials.password)) {
    throw new Error('认证失败')
  }
  return credentials.playerId
}

/**
 * 将聊天 WebSocket 绑定到 HTTP server。
 */
export function attachChatWebSocket(server: ServerType): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 })

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const ip = getWebSocketClientIP(request)
    const ua = decodeHeaderValue(firstHeaderValue(request.headers['user-agent']))
    if (url.pathname !== '/chat') {
      console.info('WebSocket 拒绝升级', {
        path: url.pathname,
        ip,
        ua,
        reason: '非聊天路径',
      })
      socket.destroy()
      return
    }

    let playerId: string
    try {
      playerId = parseWebSocketAuth(request)
    } catch (error) {
      console.info('WebSocket 认证失败', {
        path: url.pathname,
        ip,
        ua,
        reason: error instanceof Error ? error.message : '认证失败',
      })
      const body = '认证失败\n'
      socket.write(
        `HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
      )
      socket.destroy()
      return
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const peer: Peer = {
        ws,
        playerId,
        ip,
        ua,
        alive: true,
        heartbeat: setInterval(() => {
          if (!peer.alive) {
            console.info('WebSocket 心跳超时', {
              playerId: peer.playerId,
              ip: peer.ip,
              subscriptions: getPeerSubscriptionCount(peer),
            })
            ws.terminate()
            return
          }
          peer.alive = false
          ws.ping()
        }, 30 * 1000),
        connectedAt: performance.now(),
      }
      peer.heartbeat.unref()

      registerPlayerPeer(peer)
      console.info('WebSocket 连接建立', {
        playerId: peer.playerId,
        ip: peer.ip,
        ua: peer.ua,
        playerConnections: playerPeers.get(peer.playerId)?.size ?? 0,
      })
      ws.on('pong', () => {
        peer.alive = true
      })
      ws.on('message', (data) => handleMessage(peer, data))
      ws.on('close', (code, reason) => {
        console.info('WebSocket 连接关闭', {
          playerId: peer.playerId,
          ip: peer.ip,
          code,
          reason: reason.toString(),
          duration: `${(performance.now() - peer.connectedAt).toFixed(2)}ms`,
          subscriptions: getPeerSubscriptionCount(peer),
        })
        cleanupPeer(peer)
      })
      ws.on('error', (error) => {
        console.error('WebSocket 连接错误', {
          playerId: peer.playerId,
          ip: peer.ip,
          subscriptions: getPeerSubscriptionCount(peer),
        }, error)
        cleanupPeer(peer)
      })
    })
  })
}

/**
 * 通知游戏频道订阅者存档已更新。
 */
export function notifyGameUpdated(gameId: string): void {
  const baseGameId = getBaseGameID(gameId)
  const targets = publishToPeers(getGameSubscriberPeers(baseGameId), {
    type: 'gameUpdated',
    gameId: baseGameId,
  })
  if (targets > 0) {
    console.info('WebSocket 推送游戏更新', {
      gameId: baseGameId,
      targets,
    })
  }
}

/**
 * 清空聊天状态，供测试隔离使用。
 */
export function resetChatState(): void {
  for (const peers of playerPeers.values()) {
    for (const peer of peers) {
      clearInterval(peer.heartbeat)
    }
  }
  gameSubscribers.clear()
  peerSubscriptions.clear()
  playerPeers.clear()
}
