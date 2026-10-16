import type { Server, ServerWebSocket, WebSocketHandler } from 'bun'
import { getGameByID } from './database.js'
import { authenticatePlayer, pendingApprovalMessage } from './middleware.js'
import { recordChatMessage } from './metrics.js'
import type { Config } from './types.js'
import {
  decodeHeaderValue, getBaseGameID, HttpError, isPreviewID, maxWebSocketFrameSize, normalizeClientIP,
  parseBasicAuthCredentials, validateGameID,
} from './utils.js'

/**
 * 聊天功能是否开启，由 createChatWebSocket 依据配置设置。
 */
let chatEnabled = true

/**
 * 聊天功能关闭时的提示信息。
 */
export const chatDisabledMessage = '聊天功能已关闭'

export type MessageType =
  | 'join'
  | 'leave'
  | 'chat'
  | 'joinSuccess'
  | 'error'
  | 'gameUpdated'
  | 'onlineQuery'
  | 'onlineResponse'
  | 'opSignal'

export interface GenericMessage {
  type?: MessageType
  gameId?: string
  gameIds?: string[]
  civName?: string
  message?: string
  turn?: number
  playerId?: string
  sequence?: number
}

/** 每个 WebSocket 连接的上下文数据，升级时写入、事件里读取 */
export interface PeerData {
  playerId: string
  ip: string
  ua: string
  connectedAt: number
}

type Peer = ServerWebSocket<PeerData>

const gameSubscribers = new Map<string, Set<Peer>>()
const peerSubscriptions = new Map<Peer, Set<string>>()
const playerPeers = new Map<string, Set<Peer>>()

/**
 * 读取请求头中的首个值。
 */
function firstHeaderValue(value: string | null): string {
  return value ?? ''
}

/**
 * 获取 WebSocket 客户端 IP。
 */
function getWebSocketClientIP(request: Request, remoteAddress: string): string {
  const forwardedFor = firstHeaderValue(request.headers.get('x-forwarded-for'))
  if (forwardedFor) {
    const comma = forwardedFor.indexOf(',')
    return normalizeClientIP(comma >= 0 ? forwardedFor.slice(0, comma).trim() : forwardedFor)
  }

  const realIP = firstHeaderValue(request.headers.get('x-real-ip'))
  return normalizeClientIP(realIP || remoteAddress || 'unknown')
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
 * 把收到的帧统一转为文本。
 */
function messageText(message: string | ArrayBuffer | Uint8Array): string {
  if (typeof message === 'string') {
    return message
  }
  return new TextDecoder().decode(message instanceof ArrayBuffer ? new Uint8Array(message) : message)
}

/**
 * 向连接发送 JSON 消息。
 */
function sendJSON(peer: Peer, message: unknown): void {
  if (peer.readyState !== WebSocket.OPEN) {
    cleanupPeer(peer)
    return
  }
  try {
    const sent = peer.send(JSON.stringify(message))
    if (sent === 0) {
      throw new Error('连接已断开，消息被丢弃')
    }
  } catch (error) {
    console.error('WebSocket 发送消息失败', {
      playerId: peer.data.playerId,
      ip: peer.data.ip,
      messageType: getMessageLogType(message),
    }, error)
    cleanupPeer(peer)
  }
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
  const peers = playerPeers.get(peer.data.playerId) ?? new Set<Peer>()
  peers.add(peer)
  playerPeers.set(peer.data.playerId, peers)
}

/**
 * 清理玩家在线连接。
 */
function unregisterPlayerPeer(peer: Peer): void {
  const peers = playerPeers.get(peer.data.playerId)
  if (!peers) {
    return
  }
  peers.delete(peer)
  if (peers.size === 0) {
    playerPeers.delete(peer.data.playerId)
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
    playerId: peer.data.playerId,
    ip: peer.data.ip,
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
    playerId: peer.data.playerId,
    ip: peer.data.ip,
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
      playerId: peer.data.playerId,
      ip: peer.data.ip,
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
    const legacy = getLegacyChatPeers(peer.data.playerId, msg.gameId)
    targetPeers = targetPeers.concat(legacy.peers)
    legacyAllowed = legacy.allowed
  } catch (error) {
    if (!subscribed) {
      console.error('WebSocket 获取游戏失败', {
        playerId: peer.data.playerId,
        ip: peer.data.ip,
        gameId: msg.gameId,
      }, error)
      sendError(peer, '发送消息失败')
      return
    }
    console.error('WebSocket 旧客户端聊天广播失败', {
      playerId: peer.data.playerId,
      ip: peer.data.ip,
      gameId: msg.gameId,
    }, error)
  }

  if (!subscribed && !legacyAllowed) {
    console.info('WebSocket 拒绝聊天消息', {
      playerId: peer.data.playerId,
      ip: peer.data.ip,
      gameId: msg.gameId,
      reason: '未订阅频道',
    })
    sendError(peer, '未订阅此频道')
    return
  }
  const targets = publishToPeers(targetPeers, response)
  recordChatMessage()
  console.info('WebSocket 转发聊天消息', {
    playerId: peer.data.playerId,
    ip: peer.data.ip,
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
      playerId: peer.data.playerId,
      ip: peer.data.ip,
      type: msg.type ?? '',
      gameId: msg.gameId ?? '',
      reason: '无效游戏ID',
    })
    return
  }

  if (!isPeerSubscribed(peer, msg.gameId)) {
    console.info('WebSocket 忽略在线状态消息', {
      playerId: peer.data.playerId,
      ip: peer.data.ip,
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
    playerId: peer.data.playerId,
    ip: peer.data.ip,
    type: msg.type ?? '',
    gameId: msg.gameId,
    civName: msg.civName ?? '',
    targets,
  })
}

function handleOperationSignal(peer: Peer, msg: GenericMessage): void {
  if (!isValidGameChannelID(msg.gameId) || !isPeerSubscribed(peer, msg.gameId)) return
  publishToPeers(getGameSubscriberPeers(msg.gameId), {
    type: 'opSignal', gameId: msg.gameId, turn: msg.turn, playerId: msg.playerId, sequence: msg.sequence,
  })
}

function handleMessage(peer: Peer, message: string | ArrayBuffer | Uint8Array): void {
  let msg: GenericMessage
  const text = messageText(message)
  try {
    msg = JSON.parse(text) as GenericMessage
  } catch {
    console.info('WebSocket 拒绝消息', {
      playerId: peer.data.playerId,
      ip: peer.data.ip,
      reason: '无效消息格式',
      bytes: new TextEncoder().encode(text).length,
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
      if (!chatEnabled) {
        console.info('WebSocket 拒绝聊天消息', {
          playerId: peer.data.playerId,
          ip: peer.data.ip,
          reason: '聊天功能已关闭',
        })
        sendError(peer, chatDisabledMessage)
        break
      }
      handleChat(peer, msg)
      break
    case 'onlineQuery':
    case 'onlineResponse':
      handleOnlineMessage(peer, msg)
      break
    case 'opSignal':
      handleOperationSignal(peer, msg)
      break
    default:
      console.info('WebSocket 忽略未知消息类型', {
        playerId: peer.data.playerId,
        ip: peer.data.ip,
        type: msg.type ?? '',
      })
      break
  }
}

/**
 * 解析 WebSocket Basic Auth。
 */
export async function parseWebSocketAuth(authorization: string | null | undefined): Promise<string> {
  const credentials = parseBasicAuthCredentials(authorization)
  const result = await authenticatePlayer(credentials.playerId, credentials.password)
  if (result.type === 'pending') {
    throw new HttpError(403, pendingApprovalMessage)
  }
  if (result.type !== 'ok') {
    throw new HttpError(401, '认证失败')
  }
  return result.playerId
}

/** 聊天 WebSocket 处理器：handlers 交给 Bun.serve，upgrade 在 fetch 里调用 */
export interface ChatWebSocket {
  handlers: WebSocketHandler<PeerData>
  /**
   * 尝试把 /chat 请求升级为 WebSocket：认证失败返回错误响应，成功升级返回 undefined。
   */
  upgrade(request: Request, server: Server<PeerData>): Promise<Response | undefined>
}

/**
 * 创建聊天 WebSocket 处理器，按配置决定是否允许聊天。
 */
export function createChatWebSocket(config: Config): ChatWebSocket {
  chatEnabled = config.chatEnabled

  const handlers: WebSocketHandler<PeerData> = {
    data: {} as PeerData,
    idleTimeout: 30,
    maxPayloadLength: maxWebSocketFrameSize,
    open(peer) {
      registerPlayerPeer(peer)
      console.info('WebSocket 连接建立', {
        playerId: peer.data.playerId,
        ip: peer.data.ip,
        ua: peer.data.ua,
        playerConnections: playerPeers.get(peer.data.playerId)?.size ?? 0,
      })
    },
    message(peer, message) {
      handleMessage(peer, message)
    },
    close(peer, code, reason) {
      console.info('WebSocket 连接关闭', {
        playerId: peer.data.playerId,
        ip: peer.data.ip,
        code,
        reason,
        duration: `${(performance.now() - peer.data.connectedAt).toFixed(2)}ms`,
        subscriptions: getPeerSubscriptionCount(peer),
      })
      cleanupPeer(peer)
    },
  }

  return {
    handlers,
    async upgrade(request, server) {
      const url = new URL(request.url)
      const ip = getWebSocketClientIP(request, server.requestIP(request)?.address ?? '')
      const ua = decodeHeaderValue(request.headers.get('user-agent') ?? '')
      if (url.pathname !== '/chat') {
        console.info('WebSocket 拒绝升级', {
          path: url.pathname,
          ip,
          ua,
          reason: '非聊天路径',
        })
        return new Response('Not Found\n', { status: 404 })
      }

      let playerId: string
      try {
        playerId = await parseWebSocketAuth(request.headers.get('authorization'))
      } catch (error) {
        console.info('WebSocket 认证失败', {
          path: url.pathname,
          ip,
          ua,
          reason: error instanceof Error ? error.message : '认证失败',
        })
        const status = error instanceof HttpError ? error.status : 401
        const body = `${error instanceof Error ? error.message : '认证失败'}\n`
        return new Response(body, {
          status,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }

      const upgraded = server.upgrade(request, {
        data: { playerId, ip, ua, connectedAt: performance.now() },
      })
      if (!upgraded) {
        return new Response('升级失败\n', { status: 400 })
      }
      return undefined
    },
  }
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
  gameSubscribers.clear()
  peerSubscriptions.clear()
  playerPeers.clear()
}
