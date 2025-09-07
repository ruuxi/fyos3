import React from 'react'

export default function App(){
  return (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 bg-white/70 backdrop-blur border-b px-3 py-2">
        <div className="font-semibold">🐕 Doggy Bird</div>
      </div>
      <div className="p-3 space-y-3">
        <p className="text-gray-600 text-sm">This is the Doggy Bird app. Build your UI here. The container fills the window and scrolls as needed.</p>
        <div className="text-center py-8">
          <div className="text-6xl mb-4">🐕🐦</div>
          <div className="text-lg font-medium text-gray-800">Doggy Bird</div>
          <div className="text-sm text-gray-500">A placeholder app</div>
        </div>
      </div>
    </div>
  )
}
