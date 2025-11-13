import React, { useRef, useState, useEffect } from 'react'
import { imageEdit, uploadFileToPublicUrl } from '../../ai'

type Tool = 'pen' | 'eraser'
type Style = 'realistic' | 'cartoon' | 'anime' | 'digital-art' | 'watercolor'

export default function SketchStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#000000')
  const [brushSize, setBrushSize] = useState(3)
  const [style, setStyle] = useState<Style>('realistic')
  const [enhancedImage, setEnhancedImage] = useState<string | null>(null)
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [description, setDescription] = useState('')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    // Set white background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }, [])

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDrawing(true)
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top) * scaleY
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top) * scaleY
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color
    ctx.lineWidth = brushSize
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const stopDrawing = () => {
    setIsDrawing(false)
  }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setEnhancedImage(null)
  }

  const enhanceWithAI = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    setIsEnhancing(true)
    try {
      // Downscale and compress canvas to reduce payload (max side 512px, JPEG 0.85)
      const blob = await new Promise<Blob>((resolve, reject) => {
        try {
          const MAX_SIDE = 512
          const srcW = canvas.width
          const srcH = canvas.height
          const scale = Math.min(1, MAX_SIDE / Math.max(srcW, srcH))
          const dstW = Math.max(1, Math.round(srcW * scale))
          const dstH = Math.max(1, Math.round(srcH * scale))
          const off = document.createElement('canvas')
          off.width = dstW
          off.height = dstH
          const ctx = off.getContext('2d')
          if (!ctx) {
            reject(new Error('Failed to get 2d context'))
            return
          }
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(canvas, 0, 0, srcW, srcH, 0, 0, dstW, dstH)
          off.toBlob((b) => {
            if (b) resolve(b)
            else reject(new Error('Failed to convert scaled canvas to blob'))
          }, 'image/jpeg', 0.85)
        } catch (err) {
          reject(err as Error)
        }
      })
      const file = new File([blob], 'sketch.jpg', { type: 'image/jpeg' })
      
      console.log('Uploading sketch...', { size: file.size, type: file.type })
      
      // Upload file to get public URL (with better error handling)
      let publicUrl: string
      try {
        publicUrl = await uploadFileToPublicUrl(file)
        console.log('Upload successful:', publicUrl)
      } catch (uploadError) {
        console.error('Upload failed:', uploadError)
        throw new Error(`Failed to upload sketch: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`)
      }
      
      // Generate prompt based on description and style
      const stylePrompts: Record<Style, string> = {
        realistic: 'photorealistic, detailed, high quality',
        cartoon: 'cartoon style, vibrant colors, clean lines',
        anime: 'anime art style, beautiful illustration',
        'digital-art': 'digital art, professional, artistic',
        watercolor: 'watercolor painting, soft colors, artistic'
      }
      
      const instruction = description 
        ? `transform into ${description}, ${stylePrompts[style]}`
        : `transform this sketch into ${stylePrompts[style]}`
      
      console.log('Calling AI with instruction:', instruction)
      
      const result = await imageEdit(publicUrl, instruction, { 
        num_images: 1,
        image_size: 'square_hd',
        strength: 0.85
      }) as { images: Array<{ url: string }> }
      
      if (result?.images?.[0]?.url) {
        setEnhancedImage(result.images[0].url)
      } else {
        throw new Error('No image returned from AI')
      }
    } catch (error) {
      console.error('Enhancement failed:', error)
      const errorMsg = error instanceof Error ? error.message : 'Unknown error occurred'
      alert(`Failed to enhance sketch: ${errorMsg}`)
    } finally {
      setIsEnhancing(false)
    }
  }

  const downloadImage = () => {
    if (!enhancedImage) return
    const a = document.createElement('a')
    a.href = enhancedImage
    a.download = 'enhanced-sketch.png'
    a.click()
  }

  return (
    <div className="h-full overflow-auto" style={{ background: 'rgba(12,18,36,0.02)', color: '#e5e7eb' }}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold">Sketch Studio</h1>
          <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(56,189,248,0.2)', border: '1px solid rgba(56,189,248,0.4)' }}>AI</span>
        </div>

        {/* Tools */}
        <div className="mb-4 p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,0.12)' }}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs mb-1 block" style={{ color: '#cbd5e1' }}>Tool</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setTool('pen')}
                  className="px-3 py-1.5 text-sm rounded transition-colors"
                  style={{
                    background: tool === 'pen' ? 'rgba(56,189,248,0.3)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${tool === 'pen' ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.1)'}`,
                    color: '#e5e7eb'
                  }}
                >
                  ✏️ Pen
                </button>
                <button
                  onClick={() => setTool('eraser')}
                  className="px-3 py-1.5 text-sm rounded transition-colors"
                  style={{
                    background: tool === 'eraser' ? 'rgba(56,189,248,0.3)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${tool === 'eraser' ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.1)'}`,
                    color: '#e5e7eb'
                  }}
                >
                  🧹 Eraser
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs mb-1 block" style={{ color: '#cbd5e1' }}>Color</label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-full h-9 rounded cursor-pointer"
                style={{ border: '1px solid rgba(255,255,255,0.12)' }}
              />
            </div>

            <div>
              <label className="text-xs mb-1 block" style={{ color: '#cbd5e1' }}>Brush Size: {brushSize}px</label>
              <input
                type="range"
                min="1"
                max="20"
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <label className="text-xs mb-1 block" style={{ color: '#cbd5e1' }}>AI Style</label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value as Style)}
                className="w-full px-2 py-1.5 text-sm rounded"
                style={{
                  background: 'rgba(12,18,36,0.9)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: '#e5e7eb'
                }}
              >
                <option value="realistic" style={{ background: '#1a1f36', color: '#e5e7eb' }}>Realistic</option>
                <option value="cartoon" style={{ background: '#1a1f36', color: '#e5e7eb' }}>Cartoon</option>
                <option value="anime" style={{ background: '#1a1f36', color: '#e5e7eb' }}>Anime</option>
                <option value="digital-art" style={{ background: '#1a1f36', color: '#e5e7eb' }}>Digital Art</option>
                <option value="watercolor" style={{ background: '#1a1f36', color: '#e5e7eb' }}>Watercolor</option>
              </select>
            </div>
          </div>

          <div className="mt-3">
            <label className="text-xs mb-1 block" style={{ color: '#cbd5e1' }}>Describe your sketch (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., a cat sitting on a chair"
              className="w-full px-3 py-2 text-sm rounded"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#e5e7eb'
              }}
            />
          </div>

          <div className="mt-3 flex gap-2">
            <button
              onClick={enhanceWithAI}
              disabled={isEnhancing}
              className="flex-1 px-4 py-2 text-sm font-medium rounded transition-all"
              style={{
                background: isEnhancing ? 'rgba(56,189,248,0.2)' : 'rgba(56,189,248,0.4)',
                border: '1px solid rgba(56,189,248,0.5)',
                color: '#e5e7eb',
                cursor: isEnhancing ? 'wait' : 'pointer'
              }}
            >
              {isEnhancing ? '✨ Enhancing...' : '✨ Enhance with AI'}
            </button>
            <button
              onClick={clearCanvas}
              className="px-4 py-2 text-sm rounded transition-colors"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#e5e7eb'
              }}
            >
              Clear
            </button>
          </div>
        </div>

        {/* Canvas and Result */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Drawing Canvas */}
          <div>
            <p className="text-xs mb-2" style={{ color: '#cbd5e1' }}>Your Sketch</p>
            <canvas
              ref={canvasRef}
              width={400}
              height={400}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              className="w-full rounded-lg cursor-crosshair"
              style={{
                background: '#ffffff',
                border: '1px solid rgba(255,255,255,0.12)',
                touchAction: 'none'
              }}
            />
          </div>

          {/* Enhanced Result */}
          <div>
            <p className="text-xs mb-2" style={{ color: '#cbd5e1' }}>AI Enhanced</p>
            <div
              className="w-full rounded-lg flex items-center justify-center"
              style={{
                height: '400px',
                background: enhancedImage ? 'transparent' : 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)'
              }}
            >
              {enhancedImage ? (
                <div className="relative w-full h-full">
                  <img
                    src={enhancedImage}
                    alt="Enhanced"
                    className="w-full h-full object-contain rounded-lg"
                  />
                  <button
                    onClick={downloadImage}
                    className="absolute bottom-2 right-2 px-3 py-1.5 text-sm rounded transition-all"
                    style={{
                      background: 'rgba(56,189,248,0.9)',
                      border: '1px solid rgba(56,189,248,1)',
                      color: '#ffffff'
                    }}
                  >
                    ⬇️ Download
                  </button>
                </div>
              ) : (
                <p className="text-sm" style={{ color: '#cbd5e1' }}>
                  Draw something and click "Enhance with AI"
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

