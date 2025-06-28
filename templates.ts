export interface PlayerInfo {
  playerId: string
  createdAt: Date
  updatedAt: Date
  whitelist: boolean
  remark?: string
  createIp?: string
  updateIp?: string
}

export interface GameInfo {
  gameId: string
  players: string[]
  createdAt: Date
  updatedAt: Date
  whitelist: boolean
  remark?: string
  turns?: number
  createdPlayer?: string
}

export const renderLoginPage = () => `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unciv Srv - 登录</title>
  <script src="https://unpkg.com/htmx.org@2.0.6"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
    .container { max-width: 400px; margin: 100px auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { text-align: center; color: #333; margin-bottom: 30px; }
    .form-group { margin-bottom: 20px; }
    label { display: block; margin-bottom: 5px; color: #555; }
    input[type="text"], input[type="password"] { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
    button { width: 100%; padding: 12px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
    button:hover { background-color: #0056b3; }
    .error { color: #dc3545; margin-top: 10px; padding: 10px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; }
    .info { color: #6c757d; font-size: 14px; margin-top: 15px; }
    .success { color: #155724; margin-top: 10px; padding: 10px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Unciv Srv</h1>
    <form hx-post="/login" hx-target="#result" hx-swap="innerHTML">
      <div class="form-group">
        <label for="username">用户名:</label>
        <input type="text" id="username" name="username" required>
      </div>
      <div class="form-group">
        <label for="password">密码:</label>
        <input type="password" id="password" name="password" required>
      </div>
      <button type="submit">登录</button>
    </form>
    <div id="result"></div>
    <div class="info">
      <p>使用游戏中的 ID 和密码登录</p>
      <p>只能管理自己的存档</p>
    </div>
  </div>
</body>
</html>
`

export const renderAdminDashboard = (players: PlayerInfo[], games: GameInfo[]) => `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>管理员面板 - Unciv Srv</title>
  <script src="https://unpkg.com/htmx.org@2.0.6"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f8f9fa; }
    .header { background: white; padding: 20px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .header h1 { margin: 0; color: #333; }
    .logout { float: right; background: #dc3545; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px; }
    .logout:hover { background: #c82333; }
    .tabs { margin-bottom: 20px; }
    .tab-button { background: #e9ecef; border: none; padding: 10px 20px; margin-right: 5px; cursor: pointer; border-radius: 4px 4px 0 0; }
    .tab-button.active { background: white; border-bottom: 2px solid #007bff; }
    .tab-content { background: white; padding: 20px; border-radius: 0 8px 8px 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #dee2e6; }
    th { background-color: #f8f9fa; font-weight: 600; }

    @media (max-width: 768px) {
      .table-container { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      table { min-width: 800px; font-size: 14px; }
      th, td { padding: 8px 6px; white-space: nowrap; }
      .btn { padding: 4px 8px; font-size: 11px; margin: 1px; }

      .mobile-card-view table, .mobile-card-view thead, .mobile-card-view tbody, .mobile-card-view th, .mobile-card-view td, .mobile-card-view tr {
        display: block;
      }
      .mobile-card-view thead tr { position: absolute; top: -9999px; left: -9999px; }
      .mobile-card-view tr {
        background: white;
        border: 1px solid #ccc;
        border-radius: 8px;
        margin-bottom: 10px;
        padding: 10px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }
      .mobile-card-view td {
        border: none;
        border-bottom: 1px solid #eee;
        position: relative;
        padding-left: 50% !important;
        padding-top: 8px;
        padding-bottom: 8px;
        white-space: normal;
      }
      .mobile-card-view td:before {
        content: attr(data-label) ": ";
        position: absolute;
        left: 6px;
        width: 45%;
        padding-right: 10px;
        white-space: nowrap;
        font-weight: bold;
        color: #333;
      }
      .mobile-card-view td:last-child { border-bottom: 0; }
    }
    .btn { padding: 6px 12px; margin: 2px; border: none; border-radius: 4px; cursor: pointer; text-decoration: none; display: inline-block; font-size: 12px; }
    .btn-primary { background: #007bff; color: white; }
    .btn-danger { background: #dc3545; color: white; }
    .btn-success { background: #28a745; color: white; }
    .btn:hover { opacity: 0.8; }
    .status-badge { padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; }
    .status-whitelist { background: #d4edda; color: #155724; }
    .status-normal { background: #f8d7da; color: #721c24; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px; }
    .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
    .stat-number { font-size: 2em; font-weight: bold; color: #007bff; }
    .stat-label { color: #6c757d; margin-top: 5px; }
    .loading { opacity: 0.6; pointer-events: none; }
    .htmx-request .loading-indicator { display: inline-block; }
    .loading-indicator { display: none; margin-left: 5px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>管理员面板</h1>
    <a href="/logout" class="logout">退出登录</a>
    <div style="clear: both;"></div>
  </div>

  <div class="stats">
    <div class="stat-card">
      <div class="stat-number">${players.length}</div>
      <div class="stat-label">总玩家数</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">${games.length}</div>
      <div class="stat-label">总存档数</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">${players.filter((p) => p.whitelist).length}</div>
      <div class="stat-label">白名单玩家</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">${games.filter((g) => g.whitelist).length}</div>
      <div class="stat-label">白名单存档</div>
    </div>
  </div>

  <div class="tabs">
    <button class="tab-button active" onclick="showTab('players')">玩家管理</button>
    <button class="tab-button" onclick="showTab('games')">存档管理</button>
  </div>

  <div id="players-tab" class="tab-content">
    <h3>玩家管理</h3>
    <div class="table-controls" style="margin-bottom: 15px;">
      <button onclick="toggleMobileView('players')" class="btn btn-primary" style="display: none;" id="mobile-toggle-players">卡片视图</button>
    </div>
    <div id="players-table" class="table-container">
      ${renderPlayersTable(players)}
    </div>
  </div>

  <div id="games-tab" class="tab-content" style="display: none;">
    <h3>存档管理</h3>
    <div class="table-controls" style="margin-bottom: 15px;">
      <button onclick="toggleMobileView('games')" class="btn btn-primary" style="display: none;" id="mobile-toggle-games">卡片视图</button>
    </div>
    <div id="games-table" class="table-container">
      ${renderGamesTable(games)}
    </div>
  </div>

  <div id="modal"></div>

  <script>
    function showTab(tabName) {
      document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
      document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
      document.getElementById(tabName + '-tab').style.display = 'block';
      event.target.classList.add('active');
    }

    function toggleMobileView(tableType) {
      const container = document.getElementById(tableType + '-table');
      const button = document.getElementById('mobile-toggle-' + tableType);

      if (container.classList.contains('mobile-card-view')) {
        container.classList.remove('mobile-card-view');
        button.textContent = '卡片视图';
      } else {
        container.classList.add('mobile-card-view');
        button.textContent = '表格视图';
      }
    }

    function checkScreenSize() {
      const isMobile = window.innerWidth <= 768;
      const toggleButtons = document.querySelectorAll('[id^="mobile-toggle-"]');

      toggleButtons.forEach(button => {
        if (isMobile) {
          button.style.display = 'inline-block';
        } else {
          button.style.display = 'none';
          const tableType = button.id.replace('mobile-toggle-', '');
          const container = document.getElementById(tableType + '-table');
          if (container) {
            container.classList.remove('mobile-card-view');
          }
        }
      });
    }

    window.addEventListener('load', checkScreenSize);
    window.addEventListener('resize', checkScreenSize);
  </script>
</body>
</html>
`

export const renderPlayersTable = (players: PlayerInfo[]) => `
<table id="players-table-element">
  <thead>
    <tr>
      <th>玩家ID</th>
      <th>创建时间</th>
      <th>最后活动</th>
      <th>状态</th>
      <th>备注</th>
      <th>操作</th>
    </tr>
  </thead>
  <tbody>
    ${
  players.map((player) => `
      <tr>
        <td data-label="玩家ID">${player.playerId}</td>
        <td data-label="创建时间">${new Date(player.createdAt).toLocaleString('zh-CN')}</td>
        <td data-label="最后活动">${new Date(player.updatedAt).toLocaleString('zh-CN')}</td>
        <td data-label="状态">
          <span class="status-badge ${player.whitelist ? 'status-whitelist' : 'status-normal'}">
            ${player.whitelist ? '白名单' : '普通'}
          </span>
        </td>
        <td data-label="备注">${player.remark || '-'}</td>
        <td data-label="操作">
          <button class="btn btn-primary"
              hx-get="/player/${player.playerId}/edit"
              hx-target="#modal"
              hx-swap="innerHTML">
            编辑
          </button>
        </td>
      </tr>
    `).join('')
}
  </tbody>
</table>
`

export const renderGamesTable = (games: GameInfo[]) => `
<table id="games-table-element">
  <thead>
    <tr>
      <th>游戏ID</th>
      <th>玩家</th>
      <th>回合数</th>
      <th>创建时间</th>
      <th>最后更新</th>
      <th>状态</th>
      <th>备注</th>
      <th>操作</th>
    </tr>
  </thead>
  <tbody>
    ${
  games.map((game) => `
      <tr>
        <td data-label="游戏ID">${game.gameId}</td>
        <td data-label="玩家">${Array.isArray(game.players) ? game.players.join(', ') : game.players}</td>
        <td data-label="回合数">${game.turns || 0}</td>
        <td data-label="创建时间">${new Date(game.createdAt).toLocaleString('zh-CN')}</td>
        <td data-label="最后更新">${new Date(game.updatedAt).toLocaleString('zh-CN')}</td>
        <td data-label="状态">
          <span class="status-badge ${game.whitelist ? 'status-whitelist' : 'status-normal'}">
            ${game.whitelist ? '白名单' : '普通'}
          </span>
        </td>
        <td data-label="备注">${game.remark || '-'}</td>
        <td data-label="操作">
          <button class="btn btn-primary"
              hx-get="/game/${game.gameId}/edit"
              hx-target="#modal"
              hx-swap="innerHTML">
            编辑
          </button>
          <button class="btn btn-danger"
              hx-delete="/game/${game.gameId}"
              hx-confirm="确定要删除这个存档吗？"
              hx-swap="none"
              hx-on::after-request="window.location.reload()">
            删除
          </button>
        </td>
      </tr>
    `).join('')
}
  </tbody>
</table>
`

export const renderUserDashboard = (playerId: string, games: GameInfo[]) => `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>用户面板 - Unciv Srv</title>
  <script src="https://unpkg.com/htmx.org@2.0.6"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f8f9fa; }
    .header { background: white; padding: 20px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .header h1 { margin: 0; color: #333; }
    .user-info { color: #6c757d; margin-top: 5px; }
    .logout { float: right; background: #dc3545; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px; }
    .logout:hover { background: #c82333; }
    .content { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #dee2e6; }
    th { background-color: #f8f9fa; font-weight: 600; }

    @media (max-width: 768px) {
      .table-container { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      table { min-width: 700px; font-size: 14px; }
      th, td { padding: 8px 6px; white-space: nowrap; }
      .btn { padding: 4px 8px; font-size: 11px; margin: 1px; }

      .mobile-card-view table, .mobile-card-view thead, .mobile-card-view tbody, .mobile-card-view th, .mobile-card-view td, .mobile-card-view tr {
        display: block;
      }
      .mobile-card-view thead tr { position: absolute; top: -9999px; left: -9999px; }
      .mobile-card-view tr {
        background: white;
        border: 1px solid #ccc;
        border-radius: 8px;
        margin-bottom: 10px;
        padding: 10px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }
      .mobile-card-view td {
        border: none;
        border-bottom: 1px solid #eee;
        position: relative;
        padding-left: 50% !important;
        padding-top: 8px;
        padding-bottom: 8px;
        white-space: normal;
      }
      .mobile-card-view td:before {
        content: attr(data-label) ": ";
        position: absolute;
        left: 6px;
        width: 45%;
        padding-right: 10px;
        white-space: nowrap;
        font-weight: bold;
        color: #333;
      }
      .mobile-card-view td:last-child { border-bottom: 0; }
    }
    .btn { padding: 6px 12px; margin: 2px; border: none; border-radius: 4px; cursor: pointer; text-decoration: none; display: inline-block; font-size: 12px; }
    .btn-danger { background: #dc3545; color: white; }
    .btn:hover { opacity: 0.8; }
    .status-badge { padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; }
    .status-creator { background: #d1ecf1; color: #0c5460; }
    .status-player { background: #d4edda; color: #155724; }
    .empty-state { text-align: center; padding: 40px; color: #6c757d; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px; }
    .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
    .stat-number { font-size: 2em; font-weight: bold; color: #007bff; }
    .stat-label { color: #6c757d; margin-top: 5px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>用户面板</h1>
    <div class="user-info">当前用户: ${playerId}</div>
    <a href="/logout" class="logout">退出登录</a>
    <div style="clear: both;"></div>
  </div>
  <div class="stats">
    <div class="stat-card">
      <div class="stat-number">${games.length}</div>
      <div class="stat-label">参与的存档</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">${games.filter((g) => g.createdPlayer === playerId).length}</div>
      <div class="stat-label">创建的存档</div>
    </div>
  </div>
  <div class="content">
    <h3>我的存档</h3>
    <div class="table-controls" style="margin-bottom: 15px;">
      <button onclick="toggleMobileView('user-games')" class="btn btn-primary" style="display: none;" id="mobile-toggle-user-games">卡片视图</button>
    </div>
    <div id="user-games-table" class="table-container">
      ${renderUserGamesTable(games, playerId)}
    </div>
  </div>

  <div id="modal"></div>

  <script>
    function toggleMobileView(tableType) {
      const container = document.getElementById(tableType + '-table')
      const button = document.getElementById('mobile-toggle-' + tableType)

      if (container.classList.contains('mobile-card-view')) {
        container.classList.remove('mobile-card-view')
        button.textContent = '卡片视图'
      } else {
        container.classList.add('mobile-card-view')
        button.textContent = '表格视图'
      }
    }

    function checkScreenSize() {
      const isMobile = window.innerWidth <= 768
      const toggleButtons = document.querySelectorAll('[id^="mobile-toggle-"]')

      toggleButtons.forEach(button => {
        if (isMobile) {
          button.style.display = 'inline-block'
        } else {
          button.style.display = 'none'
          const tableType = button.id.replace('mobile-toggle-', '')
          const container = document.getElementById(tableType + '-table')
          if (container) {
            container.classList.remove('mobile-card-view')
          }
        }
      })
    }

    window.addEventListener('load', checkScreenSize)
    window.addEventListener('resize', checkScreenSize)
  </script>
</body>
</html>
`

export const renderUserGamesTable = (games: GameInfo[], currentUserId: string) => `
${
  games.length === 0
    ? `
  <div class="empty-state">
    <p>您还没有参与任何存档</p>
    <p>开始游戏后，存档会出现在这里</p>
  </div>`
    : `<table id="user-games-table-element">
    <thead>
      <tr>
        <th>游戏ID</th>
        <th>玩家</th>
        <th>回合数</th>
        <th>创建时间</th>
        <th>最后更新</th>
        <th>我的角色</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      ${
      games.map((game) => {
        const isCreator = game.createdPlayer === currentUserId
        const players = Array.isArray(game.players) ? game.players : []
        return `
          <tr>
            <td data-label="游戏ID">${game.gameId}</td>
            <td data-label="玩家">${players.join(', ')}</td>
            <td data-label="回合数">${game.turns || 0}</td>
            <td data-label="创建时间">${new Date(game.createdAt).toLocaleString('zh-CN')}</td>
            <td data-label="最后更新">${new Date(game.updatedAt).toLocaleString('zh-CN')}</td>
            <td data-label="我的角色">
              <span class="status-badge ${isCreator ? 'status-creator' : 'status-player'}">
                ${isCreator ? '创建者' : '参与者'}
              </span>
            </td>
            <td data-label="操作">
              ${
          isCreator
            ? `<button class="btn btn-danger"
            hx-delete="/game/${game.gameId}"
            hx-confirm="确定要删除这个存档吗？"
            hx-swap="none"
            hx-on::after-request="window.location.reload()">
            删除
          </button>`
            : '-'
        }
            </td>
          </tr>
        `
      }).join('')
    }
    </tbody>
  </table>
`
}
`

export const renderPlayerEditModal = (player: PlayerInfo) => `
<div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;" onclick="this.remove()">
  <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 30px; border-radius: 8px; min-width: 400px; max-width: 90vw; max-height: 90vh; overflow-y: auto;" onclick="event.stopPropagation()">
    <h3>编辑玩家: ${player.playerId}</h3>
    <form hx-put="/player/${player.playerId}" hx-swap="none" hx-on::after-request="window.location.reload()">
      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 5px;">白名单状态:</label>
        <select name="whitelist" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
          <option value="false" ${!player.whitelist ? 'selected' : ''}>普通用户</option>
          <option value="true" ${player.whitelist ? 'selected' : ''}>白名单用户</option>
        </select>
      </div>
      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 5px;">备注:</label>
        <textarea name="remark" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; height: 80px; box-sizing: border-box;">${
  player.remark || ''
}</textarea>
      </div>
      <div style="text-align: right;">
        <button type="button" onclick="document.querySelector('#modal>div').remove()" style="padding: 8px 16px; margin-right: 10px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">取消</button>
        <button type="submit" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">保存</button>
      </div>
    </form>
  </div>
</div>
`

export const renderGameEditModal = (game: GameInfo) => `
<div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000;" onclick="this.remove()">
  <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 30px; border-radius: 8px; min-width: 400px; max-width: 90vw; max-height: 90vh; overflow-y: auto;" onclick="event.stopPropagation()">
    <h3>编辑存档: ${game.gameId}</h3>
    <form hx-put="/game/${game.gameId}" hx-swap="none" hx-on::after-request="window.location.reload()">
      <div style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 5px;">白名单状态:</label>
        <select name="whitelist" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
          <option value="false" ${!game.whitelist ? 'selected' : ''}>普通存档</option>
          <option value="true" ${game.whitelist ? 'selected' : ''}>白名单存档</option>
        </select>
      </div>
      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 5px;">备注:</label>
        <textarea name="remark" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; height: 80px; box-sizing: border-box;">${
  game.remark || ''
}</textarea>
      </div>
      <div style="text-align: right;">
        <button type="button" onclick="document.querySelector('#modal>div').remove()" style="padding: 8px 16px; margin-right: 10px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">取消</button>
        <button type="submit" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">保存</button>
      </div>
    </form>
  </div>
</div>
`
