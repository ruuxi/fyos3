import React, { useState, useRef } from 'react'
import { imageEdit } from '../../ai'

export default function PhotoLab() {
  const [originalImage, setOriginalImage] = useState<string | null>(null)
  const [editedImage, setEditedImage] = useState<string | null>(null)
  const [instruction, setInstruction] = useState('')
  const [intensity, setIntensity] = useState(0.8)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      setOriginalImage(e.target?.result as string)
      setEditedImage(null)
    }
    reader.readAsDataURL(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFileSelect(file)
  }

  const applyEdit = async () => {
    if (!originalImage || !instruction.trim()) {
      alert('Please upload an image and provide editing instructions')
      return
    }

    setIsProcessing(true)
    try {
      // Convert base64 to File object
      const response = await fetch(originalImage)
      const blob = await response.blob()
      const file = new File([blob], 'image.png', { type: blob.type })

      const result = await imageEdit(file, instruction, {
        strength: intensity,
        num_images: 1,
        image_size: 'square_hd'
      }) as { images: Array<{ url: string }> }

      if (result?.images?.[0]?.url) {
        setEditedImage(result.images[0].url)
      }
    } catch (error) {
      console.error('Edit failed:', error)
      alert('Failed to edit image. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  const downloadImage = () => {
    if (!editedImage) return
    const a = document.createElement('a')
    a.href = editedImage
    a.download = 'edited-photo.png'
    a.click()
  }

  const reset = () => {
    setOriginalImage(null)
    setEditedImage(null)
    setInstruction('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const examples = [
    'make the sky more dramatic',
    'remove the person in the background',
    'change this to autumn colors',
    'make it look vintage',
    'add sunset lighting',
    'make it black and white'
  ]

  return (
    <div className="h-full overflow-auto" style={{ background: 'rgba(12,18,36,0.02)', color: '#e5e7eb' }}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-semibold">Photo Lab</h1>
          <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(56,189,248,0.2)', border: '1px solid rgba(56,189,248,0.4)' }}>AI</span>
        </div>

        {/* Upload Area */}
        {!originalImage ? (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className="mb-4 p-12 rounded-lg cursor-pointer transition-all text-center"
            style={{
              background: isDragging ? 'rgba(56,189,248,0.15)' : 'rgba(255,255,255,0.08)',
              backdropFilter: 'blur(18px)',
              border: `2px dashed ${isDragging ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.2)'}`,
            }}
          >
            <div className="text-4xl mb-3">📸</div>
            <p className="text-sm mb-1" style={{ color: '#e5e7eb' }}>Drop an image here or click to upload</p>
            <p className="text-xs" style={{ color: '#cbd5e1' }}>Supports JPG, PNG, WebP</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileInput}
              className="hidden"
            />
          </div>
        ) : (
          <>
            {/* Controls */}
            <div className="mb-4 p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <div className="mb-3">
                <label className="text-xs mb-1 block" style={{ color: '#cbd5e1' }}>Editing Instructions</label>
                <input
                  type="text"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Describe what you want to change..."
                  className="w-full px-3 py-2 text-sm rounded"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: '#e5e7eb'
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && !isProcessing && applyEdit()}
                />
              </div>

              <div className="mb-3">
                <label className="text-xs mb-1 block" style={{ color: '#cbd5e1' }}>Quick Examples</label>
                <div className="flex flex-wrap gap-2">
                  {examples.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => setInstruction(ex)}
                      className="text-xs px-2 py-1 rounded transition-colors"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        color: '#cbd5e1'
                      }}
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-3">
                <label className="text-xs mb-1 block" style={{ color: '#cbd5e1' }}>Effect Strength: {Math.round(intensity * 100)}%</label>
                <input
                  type="range"
                  min="0.3"
                  max="1"
                  step="0.1"
                  value={intensity}
                  onChange={(e) => setIntensity(Number(e.target.value))}
                  className="w-full"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={applyEdit}
                  disabled={isProcessing || !instruction.trim()}
                  className="flex-1 px-4 py-2 text-sm font-medium rounded transition-all"
                  style={{
                    background: isProcessing || !instruction.trim() ? 'rgba(56,189,248,0.2)' : 'rgba(56,189,248,0.4)',
                    border: '1px solid rgba(56,189,248,0.5)',
                    color: '#e5e7eb',
                    cursor: isProcessing || !instruction.trim() ? 'not-allowed' : 'pointer',
                    opacity: !instruction.trim() ? 0.5 : 1
                  }}
                >
                  {isProcessing ? '⚡ Processing...' : '⚡ Apply Edit'}
                </button>
                <button
                  onClick={reset}
                  className="px-4 py-2 text-sm rounded transition-colors"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: '#e5e7eb'
                  }}
                >
                  New Image
                </button>
              </div>
            </div>

            {/* Before/After Comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Original */}
              <div>
                <p className="text-xs mb-2" style={{ color: '#cbd5e1' }}>Original</p>
                <div
                  className="w-full rounded-lg overflow-hidden"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    minHeight: '300px'
                  }}
                >
                  <img
                    src={originalImage}
                    alt="Original"
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>

              {/* Edited */}
              <div>
                <p className="text-xs mb-2" style={{ color: '#cbd5e1' }}>Edited</p>
                <div
                  className="w-full rounded-lg flex items-center justify-center overflow-hidden"
                  style={{
                    background: editedImage ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    minHeight: '300px'
                  }}
                >
                  {editedImage ? (
                    <div className="relative w-full h-full">
                      <img
                        src={editedImage}
                        alt="Edited"
                        className="w-full h-full object-contain"
                      />
                      <button
                        onClick={downloadImage}
                        className="absolute bottom-3 right-3 px-3 py-1.5 text-sm rounded transition-all"
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
                    <p className="text-sm text-center px-4" style={{ color: '#cbd5e1' }}>
                      {isProcessing ? 'AI is processing your image...' : 'Enter instructions and click "Apply Edit"'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

