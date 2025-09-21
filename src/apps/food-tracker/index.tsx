import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import './styles.css';

interface FoodEntry {
  id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  timestamp: Date;
}

const FoodTracker: React.FC = () => {
  const [foodName, setFoodName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [mealType, setMealType] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>('breakfast');
  const [entries, setEntries] = useState<FoodEntry[]>([]);

  const handleAddFood = () => {
    if (!foodName || !calories) return;
    
    const newEntry: FoodEntry = {
      id: Date.now().toString(),
      name: foodName,
      calories: parseInt(calories),
      protein: parseInt(protein) || 0,
      carbs: parseInt(carbs) || 0,
      fat: parseInt(fat) || 0,
      mealType,
      timestamp: new Date(),
    };
    
    setEntries([...entries, newEntry]);
    
    // Reset form
    setFoodName('');
    setCalories('');
    setProtein('');
    setCarbs('');
    setFat('');
  };

  const totalNutrition = entries.reduce((totals, entry) => {
    totals.calories += entry.calories;
    totals.protein += entry.protein;
    totals.carbs += entry.carbs;
    totals.fat += entry.fat;
    return totals;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

  const groupedEntries = entries.reduce((groups, entry) => {
    if (!groups[entry.mealType]) {
      groups[entry.mealType] = [];
    }
    groups[entry.mealType].push(entry);
    return groups;
  }, {} as Record<string, FoodEntry[]>);

  return (
    <div className="h-full overflow-auto p-4 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        <header className="bg-gradient-to-r from-green-500 to-teal-600 text-white p-4 rounded-t-lg shadow-md mb-6">
          <h1 className="text-2xl font-bold">Food Intake Tracker</h1>
          <p className="text-green-100">Log your meals and track your nutrition</p>
        </header>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="text-center text-green-700">Total Calories</CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-3xl font-bold text-green-600">{totalNutrition.calories}</p>
              <p className="text-gray-500">kcal</p>
            </CardContent>
          </Card>
          
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="text-center text-blue-700">Macros</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="font-bold text-blue-600">{totalNutrition.protein}g</p>
                  <p className="text-xs text-gray-500">Protein</p>
                </div>
                <div>
                  <p className="font-bold text-blue-600">{totalNutrition.carbs}g</p>
                  <p className="text-xs text-gray-500">Carbs</p>
                </div>
                <div>
                  <p className="font-bold text-blue-600">{totalNutrition.fat}g</p>
                  <p className="text-xs text-gray-500">Fat</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="shadow-md">
            <CardHeader>
              <CardTitle className="text-center text-purple-700">Entries</CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-3xl font-bold text-purple-600">{entries.length}</p>
              <p className="text-gray-500">foods logged</p>
            </CardContent>
          </Card>
        </div>
        
        <Card className="mb-6 shadow-md">
          <CardHeader>
            <CardTitle className="text-green-700">Log New Food</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Food Name</label>
                <Input 
                  value={foodName}
                  onChange={(e) => setFoodName(e.target.value)}
                  placeholder="e.g. Apple, Chicken Salad"
                  className="mb-3"
                />
                
                <label className="block text-sm font-medium mb-1">Calories (kcal)</label>
                <Input 
                  type="number"
                  value={calories}
                  onChange={(e) => setCalories(e.target.value)}
                  placeholder="e.g. 150"
                  className="mb-3"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Meal Type</label>
                <select 
                  value={mealType}
                  onChange={(e) => setMealType(e.target.value as any)}
                  className="w-full p-2 border border-gray-300 rounded-md mb-3"
                >
                  <option value="breakfast">Breakfast</option>
                  <option value="lunch">Lunch</option>
                  <option value="dinner">Dinner</option>
                  <option value="snack">Snack</option>
                </select>
                
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">Protein (g)</label>
                    <Input 
                      type="number"
                      value={protein}
                      onChange={(e) => setProtein(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Carbs (g)</label>
                    <Input 
                      type="number"
                      value={carbs}
                      onChange={(e) => setCarbs(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Fat (g)</label>
                    <Input 
                      type="number"
                      value={fat}
                      onChange={(e) => setFat(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                </div>
              </div>
            </div>
            
            <Button 
              onClick={handleAddFood}
              className="w-full mt-4 bg-green-600 hover:bg-green-700"
            >
              Add Food Entry
            </Button>
          </CardContent>
        </Card>
        
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle className="text-green-700">Today's Food Log</CardTitle>
          </CardHeader>
          <CardContent>
            {entries.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No foods logged yet. Add your first entry above!</p>
            ) : (
              <div className="space-y-4">
                {Object.entries(groupedEntries).map(([mealType, mealEntries]) => (
                  <div key={mealType}>
                    <h3 className="text-lg font-semibold capitalize text-green-700 mb-2">
                      {mealType} ({mealEntries.length} items)
                    </h3>
                    <div className="space-y-2">
                      {mealEntries.map(entry => (
                        <div key={entry.id} className="flex justify-between items-center p-3 bg-white border border-gray-200 rounded-lg">
                          <div>
                            <p className="font-medium">{entry.name}</p>
                            <p className="text-sm text-gray-500">
                              {entry.protein}g protein, {entry.carbs}g carbs, {entry.fat}g fat
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-green-600">{entry.calories} kcal</p>
                            <p className="text-xs text-gray-500">
                              {entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default FoodTracker;