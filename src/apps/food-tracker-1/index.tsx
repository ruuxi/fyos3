import React, { useState } from 'react';
import './styles.css';

interface FoodEntry {
  id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  timestamp: Date;
}

const FoodTracker: React.FC = () => {
  const [foodEntries, setFoodEntries] = useState<FoodEntry[]>([]);
  const [foodName, setFoodName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (foodName && calories) {
      const newEntry: FoodEntry = {
        id: Date.now().toString(),
        name: foodName,
        calories: parseInt(calories),
        protein: parseInt(protein) || 0,
        carbs: parseInt(carbs) || 0,
        fat: parseInt(fat) || 0,
        timestamp: new Date(),
      };
      setFoodEntries([...foodEntries, newEntry]);
      setFoodName('');
      setCalories('');
      setProtein('');
      setCarbs('');
      setFat('');
    }
  };

  const removeEntry = (id: string) => {
    setFoodEntries(foodEntries.filter(entry => entry.id !== id));
  };

  const totalCalories = foodEntries.reduce((sum, entry) => sum + entry.calories, 0);
  const totalProtein = foodEntries.reduce((sum, entry) => sum + entry.protein, 0);
  const totalCarbs = foodEntries.reduce((sum, entry) => sum + entry.carbs, 0);
  const totalFat = foodEntries.reduce((sum, entry) => sum + entry.fat, 0);

  return (
    <div className="h-full overflow-auto flex flex-col bg-gradient-to-br from-green-50 to-blue-50 p-4">
      <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
        <h1 className="text-2xl font-bold text-green-800 mb-2">🍎 Food Intake Tracker</h1>
        <p className="text-green-600 mb-4">Track your daily nutrition and calories</p>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Food Item</label>
            <input
              type="text"
              value={foodName}
              onChange={(e) => setFoodName(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
              placeholder="What did you eat?"
              required
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Calories</label>
              <input
                type="number"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                placeholder="0"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1"> Protein (g)</label>
              <input
                type="number"
                value={protein}
                onChange={(e) => setProtein(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                placeholder="0"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Carbs (g)</label>
              <input
                type="number"
                value={carbs}
                onChange={(e) => setCarbs(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                placeholder="0"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fat (g)</label>
              <input
                type="number"
                value={fat}
                onChange={(e) => setFat(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                placeholder="0"
              />
            </div>
          </div>
          
          <button 
            type="submit" 
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors duration-200"
          >
            Add Food Entry
          </button>
        </form>
      </div>
      
      {foodEntries.length > 0 && (
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h2 className="text-xl font-bold text-green-800 mb-4">Today's Nutrition Summary</h2>
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div className="bg-green-100 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-green-800">{totalCalories}</p>
              <p className="text-green-600">Calories</p>
            </div>
            <div className="bg-blue-100 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-blue-800">{totalProtein}g</p>
              <p className="text-blue-600">Protein</p>
            </div>
            <div className="bg-yellow-100 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-yellow-800">{totalCarbs}g</p>
              <p className="text-yellow-600">Carbs</p>
            </div>
            <div className="bg-red-100 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-red-800">{totalFat}g</p>
              <p className="text-red-600">Fat</p>
            </div>
          </div>
        </div>
      )}
      
      <div className="bg-white rounded-xl shadow-lg p-6 flex-1">
        <h2 className="text-xl font-bold text-green-800 mb-4">Food Entries</h2>
        {foodEntries.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No food entries yet. Add your first meal above!</p>
        ) : (
          <div className="space-y-3 max-h-60 overflow-y-auto">
            {foodEntries.map((entry) => (
              <div key={entry.id} className="border border-gray-200 rounded-lg p-4 hover:bg-green-50 transition-colors">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-medium text-lg text-gray-800">{entry.name}</h3>
                    <div className="flex space-x-4 mt-2 text-sm">
                      <span className="text-green-600 font-medium">Calories: {entry.calories}</span>
                      <span className="text-blue-600">Protein: {entry.protein}g</span>
                      <span className="text-yellow-600">Carbs: {entry.carbs}g</span>
                      <span className="text-red-600">Fat: {entry.fat}g</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => removeEntry(entry.id)}
                    className="text-red-500 hover:text-red-700 font-medium"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FoodTracker;