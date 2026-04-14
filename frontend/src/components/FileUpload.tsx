import { useCallback, useState } from 'react'
import { uploadFile } from '../api/client'
import type { UploadResponse } from '../types'
import editianLogo from '../../../assets/editian_icon.svg'

interface Props {
  onUpload: (response: UploadResponse) => void
}

export default function FileUpload({ onUpload }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'docx' && ext !== 'pptx') {
      setError('Only .docx and .pptx files are supported.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await uploadFile(file)
      onUpload(response)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Upload failed.')
    } finally {
      setLoading(false)
    }
  }, [onUpload])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => document.getElementById('file-input')?.click()}
        className={`w-96 h-56 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors select-none
          ${isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-gray-50'
          }`}
      >
        <input
          id="file-input"
          type="file"
          accept=".docx,.pptx"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        {loading ? (
          <div className="text-gray-500 text-sm">Processing document…</div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-2 mb-1">
              <img
                src={editianLogo}
                alt="Editian logo"
                className="h-12 w-12 select-none"
                draggable={false}
              />
              <div className="text-xl font-semibold text-gray-700">Editian</div>
            </div>
            <div className="text-center">
              <div className="font-medium text-gray-700">Drop your file here</div>
              <div className="text-sm text-gray-400 mt-1">or click to browse</div>
            </div>
            <div className="text-xs text-gray-400">.docx · .pptx</div>
          </>
        )}
      </div>
      {error && (
        <div className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          {error}
        </div>
      )}
    </div>
  )
}
