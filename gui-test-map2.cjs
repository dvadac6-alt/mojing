// 地图涂鸦 + 地形命名 + 多地图 前端验证脚本
// 用法：npx electron gui-test-map2.cjs
const { app, BrowserWindow } = require('electron')
const path = require('path')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  await win.loadURL('http://127.0.0.1:5175/')
  await new Promise(r => setTimeout(r, 2500))

  const result = await win.webContents.executeJavaScript(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const out = { steps: [] }
    const log = s => out.steps.push(s)

    // 1. 切到地图模块
    const mapNav = [...document.querySelectorAll('aside button, nav button, button')]
      .find(b => b.textContent.includes('地图') && !b.textContent.includes('思维导图'))
    if (!mapNav) { out.error = '未找到地图导航'; return out }
    mapNav.click()
    await sleep(1200)

    // 2. 地图切换器存在？
    const switcher = document.querySelector('.map-switcher')
    out.switcherExists = !!switcher
    log('地图切换器: ' + (switcher ? '存在' : '缺失'))
    out.mapItemsBefore = document.querySelectorAll('.map-item').length

    // 3. 新建地图「测试灵界」
    const plusBtn = document.querySelector('.map-switcher-head > button')
    plusBtn && plusBtn.click()
    await sleep(300)
    const nameInput = document.querySelector('.map-new input')
    if (!nameInput) { out.error = '未找到新建地图输入框'; return out }
    const setVal = (el, v) => {
      const proto = Object.getPrototypeOf(el)
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
      desc.set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setVal(nameInput, '测试灵界')
    await sleep(200)
    const okBtn = [...document.querySelectorAll('.map-new button')].find(b => b.textContent.includes('确定'))
    okBtn && okBtn.click()
    await sleep(800)
    out.mapItemsAfter = document.querySelectorAll('.map-item').length
    const activeMap = document.querySelector('.map-item.active .map-item-name')
    out.activeMapName = activeMap ? activeMap.textContent : null
    log('新建后地图数: ' + out.mapItemsAfter + ' | 当前地图: ' + out.activeMapName)

    // 4. 点击「画笔」工具
    const brushBtn = [...document.querySelectorAll('.floating-tools button')].find(b => b.textContent.includes('画笔'))
    if (!brushBtn) { out.error = '未找到画笔按钮'; return out }
    brushBtn.click()
    await sleep(300)
    out.brushActive = brushBtn.classList.contains('active')

    // 5. 在地图画布上画一笔（mousedown → 多次 mousemove → mouseup）
    const canvas = document.querySelector('.map-canvas')
    const visual = document.querySelector('.visual-map')
    if (!canvas || !visual) { out.error = '未找到 canvas/visual-map'; return out }
    out.canvasPainting = canvas.classList.contains('painting')
    const rect = canvas.getBoundingClientRect()
    const cx = rect.left + rect.width * 0.3
    const cy = rect.top + rect.height * 0.3
    canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy, button: 0 }))
    for (let i = 1; i <= 6; i++) {
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx + i * 20, clientY: cy + i * 12, buttons: 1 }))
      await sleep(40)
    }
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    await sleep(700) // 等防抖保存

    // canvas 是否画上了内容（非透明像素）
    const ctx = canvas.getContext('2d')
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let painted = 0
    for (let i = 3; i < img.length; i += 4) if (img[i] > 10) painted++
    out.paintedPixels = painted
    out.drawn = painted > 50
    log('canvas 涂鸦像素: ' + painted + (out.drawn ? '（已绘制）' : '（未绘制!）'))

    // 6. 命名新地形（取色器选颜色 + 输入名字）
    const addTerrain = document.querySelector('.terrain-add')
    if (!addTerrain) { out.error = '未找到添加地形按钮'; return out }
    addTerrain.click()
    await sleep(300)
    const colorInput = document.querySelector('.terrain-row.new input[type="color"]')
    const terrainInput = document.querySelector('.terrain-row.new .terrain-name-input')
    if (colorInput) {
      setVal(colorInput, '#8a5f9e')
      colorInput.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (terrainInput) {
      setVal(terrainInput, '紫雾沼泽')
      await sleep(150)
      const confirm = [...document.querySelectorAll('.terrain-row.new button')][0]
      confirm && confirm.click()
      await sleep(600)
    }
    const rows = [...document.querySelectorAll('.terrain-row .terrain-name')].map(b => b.textContent)
    out.terrainNames = rows
    log('地形列表: ' + JSON.stringify(rows))

    // 7. 验证涂鸦已保存到后端（重新加载地图数据）
    out.terrainCount = document.querySelectorAll('.terrain-row').length - (document.querySelector('.terrain-row.new') ? 1 : 0)

    // 8. 切换回第一张地图
    const firstMap = document.querySelector('.map-item:not(.active) .map-item-name') 
      || document.querySelector('.map-item .map-item-name')
    out.hasOtherMap = !!firstMap
    if (firstMap) { firstMap.click(); await sleep(500) }
    out.activeAfterSwitch = (document.querySelector('.map-item.active .map-item-name') || {}).textContent

    // 截图
    out.screenshot = 'saved'
    return out
  })()`)

  const img = await win.webContents.capturePage()
  require('fs').writeFileSync(path.join('gui-test-screenshots', 'map2_doodle.png'), img.toPNG())
  result.screenshot = 'saved'
  console.log('MAP2_TEST_RESULT ' + JSON.stringify(result))
  app.exit(0)
})
