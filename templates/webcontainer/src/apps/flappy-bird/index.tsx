import React, { useRef, useState, useEffect, useCallback } from 'react'

type GameState = 'ready' | 'playing' | 'gameover'

interface Pipe {
  x: number
  gapY: number
  passed: boolean
}

const BIRD_SIZE = 24
const PIPE_WIDTH = 50
const PIPE_GAP = 140
const GRAVITY = 0.5
const JUMP_STRENGTH = -8
const PIPE_SPEED = 2.5
const CANVAS_WIDTH = 400
const CANVAS_HEIGHT = 500

export default function FlappyBird() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [gameState, setGameState] = useState<GameState>('ready')
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(() => {
    try {
      return parseInt(localStorage.getItem('flappy-highscore') || '0', 10)
    } catch {
      return 0
    }
  })

  const gameLoop = useRef<number>()
  const birdY = useRef(CANVAS_HEIGHT / 2)
  const birdVelocity = useRef(0)
  const pipes = useRef<Pipe[]>([])
  const frameCount = useRef(0)

  const jump = useCallback(() => {
    if (gameState === 'ready') {
      setGameState('playing')
      birdVelocity.current = JUMP_STRENGTH
    } else if (gameState === 'playing') {
      birdVelocity.current = JUMP_STRENGTH
    }
  }, [gameState])

  const reset = useCallback(() => {
    birdY.current = CANVAS_HEIGHT / 2
    birdVelocity.current = 0
    pipes.current = []
    frameCount.current = 0
    setScore(0)
    setGameState('ready')
  }, [])

  const checkCollision = useCallback((birdYPos: number, currentPipes: Pipe[]): boolean => {
    // Check ground and ceiling
    if (birdYPos + BIRD_SIZE >= CANVAS_HEIGHT || birdYPos <= 0) {
      return true
    }

    // Check pipes
    const birdX = 80
    for (const pipe of currentPipes) {
      if (
        birdX + BIRD_SIZE > pipe.x &&
        birdX < pipe.x + PIPE_WIDTH
      ) {
        if (birdYPos < pipe.gapY || birdYPos + BIRD_SIZE > pipe.gapY + PIPE_GAP) {
          return true
        }
      }
    }

    return false
  }, [])

  const updateGame = useCallback(() => {
    if (gameState !== 'playing') return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Update bird
    birdVelocity.current += GRAVITY
    birdY.current += birdVelocity.current

    // Update pipes
    frameCount.current++
    if (frameCount.current % 90 === 0) {
      const gapY = Math.random() * (CANVAS_HEIGHT - PIPE_GAP - 100) + 50
      pipes.current.push({ x: CANVAS_WIDTH, gapY, passed: false })
    }

    pipes.current = pipes.current
      .map(pipe => ({ ...pipe, x: pipe.x - PIPE_SPEED }))
      .filter(pipe => pipe.x > -PIPE_WIDTH)

    // Update score
    for (const pipe of pipes.current) {
      if (!pipe.passed && pipe.x + PIPE_WIDTH < 80) {
        pipe.passed = true
        setScore(s => {
          const newScore = s + 1
          if (newScore > highScore) {
            setHighScore(newScore)
            try {
              localStorage.setItem('flappy-highscore', newScore.toString())
            } catch {}
          }
          return newScore
        })
      }
    }

    // Check collision
    if (checkCollision(birdY.current, pipes.current)) {
      setGameState('gameover')
      return
    }

    // Render
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

    // Background
    ctx.fillStyle = 'rgba(135, 206, 235, 0.3)'
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

    // Ground
    ctx.fillStyle = 'rgba(139, 69, 19, 0.4)'
    ctx.fillRect(0, CANVAS_HEIGHT - 30, CANVAS_WIDTH, 30)

    // Pipes
    ctx.fillStyle = 'rgba(34, 139, 34, 0.8)'
    for (const pipe of pipes.current) {
      // Top pipe
      ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.gapY)
      // Bottom pipe
      ctx.fillRect(pipe.x, pipe.gapY + PIPE_GAP, PIPE_WIDTH, CANVAS_HEIGHT - pipe.gapY - PIPE_GAP)
      
      // Pipe borders
      ctx.strokeStyle = 'rgba(0, 100, 0, 0.8)'
      ctx.lineWidth = 2
      ctx.strokeRect(pipe.x, 0, PIPE_WIDTH, pipe.gapY)
      ctx.strokeRect(pipe.x, pipe.gapY + PIPE_GAP, PIPE_WIDTH, CANVAS_HEIGHT - pipe.gapY - PIPE_GAP)
    }

    // Bird
    ctx.fillStyle = 'rgba(255, 215, 0, 0.9)'
    ctx.beginPath()
    ctx.arc(80 + BIRD_SIZE/2, birdY.current + BIRD_SIZE/2, BIRD_SIZE/2, 0, Math.PI * 2)
    ctx.fill()
    
    // Bird eye
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
    ctx.beginPath()
    ctx.arc(80 + BIRD_SIZE/2 + 4, birdY.current + BIRD_SIZE/2 - 3, 3, 0, Math.PI * 2)
    ctx.fill()

    // Bird beak
    ctx.fillStyle = 'rgba(255, 140, 0, 0.9)'
    ctx.beginPath()
    ctx.moveTo(80 + BIRD_SIZE, birdY.current + BIRD_SIZE/2)
    ctx.lineTo(80 + BIRD_SIZE + 8, birdY.current + BIRD_SIZE/2 - 3)
    ctx.lineTo(80 + BIRD_SIZE + 8, birdY.current + BIRD_SIZE/2 + 3)
    ctx.closePath()
    ctx.fill()

  }, [gameState, checkCollision, highScore])

  useEffect(() => {
    if (gameState === 'playing') {
      const loop = () => {
        updateGame()
        gameLoop.current = requestAnimationFrame(loop)
      }
      gameLoop.current = requestAnimationFrame(loop)
    } else if (gameLoop.current) {
      cancelAnimationFrame(gameLoop.current)
    }

    return () => {
      if (gameLoop.current) {
        cancelAnimationFrame(gameLoop.current)
      }
    }
  }, [gameState, updateGame])

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        jump()
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [jump])

  useEffect(() => {
    // Draw initial state
    const canvas = canvasRef.current
    if (!canvas || gameState !== 'ready') return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    ctx.fillStyle = 'rgba(135, 206, 235, 0.3)'
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    ctx.fillStyle = 'rgba(139, 69, 19, 0.4)'
    ctx.fillRect(0, CANVAS_HEIGHT - 30, CANVAS_WIDTH, 30)

    // Draw bird
    ctx.fillStyle = 'rgba(255, 215, 0, 0.9)'
    ctx.beginPath()
    ctx.arc(80 + BIRD_SIZE/2, birdY.current + BIRD_SIZE/2, BIRD_SIZE/2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
    ctx.beginPath()
    ctx.arc(80 + BIRD_SIZE/2 + 4, birdY.current + BIRD_SIZE/2 - 3, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255, 140, 0, 0.9)'
    ctx.beginPath()
    ctx.moveTo(80 + BIRD_SIZE, birdY.current + BIRD_SIZE/2)
    ctx.lineTo(80 + BIRD_SIZE + 8, birdY.current + BIRD_SIZE/2 - 3)
    ctx.lineTo(80 + BIRD_SIZE + 8, birdY.current + BIRD_SIZE/2 + 3)
    ctx.closePath()
    ctx.fill()
  }, [gameState])

  return (
    <div className="h-full overflow-auto flex flex-col items-center justify-center p-4" style={{ background: 'rgba(12,18,36,0.02)', color: '#e5e7eb' }}>
      <div className="text-center mb-4">
        <h1 className="text-xl font-semibold mb-2">Flappy Bird</h1>
        <div className="flex gap-6 justify-center text-sm">
          <div>
            <span style={{ color: '#cbd5e1' }}>Score: </span>
            <span className="font-semibold">{score}</span>
          </div>
          <div>
            <span style={{ color: '#cbd5e1' }}>High Score: </span>
            <span className="font-semibold">{highScore}</span>
          </div>
        </div>
      </div>

      <div className="relative">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onClick={jump}
          className="rounded-lg cursor-pointer"
          style={{
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.05)'
          }}
        />

        {gameState === 'ready' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
            style={{ background: 'rgba(12,18,36,0.6)' }}
          >
            <div className="text-center px-4">
              <p className="text-lg mb-2" style={{ color: '#e5e7eb' }}>Click or press Space to start</p>
              <p className="text-sm" style={{ color: '#cbd5e1' }}>Tap to keep the bird flying</p>
            </div>
          </div>
        )}

        {gameState === 'gameover' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center"
            style={{ background: 'rgba(12,18,36,0.8)' }}
          >
            <div className="text-center px-4">
              <p className="text-2xl font-bold mb-2" style={{ color: '#e5e7eb' }}>Game Over!</p>
              <p className="text-lg mb-4" style={{ color: '#cbd5e1' }}>Score: {score}</p>
              <button
                onClick={reset}
                className="px-6 py-2 text-sm font-medium rounded transition-all"
                style={{
                  background: 'rgba(56,189,248,0.4)',
                  border: '1px solid rgba(56,189,248,0.5)',
                  color: '#e5e7eb'
                }}
              >
                Play Again
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 text-xs text-center" style={{ color: '#cbd5e1' }}>
        Click canvas or press Space to jump
      </div>
    </div>
  )
}

