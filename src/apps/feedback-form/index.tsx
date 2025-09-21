import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import './styles.css';

export function FeedbackForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [feedback, setFeedback] = useState('');
  const [rating, setRating] = useState(0);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // In a real app, you would send this data to a server
    console.log({ name, email, feedback, rating });
    setIsSubmitted(true);
    // Reset form after submission
    setName('');
    setEmail('');
    setFeedback('');
    setRating(0);
  };

  return (
    <div className="h-full overflow-auto bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-lg p-6 app-card">
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white p-4 rounded-t-lg mb-6 app-header">
          <h1 className="text-2xl font-bold">User Feedback Form</h1>
          <p className="text-blue-100">We value your opinion! Please share your feedback with us.</p>
        </div>
        
        {isSubmitted ? (
          <div className="text-center py-8 app-success-message">
            <div className="text-5xl mb-4">✅</div>
            <h2 className="text-xl font-semibold text-green-600 mb-2">Thank You!</h2>
            <p className="text-gray-600">Your feedback has been submitted successfully.</p>
            <Button 
              onClick={() => setIsSubmitted(false)}
              className="mt-4 app-button"
            >
              Submit Another Feedback
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="name" className="font-medium text-gray-700">Name</label>
              <Input 
                id="name" 
                value={name} 
                onChange={(e) => setName(e.target.value)} 
                placeholder="Enter your name" 
                required 
              />
            </div>
            
            <div className="space-y-2">
              <label htmlFor="email" className="font-medium text-gray-700">Email</label>
              <Input 
                id="email" 
                type="email" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                placeholder="Enter your email" 
                required 
              />
            </div>
            
            <div className="space-y-2">
              <label className="font-medium text-gray-700">Rating</label>
              <div className="flex space-x-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className={`text-2xl ${star <= rating ? 'text-yellow-400' : 'text-gray-300'} app-rating-star`}
                    aria-label={`Rate ${star} star${star !== 1 ? 's' : ''}`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
            
            <div className="space-y-2">
              <label htmlFor="feedback" className="font-medium text-gray-700">Your Feedback</label>
              <Textarea 
                id="feedback" 
                value={feedback} 
                onChange={(e) => setFeedback(e.target.value)} 
                placeholder="Please share your thoughts, suggestions, or issues..." 
                rows={5} 
                required 
              />
            </div>
            
            <Button type="submit" className="w-full app-button">
              Submit Feedback
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

export default FeedbackForm;