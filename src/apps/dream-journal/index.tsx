import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface DreamEntry {
  id: string;
  title: string;
  date: string;
  content: string;
  tags: string[];
}

const DreamJournal = () => {
  const [entries, setEntries] = useState<DreamEntry[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Load entries from localStorage on component mount
  useEffect(() => {
    const savedEntries = localStorage.getItem('dreamJournalEntries');
    if (savedEntries) {
      setEntries(JSON.parse(savedEntries));
    }
  }, []);
  
  // Save entries to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('dreamJournalEntries', JSON.stringify(entries));
  }, [entries]);
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (title.trim() === '' || content.trim() === '') return;
    
    const newEntry: DreamEntry = {
      id: Date.now().toString(),
      title,
      date: new Date().toLocaleDateString(),
      content,
      tags: tags.split(',').map(tag => tag.trim()).filter(tag => tag !== '')
    };
    
    setEntries([newEntry, ...entries]);
    setTitle('');
    setContent('');
    setTags('');
  };
  
  const filteredEntries = entries.filter(entry => 
    entry.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()))
  );
  
  return (
    <div className="h-full overflow-auto bg-gradient-to-b from-indigo-50 to-purple-50 p-4">
      <div className="max-w-4xl mx-auto">
        <header className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white p-6 rounded-t-lg shadow-md mb-6">
          <h1 className="text-3xl font-bold">🌙 Dream Journal</h1>
          <p className="mt-2 opacity-90">Capture and explore your dream world</p>
        </header>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-lg p-6 border border-indigo-100">
            <h2 className="text-xl font-semibold text-indigo-800 mb-4">Record New Dream</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-indigo-700 font-medium mb-2">Dream Title</label>
                <Input 
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What was your dream about?"
                  className="border-indigo-200 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              
              <div>
                <label className="block text-indigo-700 font-medium mb-2">Dream Content</label>
                <Textarea 
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Describe your dream in detail..."
                  rows={6}
                  className="border-indigo-200 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              
              <div>
                <label className="block text-indigo-700 font-medium mb-2">Tags (comma separated)</label>
                <Input 
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g., lucid, nightmare, flying, recurring"
                  className="border-indigo-200 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              
              <Button 
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors"
              >
                Save Dream Entry
              </Button>
            </form>
          </div>
          
          <div className="bg-white rounded-xl shadow-lg p-6 border border-indigo-100">
            <h2 className="text-xl font-semibold text-indigo-800 mb-4">Dream Entries</h2>
            
            <div className="mb-4">
              <Input 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search dreams..."
                className="border-indigo-200 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            
            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
              {filteredEntries.length === 0 ? (
                <p className="text-indigo-500 text-center py-4">No dreams recorded yet. Start by adding your first dream!</p>
              ) : (
                filteredEntries.map((entry) => (
                  <div key={entry.id} className="border border-indigo-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start">
                      <h3 className="font-semibold text-indigo-900 text-lg">{entry.title}</h3>
                      <span className="text-sm text-indigo-500 whitespace-nowrap">{entry.date}</span>
                    </div>
                    
                    <p className="mt-2 text-gray-700">{entry.content}</p>
                    
                    <div className="mt-3 flex flex-wrap gap-2">
                      {entry.tags.map((tag, index) => (
                        <span key={index} className="bg-indigo-100 text-indigo-800 px-2 py-1 rounded-full text-xs">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DreamJournal;