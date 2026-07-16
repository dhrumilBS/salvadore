class DotsCanvas {
    constructor({
        canvas,
        wrapper,
        contentSelectors = [],
        showBackgroundDots = true,
        shimmer = true,
        shimmerAmount = 1,
        lerpOpacityScale = 1,
        colors = {
            grey: '#E5E7EB',
            green: '#22C55E',
        },
    }) {
        this.canvas = canvas
        this.ctx = canvas.getContext('2d')
        this.wrapper = wrapper
        this.contentSelectors = contentSelectors
        this.showBackgroundDots = showBackgroundDots
        this.shimmer = shimmer
        this.shimmerAmount = shimmerAmount
        this.lerpOpacityScale = lerpOpacityScale
        this.colors = colors

        this.dots = []
        this.mouse = { x: 0, y: 0 }
        this.mousePrev = { x: 0, y: 0 }
        this.dotDiameter = 4
        this.dotRadius = this.dotDiameter / 2
        this.shimmerThreshold = 0.0004 * shimmerAmount
        this.isInView = false
        this.raf = null

        this.resize()
        this.setupDots()
        this.bindEvents()
        this.observe()
        this.render()
    }

    /* -------------------------
       Utilities
    -------------------------- */
    lerp(a, b, n) {
        return a + (b - a) * n
    }

    hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16)
        const g = parseInt(hex.slice(3, 5), 16)
        const b = parseInt(hex.slice(5, 7), 16)
        return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }

    /* -------------------------
       Setup
    -------------------------- */
    resize() {
        const dpr = window.devicePixelRatio || 1
        const rect = this.wrapper.getBoundingClientRect()


        this.canvas.width = rect.width * dpr
        this.canvas.height = rect.height * dpr
        this.canvas.style.width = '520px'
        this.canvas.style.height = `500px`

        this.ctx.scale(dpr, dpr)
        this.canvasRect = rect
    }

    setupDots() {
        const dotGap = 26
        const rect = this.canvasRect
        const numRows = Math.floor(
            (rect.height - this.dotDiameter) / (this.dotDiameter + dotGap)
        )
        const numCols = Math.floor(
            (rect.width - this.dotDiameter) / (this.dotDiameter + dotGap)
        )

        const contentRects = this.contentSelectors.map(sel => {
            const el = document.querySelector(sel)
            if (!el) return null
            const r = el.getBoundingClientRect()
            return {
                xStart: r.left - rect.left - dotGap,
                xEnd: r.right - rect.left + dotGap,
                yStart: r.top - rect.top - dotGap,
                yEnd: r.bottom - rect.top + dotGap,
            }
        }).filter(Boolean)

        this.dots = []

        for (let r = 0; r < numRows; r++) {
            for (let c = 0; c < numCols; c++) {
                const x = (c / (numCols - 1)) * rect.width
                const y = (r / (numRows - 1)) * rect.height

                let show = true
                contentRects.forEach(cr => {
                    if (x >= cr.xStart && x <= cr.xEnd && y >= cr.yStart && y <= cr.yEnd) {
                        show = false
                    }
                })

                this.dots.push({
                    x,
                    y,
                    opacityCurrent: 0,
                    opacityTarget: 0,
                    show,
                })
            }
        }
    }

    /* -------------------------
       Events
    -------------------------- */
    bindEvents() {
        window.addEventListener('resize', () => {
            this.resize()
            this.setupDots()
        })

        window.addEventListener('mousemove', e => {
            this.mouse.x = e.clientX
            this.mouse.y = e.clientY
        })
    }

    observe() {
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                this.isInView = entry.isIntersecting
            })
        })
        observer.observe(this.wrapper)
    }

    /* -------------------------
       Render
    -------------------------- */
    draw() {
        if (!this.isInView) return

        const ctx = this.ctx
        const rect = this.canvasRect
        const lerpSpeed = 0.07

        const lx = this.lerp(this.mousePrev.x, this.mouse.x, lerpSpeed)
        const ly = this.lerp(this.mousePrev.y, this.mouse.y, lerpSpeed)

        const mouseRel = {
            x: lx - rect.left,
            y: ly - rect.top,
        }

        const proximity = Math.min(0.04 * window.innerWidth, 80)

        ctx.clearRect(0, 0, rect.width, rect.height)

        this.dots.forEach(dot => {
            const dx = dot.x - mouseRel.x
            const dy = dot.y - mouseRel.y
            const dist = Math.sqrt(dx * dx + dy * dy)

            if (
                this.shimmer &&
                dot.opacityCurrent <= 0.0001 &&
                Math.random() < this.shimmerThreshold
            ) {
                dot.opacityTarget = 1
            }

            if (dot.opacityCurrent >= 0.999) {
                dot.opacityTarget = 0
            }

            if (dist < proximity) {
                dot.opacityTarget = 1
            }

            dot.opacityCurrent = this.lerp(
                dot.opacityCurrent,
                dot.opacityTarget,
                lerpSpeed * 2 * this.lerpOpacityScale
            )

            if (this.showBackgroundDots) {
                ctx.fillStyle = this.colors.grey
                ctx.beginPath()
                ctx.arc(dot.x, dot.y, this.dotRadius, 0, Math.PI * 2)
                ctx.fill()
            }

            ctx.fillStyle = this.hexToRgba(
                this.colors.green,
                dot.show ? dot.opacityCurrent : 0
            )
            ctx.beginPath()
            ctx.arc(dot.x, dot.y, this.dotRadius, 0, Math.PI * 2)
            ctx.fill()
        })

        this.mousePrev = { x: lx, y: ly }
    }

    render() {
        this.draw()
        this.raf = requestAnimationFrame(this.render.bind(this))
    }

    destroy() {
        cancelAnimationFrame(this.raf)
    }
}

class DotTrail {
    constructor(canvas) {
        this.canvas = canvas
        this.ctx = canvas.getContext('2d')

        this.dots = []
        this.dotGap = 50
        this.radius = 5
        this.mouse = { x: -9999, y: -9999 }
        this.mousePrev = { x: -9999, y: -9999 }
        this.lastMove = Date.now()

        this.resize()
        this.createDots()
        this.bindEvents()
        this.animate()
    }

    resize() {
        const dpr = window.devicePixelRatio || 1
        this.canvas.width = innerWidth * dpr
        this.canvas.height = innerHeight * dpr
        this.canvas.style.width = innerWidth + 'px'
        this.canvas.style.height = innerHeight + 'px'
        this.ctx.scale(dpr, dpr)
    }

    createDots() {
        this.dots = []
        for (let y = 0; y < innerHeight; y += this.dotGap) {
            for (let x = 0; x < innerWidth; x += this.dotGap) {
                this.dots.push({
                    x,
                    y,
                    opacity: 0,
                    target: 0,
                    shimmerLife: 0,
                })

            }
        }
    }

    bindEvents() {
        window.addEventListener('mousemove', e => {
            this.mouse.x = e.clientX
            this.mouse.y = e.clientY
            this.lastMove = Date.now()
        })

        window.addEventListener('resize', () => {
            this.resize()
            this.createDots()
        })
    }

    lerp(a, b, n) {
        return a + (b - a) * n
    }

    animate() {
        this.ctx.clearRect(0, 0, innerWidth, innerHeight)

        const mx = this.lerp(this.mousePrev.x, this.mouse.x, 0.08)
        const my = this.lerp(this.mousePrev.y, this.mouse.y, 0.12)

        const idle = Date.now() - this.lastMove > 120
        const trailRadius = 90

        this.dots.forEach(dot => {
            const dx = dot.x - mx
            const dy = dot.y - my
            const dist = Math.sqrt(dx * dx + dy * dy)

            /* 🟢 Mouse trail */
            if (dist < trailRadius) {
                dot.target = 1 - dist / trailRadius
            }

            if (idle && dot.shimmerLife <= 0 && Math.random() < 0.01) {
                dot.shimmerLife = 1
            }

            if (dot.shimmerLife > 0) {
                dot.target = dot.shimmerLife
                dot.shimmerLife -= 0.04
            }

            dot.opacity = this.lerp(dot.opacity, dot.target, 0.08)

            if (dot.opacity > 0.01) {
                this.ctx.fillStyle = `rgba(34,197,94,${dot.opacity})`
                this.ctx.beginPath()
                this.ctx.arc(dot.x, dot.y, this.radius, 0, Math.PI * 2)
                this.ctx.fill()
            }
        })

        this.mousePrev.x = mx
        this.mousePrev.y = my

        requestAnimationFrame(this.animate.bind(this))
    }
}
