class API {
  static async request(url, options = {}) {
    const defaultOptions = {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    }

    try {
      const response = await fetch(url, { ...defaultOptions, ...options })

      if (response.status === 401) {
        throw new Error('Unauthorized')
      }

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || '请求失败')
      }

      if (response.status === 204) {
        return null
      }

      return await response.json()
    } catch (error) {
      if (error.message !== 'Unauthorized') {
        UI.showToast(error.message || '网络错误', 'error')
      }
      throw error
    }
  }

  static async requestWithAuth(url, options = {}) {
    try {
      return await this.request(url, options)
    } catch (error) {
      if (error.message === 'Unauthorized') {
        UI.showToast('未登录，请重新登录', 'error')
        setTimeout(() => {
          window.location.href = '/'
        }, 1500)
      }
      throw error
    }
  }

  static async checkSession() {
    return await this.get('/api/session')
  }

  static async login(username, password) {
    return this.post('/api/login', { username, password })
  }

  static async getPlayers() {
    return this.requestWithAuth('/api/players', { method: 'GET' })
  }

  static async updatePlayer(playerId, data) {
    return this.requestWithAuth('/api/players/' + playerId, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  static async getPlayerPassword(playerId) {
    return this.requestWithAuth('/api/players/' + playerId + '/password', { method: 'GET' })
  }

  static async getGames() {
    return this.requestWithAuth('/api/games', { method: 'GET' })
  }

  static async updateGame(gameId, data) {
    return this.requestWithAuth('/api/games/' + gameId, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  static async getStats() {
    return this.requestWithAuth('/api/stats', { method: 'GET' })
  }

  static async getUserGames() {
    return this.requestWithAuth('/api/users/games', { method: 'GET' })
  }

  static async getUserStats() {
    return this.requestWithAuth('/api/users/stats', { method: 'GET' })
  }

  static async downloadGame(gameId) {
    window.location.href = '/api/games/' + gameId + '/download'
  }

  static async deleteGame(gameId) {
    return this.requestWithAuth('/api/games/' + gameId, { method: 'DELETE' })
  }

  static async getGameTurns(gameId) {
    return this.requestWithAuth('/api/games/' + gameId + '/turns', { method: 'GET' })
  }

  static downloadTurn(gameId, turnId) {
    window.location.href = '/api/games/' + gameId + '/turns/' + turnId + '/download'
  }

  static async batchUpdatePlayers(playerIds, whitelist) {
    return this.requestWithAuth('/api/players/batch', {
      method: 'PATCH',
      body: JSON.stringify({ playerIds, whitelist }),
    })
  }

  static async batchUpdateGames(gameIds, whitelist) {
    return this.requestWithAuth('/api/games/batch', {
      method: 'PATCH',
      body: JSON.stringify({ gameIds, whitelist }),
    })
  }

  static async batchDeleteGames(gameIds) {
    return this.requestWithAuth('/api/games/batch', {
      method: 'DELETE',
      body: JSON.stringify({ gameIds }),
    })
  }

  static get(url) {
    return this.request(url, { method: 'GET' })
  }

  static post(url, data) {
    return this.request(url, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  static put(url, data) {
    return this.request(url, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  static delete(url) {
    return this.request(url, { method: 'DELETE' })
  }
}

class UI {
  // 格式化日期
  static formatDate(dateStr) {
    return new Date(dateStr).toLocaleString('zh-CN')
  }

  // 换行
  static wrapDiv(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  // 初始化标签页
  static initTabs(viewId, onTabChange) {
    const view = document.getElementById(viewId)
    const tabs = view.querySelectorAll('.tab')
    const contents = view.querySelectorAll('.tab-content')

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'))
        contents.forEach(c => c.classList.remove('active'))
        tab.classList.add('active')
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active')
        if (onTabChange) onTabChange(tab.dataset.tab)
      })
    })
  }

  // 查看游戏历史
  static async viewGameHistory(gameId, showIp = false) {
    try {
      const turns = await API.getGameTurns(gameId)

      if (turns.length === 0) {
        UI.showToast('该游戏暂无存档记录', 'error')
        return
      }

      const ipHeader = showIp ? '<th>创建IP</th>' : ''
      const content = `
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>回合</th>
                <th>创建者</th>
                ${ipHeader}
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${turns.map(turn => `
                <tr>
                  <td>${turn.turns}</td>
                  <td><code>${turn.createdPlayer || '-'}</code></td>
                  ${showIp ? `<td><code>${turn.createdIp || '-'}</code></td>` : ''}
                  <td>${UI.formatDate(turn.createdAt)}</td>
                  <td>
                    <button class="btn btn-success btn-sm" onclick="API.downloadTurn('${gameId}', ${turn.id})">下载</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `

      UI.showModal(`游戏历史 - ${gameId}`, content, () => true)
    } catch (error) {
      UI.showToast('获取历史记录失败', 'error')
    }
  }

  static showToast(message, type = 'success') {
    const existing = document.querySelector('.toast')
    if (existing) existing.remove()

    const toast = document.createElement('div')
    toast.className = `toast toast-${type}`
    toast.textContent = message
    document.body.appendChild(toast)

    setTimeout(() => toast.remove(), 3000)
  }

  static showModal(title, content, onConfirm, onCancel = null) {
    const existing = document.querySelector('.modal')
    if (existing) existing.remove()

    const modal = document.createElement('div')
    modal.className = 'modal'
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close" aria-label="关闭">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="modal-body">${content}</div>
        <div class="modal-footer">
          <button class="btn btn-cancel">取消</button>
          <button class="btn btn-confirm">确认</button>
        </div>
      </div>`

    document.body.appendChild(modal)

    const confirmBtn = modal.querySelector('.btn-confirm')
    const cancelBtn = modal.querySelector('.btn-cancel')
    const closeBtn = modal.querySelector('.modal-close')

    const closeModal = () => {
      modal.style.animation = 'modalBgOut 0.2s ease forwards'
      modal.querySelector('.modal-content').style.animation = 'modalOut 0.2s ease forwards'
      setTimeout(() => {
        modal.remove()
        if (onCancel) onCancel()
      }, 200)
    }

    closeBtn.addEventListener('click', closeModal)
    cancelBtn.addEventListener('click', closeModal)

    confirmBtn.addEventListener('click', () => {
      if (onConfirm()) {
        modal.style.animation = 'modalBgOut 0.2s ease forwards'
        modal.querySelector('.modal-content').style.animation = 'modalOut 0.2s ease forwards'
        setTimeout(() => modal.remove(), 200)
      }
    })

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal()
    })

    // 支持 ESC 键关闭
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        closeModal()
        document.removeEventListener('keydown', handleEsc)
      }
    }
    document.addEventListener('keydown', handleEsc)
  }

  static confirm(message, onConfirm) {
    this.showModal('确认操作', `<p style="color: var(--gray-600); line-height: 1.6;">${message}</p>`, () => {
      onConfirm()
      return true
    })
  }
}

// 批量选择管理器
class BatchSelector {
  constructor(config) {
    this.checkboxClass = config.checkboxClass
    this.selectAllId = config.selectAllId
    this.countId = config.countId
    this.barId = config.barId
  }

  getSelected() {
    return Array.from(document.querySelectorAll(`.${this.checkboxClass}:checked`)).map(cb => cb.value)
  }

  updateBar() {
    const selected = this.getSelected()
    document.getElementById(this.countId).textContent = selected.length
    document.getElementById(this.barId).classList.toggle('show', selected.length > 0)
  }

  toggleSelectAll() {
    const selectAll = document.getElementById(this.selectAllId).checked
    document.querySelectorAll(`.${this.checkboxClass}`).forEach(cb => cb.checked = selectAll)
    this.updateBar()
  }

  reset() {
    document.getElementById(this.selectAllId).checked = false
    this.updateBar()
  }
}
