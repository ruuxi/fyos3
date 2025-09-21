import React, { useState } from 'react';
import './styles.css';

interface Idea {
  id: string;
  text: string;
  createdAt: Date;
}

export function IdeasApp() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [newIdea, setNewIdea] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newIdea.trim() === '') return;
    
    const idea: Idea = {
      id: Date.now().toString(),
      text: newIdea.trim(),
      createdAt: new Date(),
    };
    
    setIdeas([idea, ...ideas]);
    setNewIdea('');
  };

  const handleDelete = (id: string) => {
    setIdeas(ideas.filter(idea => idea.id !== id));
  };

  return (
    <div className="h-full overflow-auto flex flex-col bg-gradient-to-br from-purple-50 to-pink-50">
      <header className="bg-gradient-to-r from-purple-600 to-pink-500 text-white p-4 rounded-t-lg shadow-lg">
        <h1 className="text-2xl font-bold"> 💡 Ideas App</h1>
        <p className="text-purple-100">Capture and organize your brilliant ideas</p>
      </header>

      <main className="flex-1 p-4 md:p-6 overflow-auto">
        <form onSubmit={handleSubmit} className="mb-6 bg-white rounded-xl shadow-md p-4 border border-purple-200">
          <div className="flex flex-col space-y-3">
            <textarea
              value={newIdea}
              onChange={(e) => setNewIdea(e.target.value)}
              placeholder="What's your brilliant idea?"
              className="w-full p-3 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 min-h-[100px]"
            />
            <button 
              type="submit"
              className="self-end bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 text-white font-semibold px-4 py-2 rounded-lg transition-all duration-200 shadow-md"
            >
              Add Idea
            </button>
          </div>
        </form>

        <div className="space-y-4">
          {ideas.length === 0 ? (
            <div className="text-center py-10 text-purple-400">
              <p>No ideas yet. Add your first idea above!</p>
            </div>
          ) : (
            ideas.map((idea) => (
              <div 
                key={idea.id} 
                className="bg-white rounded-xl shadow-md p-4 border border-purple-200 app-fade-in"
              >
                <div className="flex justify-between items-start">
                  <p className="text-gray-800 flex-1 pr-2">{idea.text}</p>
                  <button 
                    onClick={() => handleDelete(idea.id)}
                    className="text-pink-500 hover:text-pink-700 font-bold"
                  >
                    ✕
                  </button>
                </div>
                <div className="text-xs text-purple-400 mt-2">
                  {idea.createdAt.toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}