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
    try {
      await this.get('/api/players')
      return { isLoggedIn: true, isAdmin: true }
    } catch (error) {
      try {
        await this.get('/api/users/games')
        return { isLoggedIn: true, isAdmin: false }
      } catch (e) {
        return { isLoggedIn: false, isAdmin: false }
      }
    }
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
