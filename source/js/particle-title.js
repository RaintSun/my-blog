(() => {
  'use strict'
  const COUNT = 10000
  const palettes = [
    { name: '冰蓝', colors: ['#ffffff', '#d4f7ff', '#8feaff', '#59c9ff'] },
    { name: '紫霞', colors: ['#fff4ff', '#efcbff', '#d0a6ff', '#ffa9da'] },
    { name: '日落', colors: ['#fff9e8', '#ffe3a0', '#ffbd8a', '#ff9cae'] },
    { name: '薄荷', colors: ['#f4fff8', '#c6ffe6', '#86efd1', '#a7e7ff'] },
    { name: '星月', colors: ['#ffffff', '#f2f5ff', '#d6dff5', '#bfcee9'] }
  ]
  let dispose = () => {}

  async function init() {
    dispose()
    const title = document.querySelector('#page-header.full_page #site-title')
    if (!title) return
    const wrapper = document.createElement('div')
    wrapper.className = 'particle-title'
    wrapper.innerHTML = '<div class="particle-title-stage"><canvas aria-hidden="true"></canvas></div><div class="particle-title-controls"><div class="particle-title-palettes" role="group" aria-label="标题配色"></div><button class="particle-title-burst" type="button">✦ 炸开粒子</button></div><p class="particle-title-hint">移动鼠标或轻触文字 · 看星点散开，再归来</p>'
    title.after(wrapper)
    const canvas = wrapper.querySelector('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) { wrapper.remove(); return }
    const mask = document.createElement('canvas')
    const maskCtx = mask.getContext('2d', { willReadFrequently: true })
    if (!maskCtx) { wrapper.remove(); return }
    const group = wrapper.querySelector('.particle-title-palettes')
    const burst = wrapper.querySelector('.particle-title-burst')
    const hint = wrapper.querySelector('.particle-title-hint')
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const events = new AbortController()
    const on = (element, event, fn) => element.addEventListener(event, fn, { signal: events.signal })
    let particles = [], width = 0, height = 0, frame = 0, last = 0, pixelRatio = 0
    let visible = true, alive = true, selected = 0, burstUntil = 0
    let pointer = null
    try { selected = Math.max(0, palettes.findIndex(p => p.name === localStorage.getItem('blog-title-palette'))) } catch (_) {}
    const buttons = palettes.map((palette, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.innerHTML = `<span class="particle-title-swatch" style="--swatch:${palette.colors[2]}" aria-hidden="true"></span>${palette.name}`
      button.setAttribute('aria-label', `${palette.name}配色`)
      button.setAttribute('aria-pressed', String(index === selected))
      on(button, 'click', () => {
        selected = index
        buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)))
        try { localStorage.setItem('blog-title-palette', palette.name) } catch (_) {}
        draw()
      })
      group.append(button)
      return button
    })

    function draw() {
      ctx.clearRect(0, 0, width, height)
      const colors = palettes[selected].colors
      for (let color = 0; color < colors.length; color++) {
        ctx.fillStyle = colors[color]
        ctx.beginPath()
        for (let i = color; i < particles.length; i += colors.length) {
          const p = particles[i]
          ctx.rect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
        }
        ctx.fill()
      }
    }

    function wake() {
      if (!frame && alive && visible && !document.hidden && !motion.matches) {
        last = 0
        frame = requestAnimationFrame(tick)
      }
    }

    function tick(time) {
      frame = 0
      if (!alive || !visible || document.hidden || motion.matches) return
      const dt = last ? Math.min((time - last) / 16.667, 2) : 1
      last = time
      let energy = 0
      const spring = time < burstUntil ? .002 : .012
      const damping = Math.pow(.88, dt)
      for (const p of particles) {
        let ax = (p.tx - p.x) * spring, ay = (p.ty - p.y) * spring
        if (pointer) {
          const dx = p.x - pointer.x, dy = p.y - pointer.y
          const distance = Math.hypot(dx, dy)
          const radius = width < 600 ? 58 : 90
          if (distance < radius) {
            const force = (1 - distance / radius) * 2.2
            ax += (distance > .01 ? dx / distance : 1) * force
            ay += (distance > .01 ? dy / distance : 0) * force
          }
        }
        p.vx = (p.vx + ax * dt) * damping
        p.vy = (p.vy + ay * dt) * damping
        p.x += p.vx * dt
        p.y += p.vy * dt
        energy += Math.abs(p.x - p.tx) + Math.abs(p.y - p.ty) + Math.abs(p.vx) + Math.abs(p.vy)
      }
      draw()
      if (energy / COUNT > .04) frame = requestAnimationFrame(tick)
      else { particles.forEach(p => { p.x = p.tx; p.y = p.ty; p.vx = p.vy = 0 }); draw() }
    }

    function resize() {
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const dpr = Math.min(devicePixelRatio || 1, 2)
      if (width === Math.round(rect.width) && height === Math.round(rect.height) && pixelRatio === dpr && particles.length) return
      width = Math.round(rect.width); height = Math.round(rect.height); pixelRatio = dpr
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      mask.width = width; mask.height = height
      let fontSize = Math.min(64, width * .085)
      const font = size => `700 ${size}px "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif`
      maskCtx.font = font(fontSize)
      const text = title.textContent.trim()
      fontSize *= Math.min(1, width * .91 / maskCtx.measureText(text).width)
      maskCtx.font = font(fontSize)
      maskCtx.textAlign = 'center'; maskCtx.textBaseline = 'middle'
      maskCtx.fillText(text, width / 2, height / 2)
      const pixels = maskCtx.getImageData(0, 0, width, height).data
      const targets = []
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (pixels[(y * width + x) * 4 + 3] > 140) targets.push({ x, y })
        }
      }
      if (!targets.length) return
      const size = Math.max(.65, Math.min(1.55, Math.sqrt(targets.length / COUNT) * .92))
      particles = Array.from({ length: COUNT }, (_, i) => {
        const target = targets[Math.floor(i * targets.length / COUNT)]
        const tx = target.x + (Math.random() - .5) * .65
        const ty = target.y + (Math.random() - .5) * .65
        return { x: tx, y: ty, tx, ty, vx: 0, vy: 0, size }
      })
      canvas.dataset.particleCount = String(particles.length)
      title.classList.add('particle-title-accessible')
      pointer = null
      draw()
    }

    function move(event) {
      const rect = canvas.getBoundingClientRect()
      pointer = { x: (event.clientX - rect.left) * width / rect.width, y: (event.clientY - rect.top) * height / rect.height }
      wake()
    }
    on(canvas, 'pointermove', move)
    on(canvas, 'pointerdown', move)
    on(canvas, 'pointerleave', () => { pointer = null; wake() })
    on(canvas, 'pointercancel', () => { pointer = null; wake() })
    on(canvas, 'pointerup', event => { if (event.pointerType !== 'mouse') { pointer = null; wake() } })
    on(burst, 'click', () => {
      if (motion.matches) return
      pointer = null
      for (const p of particles) {
        const angle = Math.atan2(p.y - height / 2, p.x - width / 2) + (Math.random() - .5) * 1.8
        const speed = 9 + Math.random() * 18
        p.vx = Math.cos(angle) * speed; p.vy = Math.sin(angle) * speed
      }
      burstUntil = performance.now() + 650
      wake()
    })
    function motionChanged() {
      burst.disabled = motion.matches
      hint.textContent = motion.matches ? '已跟随系统减少动态效果 · 仍可切换配色' : '移动鼠标或轻触文字 · 看星点散开，再归来'
      if (motion.matches) {
        cancelAnimationFrame(frame); frame = 0
        particles.forEach(p => { p.x = p.tx; p.y = p.ty; p.vx = p.vy = 0 })
        draw()
      } else wake()
    }
    on(motion, 'change', motionChanged)
    on(document, 'visibilitychange', () => {
      if (document.hidden) { cancelAnimationFrame(frame); frame = 0; pointer = null }
      else wake()
    })
    const observer = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting
      if (visible) wake()
      else { cancelAnimationFrame(frame); frame = 0; pointer = null }
    })
    observer.observe(canvas)
    const resizer = new ResizeObserver(resize)
    dispose = () => {
      alive = false
      cancelAnimationFrame(frame)
      events.abort(); observer.disconnect(); resizer.disconnect()
      wrapper.remove(); title.classList.remove('particle-title-accessible')
    }
    // Only wait for the title font; unrelated CDN icon fonts must not delay it.
    try { await document.fonts.load('700 64px "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif', title.textContent) } catch (_) {}
    if (!alive) return
    resize(); motionChanged(); resizer.observe(canvas)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true })
  else init()
  document.addEventListener('pjax:complete', init)
})()
