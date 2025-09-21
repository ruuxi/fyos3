import React, { useState } from 'react';
import './styles.css';

interface Gift {
  id: string;
  name: string;
  recipient: string;
  budget: number;
  status: 'planned' | 'purchased' | 'received';
  date?: string;
}

export default function GiftTracker() {
  const [gifts, setGifts] = useState<Gift[]>([
    { id: '1', name: 'Warm Sweater', recipient: 'Mom', budget: 45, status: 'purchased', date: '2023-12-01' },
    { id: '2', name: 'Toy Train Set', recipient: 'Johnny', budget: 30, status: 'planned' },
  ]);
  
  const [newGift, setNewGift] = useState<Omit<Gift, 'id'>>({ 
    name: '', 
    recipient: '', 
    budget: 0, 
    status: 'planned' 
  });
  
  const [filter, setFilter] = useState<'all' | 'planned' | 'purchased' | 'received'>('all');
  
  const addGift = () => {
    if (newGift.name && newGift.recipient) {
      setGifts([
        ...gifts,
        {
          ...newGift,
          id: Date.now().toString(),
          date: new Date().toISOString().split('T')[0]
        }
      ]);
      setNewGift({ name: '', recipient: '', budget: 0, status: 'planned' });
    }
  };
  
  const deleteGift = (id: string) => {
    setGifts(gifts.filter(gift => gift.id !== id));
  };
  
  const updateGiftStatus = (id: string, status: 'planned' | 'purchased' | 'received') => {
    setGifts(gifts.map(gift => 
      gift.id === id ? { ...gift, status } : gift
    ));
  };
  
  const filteredGifts = gifts.filter(gift => 
    filter === 'all' || gift.status === filter
  );
  
  const totalBudget = gifts.reduce((sum, gift) => sum + gift.budget, 0);
  const purchasedGifts = gifts.filter(gift => gift.status === 'purchased').length;
  
  return (
    <div className="h-full overflow-auto bg-gradient-to-br from-red-50 to-green-50">
      <div className="bg-gradient-to-r from-red-600 to-green-600 text-white p-4 rounded-t-lg shadow-md">
        <h1 className="text-2xl font-bold text-center">🎁 Christmas Gift Tracker</h1>
        <p className="text-center text-red-100 mt-1">Track your holiday gifts and budget</p>
      </div>
      
      <div className="p-4">
        <div className="bg-white rounded-lg shadow-md p-4 mb-4">
          <h2 className="text-lg font-semibold mb-2 text-red-800">Add New Gift</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gift Name</label>
              <input 
                type="text" 
                value={newGift.name}
                onChange={(e) => setNewGift({...newGift, name: e.target.value})}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-red-500 focus:border-red-500"
                placeholder="e.g. Warm Sweater"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Recipient</label>
              <input 
                type="text" 
                value={newGift.recipient}
                onChange={(e) => setNewGift({...newGift, recipient: e.target.value})}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-red-500 focus:border-red-500"
                placeholder="e.g. Mom"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Budget ($)</label>
              <input 
                type="number" 
                value={newGift.budget || ''}
                onChange={(e) => setNewGift({...newGift, budget: Number(e.target.value)})}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-red-500 focus:border-red-500"
                placeholder="0"
                min="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select 
                value={newGift.status}
                onChange={(e) => setNewGift({...newGift, status: e.target.value as any})}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-red-500 focus:border-red-500"
              >
                <option value="planned">Planned</option>
                <option value="purchased">Purchased</option>
                <option value="received">Received</option>
              </select>
            </div>
          </div>
          <button 
            onClick={addGift}
            className="gift-tracker-button w-full py-2 px-4 rounded-md transition-colors"
          >
            Add Gift
          </button>
        </div>
        
        <div className="bg-white rounded-lg shadow-md p-4 mb-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold text-red-800">Gifts List</h2>
            <div className="flex space-x-2">
              <button 
                onClick={() => setFilter('all')}
                className={`px-3 py-1 rounded-full text-sm ${filter === 'all' ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-700'}`}
              >
                All
              </button>
              <button 
                onClick={() => setFilter('planned')}
                className={`px-3 py-1 rounded-full text-sm ${filter === 'planned' ? 'bg-yellow-500 text-white' : 'bg-gray-200 text-gray-700'}`}
              >
                Planned
              </button>
              <button 
                onClick={() => setFilter('purchased')}
                className={`px-3 py-1 rounded-full text-sm ${filter === 'purchased' ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700'}`}
              >
                Purchased
              </button>
              <button 
                onClick={() => setFilter('received')}
                className={`px-3 py-1 rounded-full text-sm ${filter === 'received' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
              >
                Received
              </button>
            </div>
          </div>
          
          <div className="mb-3 flex justify-between items-center bg-red-100 p-3 rounded-md">
            <span className="font-medium text-red-800">Total Budget:</span>
            <span className="text-lg font-bold text-green-700">${totalBudget.toFixed(2)}</span>
            <span className="font-medium text-red-800">Purchased: {purchasedGifts}/{gifts.length}</span>
          </div>
          
          <div className="space-y-3 max-h-60 overflow-y-auto p-2">
            {filteredGifts.map((gift) => (
              <div key={gift.id} className="border border-gray-200 rounded-lg p-3 hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-lg">{gift.name}</h3>
                    <p className="text-gray-600">For: {gift.recipient}</p>
                    <p className="text-gray-600">Budget: ${gift.budget.toFixed(2)}</p>
                    {gift.date && <p className="text-sm text-gray-500">Added: {gift.date}</p>}
                  </div>
                  <div className="flex flex-col items-end space-y-2">
                    <select 
                      value={gift.status}
                      onChange={(e) => updateGiftStatus(gift.id, e.target.value as any)}
                      className={`px-3 py-1 rounded-full text-sm font-medium ${
                        gift.status === 'planned' ? 'bg-yellow-100 text-yellow-800' : 
                        gift.status === 'purchased' ? 'bg-green-100 text-green-800' : 
                        'bg-blue-100 text-blue-800'
                      }`}
                    >
                      <option value="planned">Planned</option>
                      <option value="purchased">Purchased</option>
                      <option value="received">Received</option>
                    </select>
                    <button 
                      onClick={() => deleteGift(gift.id)}
                      className="text-red-600 hover:text-red-800 text-sm font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
            
            {filteredGifts.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <p>No gifts found. Add some gifts to get started!</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}