import React, { useState, useEffect } from 'react';
import './styles.css';

interface Reminder {
  id: string;
  text: string;
  completed: boolean;
  createdAt: Date;
}

export default function ReminderApp() {
  const [reminders, setReminders] = useState<Reminder[]>(() => {
    const savedReminders = localStorage.getItem('reminders');
    return savedReminders ? JSON.parse(savedReminders) : [];
  });
  const [newReminder, setNewReminder] = useState('');

  useEffect(() => {
    localStorage.setItem('reminders', JSON.stringify(reminders));
  }, [reminders]);

  const addReminder = () => {
    if (newReminder.trim() === '') return;
    
    const reminder: Reminder = {
      id: Date.now().toString(),
      text: newReminder,
      completed: false,
      createdAt: new Date(),
    };
    
    setReminders([reminder, ...reminders]);
    setNewReminder('');
  };

  const toggleReminder = (id: string) => {
    setReminders(reminders.map(reminder => 
      reminder.id === id ? { ...reminder, completed: !reminder.completed } : reminder
    ));
  };

  const deleteReminder = (id: string) => {
    setReminders(reminders.filter(reminder => reminder.id !== id));
  };

  return (
    <div className="h-full overflow-auto flex flex-col bg-gray-50">
      <div className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white p-4">
        <h1 className="text-xl font-bold">📋 Reminder App</h1>
        <p className="text-blue-100 text-sm">Keep track of your tasks and reminders</p>
      </div>
      
      <div className="p-4 flex-1">
        <div className="bg-white rounded-lg shadow-md p-4 mb-6">
          <div className="flex gap-2">
            <input
              type="text"
              value={newReminder}
              onChange={(e) => setNewReminder(e.target.value)}
              placeholder="Add a new reminder..."
              className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => e.key === 'Enter' && addReminder()}
            />
            <button
              onClick={addReminder}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Add
            </button>
          </div>
        </div>
        
        <div className="space-y-3">
          {reminders.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No reminders yet. Add one above!
            </div>
          ) : (
            reminders.map((reminder) => (
              <div 
                key={reminder.id} 
                className={`bg-white rounded-lg shadow-md p-4 flex items-center ${reminder.completed ? 'opacity-70' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={reminder.completed}
                  onChange={() => toggleReminder(reminder.id)}
                  className="h-5 w-5 text-blue-600 rounded focus:ring-blue-500"
                />
                <div className="ml-3 flex-1">
                  <p className={`${reminder.completed ? 'line-through text-gray-500' : 'text-gray-800'}`}>
                    {reminder.text}
                  </p>
                  <p className="text-xs text-gray-400">
                    {new Date(reminder.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => deleteReminder(reminder.id)}
                  className="text-red-500 hover:text-red-700 ml-2"
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}